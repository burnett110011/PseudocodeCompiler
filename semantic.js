// ============================================================
// SEMANTIC ERROR CLASS
// ============================================================
// Depends on: errors.js (CompileError, suggestName)
//
// `node` is anything with line/col/length (an AST node or a position object).
// It is filled in with the innermost expression/statement as the error
// propagates up, so every error points at the code that caused it.

class SemanticError extends Error {
    constructor(message, node = null, hint = null) {
        super(message);
        this.node = node;
        this.hint = hint;
    }
}


// ============================================================
// SYMBOL TABLE
// ============================================================
// Tracks variables, their types, and assignment status.

class SymbolTable {
    constructor(parent = null) {
        this.table = new Map();
        this.parent = parent; // for scope chaining (procedures/functions)
    }

    declare(name, type, arrayDimensions = null, isConstant = false, line = null) {
        if (this.table.has(name)) {
            const prev = this.table.get(name);
            throw new SemanticError(
                `'${name}' is already declared`, null,
                prev.line ? `it was first declared on line ${prev.line}` : null
            );
        }
        this.table.set(name, {
            type,
            assigned: false,
            isArray: arrayDimensions !== null,
            dimensions: arrayDimensions,
            isConstant: isConstant,
            line
        });
    }

    // Find a symbol. `outer` is true when it lives in an enclosing scope.
    lookup(name) {
        let scope = this;
        let outer = false;
        while (scope) {
            if (scope.table.has(name)) {
                return { entry: scope.table.get(name), outer };
            }
            scope = scope.parent;
            outer = true;
        }
        return null;
    }

    get(name) {
        const found = this.lookup(name);
        return found ? found.entry : null;
    }

    has(name) {
        return this.lookup(name) !== null;
    }

    // Every name visible from here (for "did you mean" suggestions)
    names() {
        const out = [];
        for (let scope = this; scope; scope = scope.parent) {
            for (const k of scope.table.keys()) out.push(k);
        }
        return out;
    }

    markAssigned(name) {
        const entry = this.get(name);
        if (entry) entry.assigned = true;
    }
}


// ============================================================
// HELPERS
// ============================================================

const SEM_BUILTIN_TYPES = ["INTEGER", "REAL", "STRING", "BOOLEAN", "CHAR"];

// "an INTEGER", "a REAL" ...
function withArticle(t) { return (t === "INTEGER" ? "an " : "a ") + t; }

// Type of something whose own declaration was already reported as wrong;
// it is accepted everywhere so one mistake is not reported again and again.
function isUnknown(t) { return t === "UNKNOWN"; }

function isNumericType(t) { return t === "INTEGER" || t === "REAL"; }
function isTextType(t) { return t === "STRING" || t === "CHAR"; }

const OP_SYMBOLS = {
    PLUS: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/", POWER: "^",
    DIV: "DIV", MOD: "MOD", AMPERSAND: "&",
    EQ: "=", NE: "<>", LT: "<", GT: ">", LE: "<=", GE: ">=",
    AND: "AND", OR: "OR"
};

// Static value of a literal (or negated literal) expression, else undefined
function literalValue(node) {
    if (!node) return undefined;
    switch (node.type) {
        case "IntegerLiteral":
        case "RealLiteral":
        case "StringLiteral":
        case "BooleanLiteral":
            return node.value;
        case "Unary":
            if (node.op === "NEGATE") {
                const v = literalValue(node.operand);
                return typeof v === "number" ? -v : undefined;
            }
    }
    return undefined;
}

// Why a value of type `from` cannot go into a slot of type `to`.
// Returns null when it can.
function assignmentProblem(to, from) {
    if (to === from || isUnknown(to) || isUnknown(from)) return null;
    if (to === "REAL" && from === "INTEGER") return null;   // widening
    if (to === "STRING" && from === "CHAR") return null;    // widening

    let hint = null;
    if (to === "INTEGER" && from === "REAL") {
        hint = "use INT(...) to remove the decimal part";
    } else if (to === "CHAR" && from === "STRING") {
        hint = "a CHAR is a single character in single quotes, e.g. 'a'";
    } else if (isNumericType(to) && isTextType(from)) {
        hint = "use STR_TO_NUM(...) to convert text to a number";
    } else if (isTextType(to) && isNumericType(from)) {
        hint = "use NUM_TO_STR(...) to convert a number to text";
    }
    return { hint };
}

// Built-in functions: parameter kinds are S (text), N (number) or A (any)
const BUILTIN_FUNCTIONS = new Map([
    ["LENGTH",     { params: ["S"],           returnType: "INTEGER" }],
    ["LCASE",      { params: ["S"],           returnType: "STRING" }],
    ["UCASE",      { params: ["S"],           returnType: "STRING" }],
    ["TO_LOWER",   { params: ["S"],           returnType: "STRING" }],
    ["TO_UPPER",   { params: ["S"],           returnType: "STRING" }],
    ["MID",        { params: ["S", "N", "N"], returnType: "STRING" }],
    ["LEFT",       { params: ["S", "N"],      returnType: "STRING" }],
    ["RIGHT",      { params: ["S", "N"],      returnType: "STRING" }],
    ["INT",        { params: ["N"],           returnType: "INTEGER" }],
    ["RAND",       { params: ["N"],           returnType: "INTEGER" }],
    ["NUM_TO_STR", { params: ["N"],           returnType: "STRING" }],
    ["STR_TO_NUM", { params: ["S"],           returnType: "REAL" }],
    ["CHR",        { params: ["N"],           returnType: "CHAR" }],
    ["ASC",        { params: ["S"],           returnType: "INTEGER" }],
    ["EOF",        { params: ["S"],           returnType: "BOOLEAN" }],
]);

const KIND_LABEL = { S: "text (STRING)", N: "a number", A: "a value" };


// ============================================================
// SEMANTIC ANALYZER
// ============================================================
// Walks the AST and performs all semantic checks. Errors are collected, not
// thrown one at a time: a failing statement is reported and checking moves on
// to the next, so one run lists every problem.

class SemanticAnalyzer {
    constructor() {
        this.symbols = new SymbolTable();
        this.procedures = new Map(); // name -> { params, node }
        this.functions = new Map();  // name -> { params, returnType, node }
        this.userTypes = new Map();  // name -> { fields: [{ name, type }], node }
        this.errors = [];
        this.routine = null;         // the PROCEDURE/FUNCTION being checked
        this.hoisted = new Map();    // main-program variables, visible inside routines
    }

    analyze(programNode) {
        // First pass: register user-defined types, procedures, and functions
        for (const stmt of programNode.statements) {
            this.guard(() => this.registerDefinition(stmt), stmt);
        }

        // Signatures that name an unknown type are reported when the routine is
        // checked; callers just treat those types as UNKNOWN.
        const valid = t => SEM_BUILTIN_TYPES.includes(t) || this.userTypes.has(t);
        for (const sig of [...this.procedures.values(), ...this.functions.values()]) {
            sig.params = sig.params.map(p => valid(p.type) ? p : { ...p, type: "UNKNOWN" });
            if (sig.returnType !== undefined && !valid(sig.returnType)) sig.returnType = "UNKNOWN";
        }

        // Routines are often written above the main program that declares the
        // variables they use, so make top-level variables visible to them.
        for (const stmt of programNode.statements) {
            if ((stmt.type === "Declare" || stmt.type === "Constant") && !this.hoisted.has(stmt.name)) {
                this.hoisted.set(stmt.name, {
                    type: valid(stmt.dataType) ? stmt.dataType : "UNKNOWN",
                    assigned: true,
                    isArray: !!stmt.arrayDimensions,
                    dimensions: stmt.arrayDimensions || null,
                    isConstant: stmt.type === "Constant",
                    line: stmt.line
                });
            }
        }

        // Second pass: check everything
        for (const stmt of programNode.statements) {
            this.checkStatement(stmt);
        }

        if (this.errors.length > 0) {
            this.errors.sort((a, b) => (a.line - b.line) || (a.col - b.col));
            throw new CompileError(this.errors);
        }
        return true;
    }

    registerDefinition(stmt) {
        if (stmt.type === "TypeDef") {
            if (this.userTypes.has(stmt.name)) {
                throw new SemanticError(`Type '${stmt.name}' is already defined`, stmt,
                    `first defined on line ${this.userTypes.get(stmt.name).node.line}`);
            }
            this.userTypes.set(stmt.name, { fields: stmt.fields, node: stmt });
        } else if (stmt.type === "Procedure" || stmt.type === "Function") {
            const existing = this.procedures.get(stmt.name) || this.functions.get(stmt.name);
            if (existing) {
                throw new SemanticError(`'${stmt.name}' is already defined as a ${existing.node.type.toLowerCase()}`, stmt,
                    `first defined on line ${existing.node.line}`);
            }
            if (BUILTIN_FUNCTIONS.has(stmt.name.toUpperCase())) {
                throw new SemanticError(`'${stmt.name}' is the name of a built-in function`, stmt,
                    "choose a different name");
            }
            if (stmt.type === "Procedure") {
                this.procedures.set(stmt.name, { params: stmt.params, node: stmt });
            } else {
                this.functions.set(stmt.name, { params: stmt.params, returnType: stmt.returnType, node: stmt });
            }
        }
    }

    // ------------------------------------------
    // ERROR PLUMBING
    // ------------------------------------------

    report(err, fallbackNode) {
        const node = err.node || fallbackNode || {};
        const diag = {
            phase: "semantic",
            message: err.message,
            line: node.line,
            col: node.col,
            length: node.length || 1,
            hint: err.hint || undefined
        };
        const dup = this.errors.some(e =>
            e.line === diag.line && e.col === diag.col && e.message === diag.message);
        if (!dup) this.errors.push(diag);
    }

    // Run fn; if it throws a SemanticError, record it and return undefined
    guard(fn, fallbackNode) {
        try {
            return fn();
        } catch (e) {
            if (!(e instanceof SemanticError)) throw e;
            this.report(e, fallbackNode);
            return undefined;
        }
    }

    err(message, node, hint) {
        return new SemanticError(message, node, hint);
    }

    // ------------------------------------------
    // NAME / TYPE LOOKUP
    // ------------------------------------------

    undeclared(name, node) {
        let hint;
        if (this.functions.has(name)) {
            hint = `'${name}' is a function; call it with brackets: ${name}(...)`;
        } else if (this.procedures.has(name)) {
            hint = `'${name}' is a procedure; run it with CALL ${name}`;
        } else if (BUILTIN_FUNCTIONS.has(name.toUpperCase())) {
            hint = `'${name}' is a built-in function; call it with brackets: ${name.toUpperCase()}(...)`;
        } else {
            const guess = suggestName(name, [...this.symbols.names(), ...(this.routine ? this.hoisted.keys() : [])]);
            hint = guess
                ? `did you mean '${guess}'?` + (guess.toLowerCase() === name.toLowerCase() ? " (names are case-sensitive)" : "")
                : `declare it first, e.g. DECLARE ${name} : INTEGER`;
        }
        return this.err(`Variable '${name}' has not been declared`, node, hint);
    }

    // Symbol lookup. Inside a routine, main-program variables count even if
    // their DECLARE comes later in the file.
    findSymbol(name) {
        const found = this.symbols.lookup(name);
        if (found) return found;
        if (this.routine) {
            const h = this.hoisted.get(name);
            if (h) return { entry: h, outer: true };
        }
        return null;
    }

    // Declared symbol entry or an "undeclared" error
    lookupVar(name, node) {
        const found = this.findSymbol(name);
        if (!found) throw this.undeclared(name, node);
        return found;
    }

    checkTypeName(name, pos) {
        if (SEM_BUILTIN_TYPES.includes(name) || this.userTypes.has(name)) return;
        const guess = suggestName(name, [...SEM_BUILTIN_TYPES, ...this.userTypes.keys()]);
        throw this.err(`Unknown data type '${name}'`, pos,
            guess ? `did you mean ${guess}?`
                  : "use INTEGER, REAL, STRING, BOOLEAN, CHAR, or a name defined with TYPE...ENDTYPE");
    }

    // The type name if it is valid; otherwise report it and give back UNKNOWN
    validType(name, pos, fallbackNode) {
        const ok = this.guard(() => { this.checkTypeName(name, pos); return true; }, fallbackNode);
        return ok ? name : "UNKNOWN";
    }

    // Static type of a literal node
    literalType(node) {
        if (node.type === "StringLiteral" && node.quote === "'" && node.value.length === 1) return "CHAR";
        return null;
    }

    // ------------------------------------------
    // TYPE COMPATIBILITY CHECK
    // ------------------------------------------

    checkTypeCompatible(varType, exprType, varName, exprNode) {
        const problem = assignmentProblem(varType, exprType);
        if (!problem) return;
        throw this.err(
            `Cannot assign ${withArticle(exprType)} value to ${varType} variable '${varName}'`,
            exprNode, problem.hint
        );
    }

    // ------------------------------------------
    // STATEMENT CHECKING
    // ------------------------------------------

    checkStatement(node) {
        this.guard(() => this.checkStatementInner(node), node);
    }

    checkBlock(stmts) {
        for (const stmt of stmts) this.checkStatement(stmt);
    }

    checkStatementInner(node) {
        switch (node.type) {

            case "TypeDef":
                // Already registered in first pass; validate field types
                for (const field of node.fields) {
                    this.guard(() => this.checkTypeName(field.type, field.typePos || field), node);
                }
                break;

            case "Declare": {
                // Declare even if the type is unknown, so one typo in the type
                // does not turn every later use of the variable into an error.
                const declType = this.validType(node.dataType, node.typePos || node, node);
                this.symbols.declare(node.name, declType, node.arrayDimensions, false, node.line);
                break;
            }

            case "Constant":
                this.symbols.declare(node.name, node.dataType, null, true, node.line);
                this.symbols.markAssigned(node.name);
                break;

            case "Assignment":
                this.checkAssignment(node);
                break;

            case "Output":
                for (const expr of node.exprs) {
                    this.guard(() => this.checkExpression(expr), node);
                }
                break;

            case "Input":
                this.checkInput(node);
                break;

            case "If":
                this.checkCondition(node.condition, "IF");
                this.checkBlock(node.thenBlock);
                this.checkBlock(node.elseBlock);
                break;

            case "While":
                this.checkCondition(node.condition, "WHILE");
                this.checkBlock(node.body);
                break;

            case "For":
                this.checkFor(node);
                break;

            case "Repeat":
                this.checkBlock(node.body);
                this.checkCondition(node.condition, "REPEAT...UNTIL");
                break;

            case "Case":
                this.checkCase(node);
                break;

            case "Procedure":
            case "Function":
                this.checkRoutine(node);
                break;

            case "Call":
                this.checkCall(node, true);
                break;

            case "Return":
                this.checkReturn(node);
                break;

            case "OpenFile":
                this.checkFileName(node.filename);
                break;

            case "ReadFile": {
                this.checkFileName(node.filename);
                const found = this.lookupVar(node.variable, node);
                if (found.entry.isConstant) {
                    throw this.err(`Cannot read a file into the CONSTANT '${node.variable}'`, node);
                }
                if (found.entry.isArray) {
                    throw this.err(`Cannot read a file into the whole array '${node.variable}'`, node);
                }
                this.symbols.markAssigned(node.variable);
                break;
            }

            case "WriteFile":
                this.checkFileName(node.filename);
                this.checkExpression(node.expr);
                break;

            case "CloseFile":
                this.checkFileName(node.filename);
                break;

            default:
                throw this.err(`Unknown statement type: ${node.type}`, node);
        }
    }

    checkFileName(expr) {
        const t = this.checkExpression(expr);
        if (!isTextType(t) && !isUnknown(t)) {
            throw this.err(`A file name must be text (STRING), but this is ${t}`, expr,
                'for example OPENFILE "data.txt" FOR READ');
        }
    }

    // Condition of IF / WHILE / UNTIL. A bad condition is reported but the
    // body is still checked.
    checkCondition(expr, what) {
        this.guard(() => {
            const t = this.checkExpression(expr);
            if (t !== "BOOLEAN" && !isUnknown(t)) {
                throw this.err(
                    `The ${what} condition must be a true/false (BOOLEAN) expression, but this is ${t}`,
                    expr,
                    isNumericType(t) || isTextType(t)
                        ? "compare it with something, e.g. x > 0 or name = \"Sam\""
                        : null
                );
            }
        });
    }

    // ------------------------------------------
    // INPUT
    // ------------------------------------------

    checkInput(node) {
        const { entry } = this.lookupVar(node.name, node);

        if (entry.isConstant) {
            throw this.err(`Cannot INPUT into the CONSTANT '${node.name}'`, node);
        }

        // INPUT record.field
        if (node.field) {
            const fieldDef = this.findField(entry, node.name, node.field, node);
            this.symbols.markAssigned(node.name);
            return;
        }

        // INPUT array element
        if (node.indices) {
            this.checkIndices(node, entry);
        } else if (entry.isArray) {
            throw this.err(`Cannot INPUT into the whole array '${node.name}'`, node,
                `input one element at a time, e.g. INPUT ${node.name}[i]`);
        }

        this.symbols.markAssigned(node.name);
    }

    // ------------------------------------------
    // ASSIGNMENT
    // ------------------------------------------

    checkAssignment(node) {
        const { entry } = this.lookupVar(node.name, node);

        if (entry.isConstant) {
            throw this.err(`Cannot change the CONSTANT '${node.name}'`, node,
                "constants keep the value they were given");
        }

        let targetType;
        let targetName = node.name;

        if (node.field) {
            // record.field <- expr
            const fieldDef = this.findField(entry, node.name, node.field, node);
            targetType = fieldDef.type;
            targetName = `${node.name}.${node.field}`;
        } else if (node.indices) {
            // array element
            this.checkIndices(node, entry);
            targetType = entry.type;
        } else {
            if (entry.isArray) {
                throw this.err(`Cannot assign to the whole array '${node.name}'`, node,
                    `assign to one element at a time, e.g. ${node.name}[1] <- value`);
            }
            targetType = entry.type;
        }

        try {
            const exprType = this.checkExpression(node.expr);
            this.checkTypeCompatible(targetType, exprType, targetName, node.expr);
        } finally {
            // Even if the value is wrong the variable is "set", so later uses
            // are not also reported as use-before-assignment.
            this.symbols.markAssigned(node.name);
        }
    }

    // Look up `field` in the record type of variable `entry`
    findField(entry, varName, field, node) {
        const typeDef = this.userTypes.get(entry.type);
        if (!typeDef || entry.isArray) {
            throw this.err(`'${varName}' is a ${entry.type} variable, not a record, so it has no field '${field}'`, node);
        }
        const fieldDef = typeDef.fields.find(f => f.name === field);
        if (!fieldDef) {
            const guess = suggestName(field, typeDef.fields.map(f => f.name));
            throw this.err(`Type '${entry.type}' has no field called '${field}'`, node,
                guess ? `did you mean '${guess}'?`
                      : `its fields are: ${typeDef.fields.map(f => f.name).join(", ")}`);
        }
        return fieldDef;
    }

    // Validate the index list of an array element (count, type, constant bounds)
    checkIndices(node, entry) {
        if (!entry.isArray) {
            throw this.err(`'${node.name}' is not an array, so it cannot be indexed`, node,
                `declare it with DECLARE ${node.name} : ARRAY[1:10] OF ${entry.type}`);
        }

        const dims = entry.dimensions;
        if (node.indices.length !== dims.length) {
            throw this.err(
                `Array '${node.name}' has ${dims.length} dimension${dims.length === 1 ? "" : "s"} ` +
                `but is indexed with ${node.indices.length}`,
                node,
                dims.length === 1 ? `use ${node.name}[index]` : `use ${node.name}[row, column]`
            );
        }

        node.indices.forEach((idx, i) => {
            const t = this.checkExpression(idx);
            if (t !== "INTEGER" && !isUnknown(t)) {
                throw this.err(`An array index must be an INTEGER, but this is ${t}`, idx,
                    t === "REAL" ? "use DIV for whole-number division, or INT(...) to remove the decimal part" : null);
            }
            const v = literalValue(idx);
            if (typeof v === "number" && (v < dims[i].start || v > dims[i].end)) {
                throw this.err(
                    `Index ${v} is outside the bounds of array '${node.name}' (${dims[i].start} to ${dims[i].end})`,
                    idx);
            }
        });
    }

    // ------------------------------------------
    // FOR
    // ------------------------------------------

    checkFor(node) {
        this.guard(() => {
            const found = this.findSymbol(node.loopVar);
            if (!found) {
                throw this.err(`The loop variable '${node.loopVar}' has not been declared`, node,
                    `declare it before the loop: DECLARE ${node.loopVar} : INTEGER`);
            }
            if (found.entry.isArray) {
                throw this.err(`The loop variable '${node.loopVar}' cannot be an array`, node);
            }
            if (found.entry.isConstant) {
                throw this.err(`The loop variable '${node.loopVar}' is a CONSTANT and cannot be changed`, node);
            }
            if (found.entry.type !== "INTEGER" && !isUnknown(found.entry.type)) {
                throw this.err(
                    `The loop variable '${node.loopVar}' must be an INTEGER, but it is ${found.entry.type}`, node);
            }
        }, node);

        for (const [part, label] of [[node.start, "start"], [node.end, "end"], [node.step, "STEP"]]) {
            this.guard(() => {
                const t = this.checkExpression(part);
                if (t !== "INTEGER" && !isUnknown(t)) {
                    throw this.err(`The FOR loop ${label} value must be an INTEGER, but this is ${t}`, part,
                        t === "REAL" ? "use INT(...) to remove the decimal part" : null);
                }
                if (label === "STEP" && literalValue(part) === 0) {
                    throw this.err("A STEP of 0 would make the loop run forever", part);
                }
            }, node);
        }

        // The loop variable has a value inside the body
        this.symbols.markAssigned(node.loopVar);
        this.checkBlock(node.body);
    }

    // ------------------------------------------
    // CASE
    // ------------------------------------------

    checkCase(node) {
        const exprType = this.guard(() => this.checkExpression(node.expr), node);
        const seen = new Map(); // literal key -> line

        for (const branch of node.branches) {
            for (const val of branch.values) {
                this.guard(() => {
                    const valType = this.checkExpression(val);
                    if (exprType !== undefined && !isUnknown(exprType) && !isUnknown(valType)) {
                        const ok = valType === exprType ||
                            (isNumericType(exprType) && isNumericType(valType)) ||
                            (isTextType(exprType) && isTextType(valType));
                        if (!ok) {
                            throw this.err(
                                `This CASE value is ${valType} but the CASE expression is ${exprType}`, val,
                                "every value must be the same kind of data as the expression after CASE OF");
                        }
                    }
                    const lit = literalValue(val);
                    if (lit !== undefined) {
                        const key = typeof lit + ":" + lit;
                        if (seen.has(key)) {
                            throw this.err(`Duplicate CASE value ${JSON.stringify(lit)}`, val,
                                `it is already used on line ${seen.get(key)}`);
                        }
                        seen.set(key, val.line);
                    }
                }, node);
            }
            this.checkBlock(branch.body);
        }

        this.checkBlock(node.otherwiseBranch);
    }

    // ------------------------------------------
    // PROCEDURE / FUNCTION
    // ------------------------------------------

    checkRoutine(node) {
        const isFunction = node.type === "Function";

        if (this.routine) {
            this.guard(() => {
                throw this.err(`A ${node.type.toLowerCase()} cannot be defined inside another one`, node);
            });
        }

        const outerSymbols = this.symbols;
        const outerRoutine = this.routine;
        this.symbols = new SymbolTable(outerSymbols);
        this.routine = { node, isFunction, returnType: node.returnType, returns: 0 };

        if (isFunction) {
            this.routine.returnType = this.validType(node.returnType, node.typePos || node, node);
        }

        for (const param of node.params) {
            this.guard(() => {
                const t = this.validType(param.type, param.typePos || param, node);
                this.symbols.declare(param.name, t, param.arrayDimensions || null, false, param.line);
                this.symbols.markAssigned(param.name); // params arrive with a value
            }, param);
        }

        this.checkBlock(node.body);

        if (isFunction && this.routine.returns === 0) {
            this.report(this.err(`Function '${node.name}' never returns a value`, node,
                `add a RETURN statement, e.g. RETURN result`), node);
        }

        this.symbols = outerSymbols;
        this.routine = outerRoutine;
    }

    checkReturn(node) {
        if (!this.routine) {
            throw this.err("RETURN can only be used inside a FUNCTION", node);
        }
        if (!this.routine.isFunction) {
            throw this.err(
                `A PROCEDURE cannot return a value ('${this.routine.node.name}' is a procedure)`, node,
                "change it to a FUNCTION ... RETURNS <type>, or remove the RETURN");
        }
        this.routine.returns++;
        const t = this.checkExpression(node.expr);
        const problem = assignmentProblem(this.routine.returnType, t);
        if (problem) {
            throw this.err(
                `Function '${this.routine.node.name}' returns ${this.routine.returnType}, but this value is ${t}`,
                node.expr, problem.hint);
        }
    }

    // ------------------------------------------
    // CALLS (statements and expressions)
    // ------------------------------------------

    // asStatement: true for CALL ..., false when used inside an expression.
    // Returns the result type for expressions.
    checkCall(node, asStatement = false) {
        const name = node.name;
        const upper = name.toUpperCase();

        // Built-in functions
        if (BUILTIN_FUNCTIONS.has(upper) && !this.procedures.has(name) && !this.functions.has(name)) {
            if (asStatement) {
                throw this.err(`'${upper}' is a built-in function and returns a value`, node,
                    `use it inside an expression, e.g. OUTPUT ${upper}(...)`);
            }
            return this.checkBuiltinCall(node, upper);
        }

        const proc = this.procedures.get(name);
        const func = this.functions.get(name);
        const sig = proc || func;

        if (!sig) {
            const candidates = [...this.procedures.keys(), ...this.functions.keys(), ...BUILTIN_FUNCTIONS.keys()];
            const guess = suggestName(name, candidates);
            let hint = guess ? `did you mean '${guess}'?` : null;
            if (!hint && this.findSymbol(name)) {
                hint = `'${name}' is a variable, not a procedure or function`;
            }
            throw this.err(
                `${asStatement ? "Procedure" : "Function"} '${name}' is not defined`, node, hint);
        }

        if (proc && !asStatement) {
            throw this.err(`'${name}' is a procedure and does not return a value, so it cannot be used in an expression`,
                node, `run it as a statement instead: CALL ${name}(...)`);
        }

        this.checkUserArgs(node, sig, name);

        if (asStatement) return undefined;
        return func.returnType;
    }

    checkBuiltinCall(node, upper) {
        const spec = BUILTIN_FUNCTIONS.get(upper);
        const need = spec.params.length;
        const given = node.args.length;

        if (given !== need) {
            throw this.err(
                `${upper} expects ${need} argument${need === 1 ? "" : "s"} but ${given} ${given === 1 ? "was" : "were"} given`,
                given > need ? node.args[need] : node,
                `${upper}(${spec.params.map(k => KIND_LABEL[k].replace(/ \(.*\)/, "")).join(", ")})`);
        }

        node.args.forEach((arg, i) => {
            const t = this.checkExpression(arg);
            const kind = spec.params[i];
            const ok = kind === "A" || isUnknown(t) || (kind === "S" && isTextType(t)) || (kind === "N" && isNumericType(t));
            if (!ok) {
                throw this.err(
                    `Argument ${i + 1} of ${upper} must be ${KIND_LABEL[kind]}, but this is ${t}`, arg,
                    kind === "S" && isNumericType(t) ? "use NUM_TO_STR(...) to convert a number to text"
                        : kind === "N" && isTextType(t) ? "use STR_TO_NUM(...) to convert text to a number"
                        : null);
            }
        });

        return spec.returnType;
    }

    checkUserArgs(node, sig, name) {
        const params = sig.params;
        const given = node.args.length;
        const signature = `${name}(${params.map(p => `${p.name} : ${p.arrayDimensions ? "ARRAY OF " : ""}${p.type}`).join(", ")})`;

        if (given !== params.length) {
            throw this.err(
                `'${name}' expects ${params.length} argument${params.length === 1 ? "" : "s"} but ${given} ${given === 1 ? "was" : "were"} given`,
                given > params.length ? node.args[params.length] : node,
                signature);
        }

        const byRefTargets = [];

        node.args.forEach((arg, i) => {
            const p = params[i];
            const label = `Argument ${i + 1} ('${p.name}') of '${name}'`;

            // Array parameter: must be given a whole array of the same shape
            if (p.arrayDimensions) {
                const entry = arg.type === "Identifier" ? (this.findSymbol(arg.name) || {}).entry : null;
                if (arg.type === "Identifier" && !entry) throw this.undeclared(arg.name, arg);
                if (!entry || !entry.isArray) {
                    throw this.err(`${label} must be an array`, arg, signature);
                }
                if ((entry.type !== p.type && !isUnknown(entry.type) && !isUnknown(p.type)) || entry.dimensions.length !== p.arrayDimensions.length) {
                    throw this.err(
                        `${label} must be a ${p.arrayDimensions.length}-dimensional array of ${p.type}, ` +
                        `but '${arg.name}' is a ${entry.dimensions.length}-dimensional array of ${entry.type}`, arg);
                }
                if (p.mode === "BYREF") byRefTargets.push(arg.name);
                return;
            }

            if (p.mode === "BYREF") {
                if (arg.type !== "Identifier" && arg.type !== "ArrayAccess" && arg.type !== "FieldAccess") {
                    throw this.err(`${label} is BYREF, so it must be given a variable, not a value`, arg, signature);
                }
                const t = this.checkReference(arg);
                if (t !== p.type && !isUnknown(t) && !isUnknown(p.type)) {
                    throw this.err(`${label} is BYREF and must be exactly ${p.type}, but this is ${t}`, arg);
                }
                byRefTargets.push(arg.name);
                return;
            }

            const t = this.checkExpression(arg);
            const problem = assignmentProblem(p.type, t);
            if (problem) {
                throw this.err(`${label} must be ${p.type}, but this is ${t}`, arg, problem.hint || signature);
            }
        });

        // A BYREF argument may be written to by the routine, so it now has a value
        for (const target of byRefTargets) this.symbols.markAssigned(target);
    }

    // A variable passed BYREF: must exist and not be a constant, but it does
    // not need a value yet (the routine may be what gives it one).
    checkReference(node) {
        const found = this.lookupVar(node.name, node);
        if (found.entry.isConstant) {
            throw this.err(`The CONSTANT '${node.name}' cannot be passed BYREF because it cannot be changed`, node);
        }
        if (node.type === "ArrayAccess") return this.checkArrayAccess(node, false);
        if (node.type === "FieldAccess") return this.checkFieldAccess(node, false);
        if (found.entry.isArray) {
            throw this.err(`Array '${node.name}' needs an index here`, node);
        }
        return found.entry.type;
    }

    // ------------------------------------------
    // EXPRESSIONS
    // ------------------------------------------

    checkExpression(node) {
        try {
            return this.checkExpressionInner(node);
        } catch (e) {
            if (e instanceof SemanticError && !e.node) e.node = node;
            throw e;
        }
    }

    checkExpressionInner(node) {
        switch (node.type) {

            case "IntegerLiteral":
                return "INTEGER";

            case "RealLiteral":
                return "REAL";

            case "StringLiteral":
                return this.literalType(node) || "STRING";

            case "BooleanLiteral":
                return "BOOLEAN";

            case "Identifier": {
                const { entry, outer } = this.lookupVar(node.name, node);
                if (entry.isArray) {
                    throw this.err(`Array '${node.name}' cannot be used without an index`, node,
                        `use ${node.name}[i] for one element`);
                }
                this.requireValue(node.name, entry, outer, node);
                return entry.type;
            }

            case "ArrayAccess":
                return this.checkArrayAccess(node, true);

            case "FieldAccess":
                return this.checkFieldAccess(node, true);

            case "Binary":
                return this.checkBinary(node);

            case "Unary":
                return this.checkUnary(node);

            case "Call":
                return this.checkCall(node, false);

            default:
                throw this.err(`Unknown expression node type: ${node.type}`, node);
        }
    }

    // Reading a variable that has never been given a value. Variables from the
    // main program are exempt inside a PROCEDURE/FUNCTION, because the
    // routine's body appears before the code that sets them.
    requireValue(name, entry, outer, node, what = "Variable") {
        if (entry.assigned) return;
        if (outer && this.routine) return;
        throw this.err(`${what} '${name}' is used before it has been given a value`, node,
            `assign it first (${name} <- ...) or read it with INPUT ${name}`);
    }

    // ------------------------------------------
    // FIELD ACCESS (record.field)
    // ------------------------------------------

    checkFieldAccess(node, needValue) {
        const { entry, outer } = this.lookupVar(node.name, node);
        if (needValue) this.requireValue(node.name, entry, outer, node);
        return this.findField(entry, node.name, node.field, node).type;
    }

    // ------------------------------------------
    // ARRAY ACCESS
    // ------------------------------------------

    checkArrayAccess(node, needValue) {
        const { entry, outer } = this.lookupVar(node.name, node);
        this.checkIndices(node, entry);
        if (needValue) this.requireValue(node.name, entry, outer, node, "Array");
        return entry.type;
    }

    // ------------------------------------------
    // BINARY EXPRESSIONS
    // ------------------------------------------

    checkBinary(node) {
        const left = this.checkExpression(node.left);
        const right = this.checkExpression(node.right);

        const op = node.op;
        const sym = OP_SYMBOLS[op] || op;

        // An operand whose declaration was already reported: don't pile on
        if (isUnknown(left) || isUnknown(right)) {
            if (["EQ", "NE", "LT", "GT", "LE", "GE", "AND", "OR"].includes(op)) return "BOOLEAN";
            if (op === "AMPERSAND") return "STRING";
            return "UNKNOWN";
        }

        // Arithmetic: + - * / ^ DIV MOD
        if (["PLUS", "MINUS", "MULTIPLY", "DIVIDE", "POWER", "DIV", "MOD"].includes(op)) {
            if (isNumericType(left) && isNumericType(right)) {
                if ((op === "DIVIDE" || op === "DIV" || op === "MOD") && literalValue(node.right) === 0) {
                    throw this.err("Division by zero", node.right);
                }
                if (op === "DIVIDE") return "REAL";
                if (op === "DIV" || op === "MOD") {
                    if (left !== "INTEGER" || right !== "INTEGER") {
                        throw this.err(`'${sym}' needs two INTEGER operands, but they are ${left} and ${right}`, node,
                            "use INT(...) to remove a decimal part first");
                    }
                    return "INTEGER";
                }
                return (left === "REAL" || right === "REAL") ? "REAL" : "INTEGER";
            }

            const bad = !isNumericType(left) ? left : right;
            let hint = null;
            if (op === "PLUS" && (isTextType(left) || isTextType(right))) {
                hint = "use & to join text; + only adds numbers";
            } else if (isTextType(bad)) {
                hint = "use STR_TO_NUM(...) to convert text to a number";
            }
            throw this.err(`Operator '${sym}' needs numbers, but the operands are ${left} and ${right}`, node, hint);
        }

        // String concatenation: &
        if (op === "AMPERSAND") {
            if (isTextType(left) || isTextType(right)) {
                return "STRING";
            }
            throw this.err(`Operator '&' joins text, but both operands are ${left === right ? left : left + " and " + right}`,
                node, "convert a number to text with NUM_TO_STR(...)");
        }

        // Comparison: = <> < > <= >=
        if (["EQ", "NE", "LT", "GT", "LE", "GE"].includes(op)) {
            const equality = op === "EQ" || op === "NE";
            if (isNumericType(left) && isNumericType(right)) return "BOOLEAN";
            if (isTextType(left) && isTextType(right)) return "BOOLEAN";
            if (left === "BOOLEAN" && right === "BOOLEAN") {
                if (equality) return "BOOLEAN";
                throw this.err(`'${sym}' cannot compare BOOLEAN values`, node, "BOOLEANs can only be compared with = and <>");
            }
            let hint = null;
            if ((isNumericType(left) && isTextType(right)) || (isTextType(left) && isNumericType(right))) {
                hint = "convert one side with STR_TO_NUM(...) or NUM_TO_STR(...)";
            }
            throw this.err(`Cannot compare ${left} with ${right} using '${sym}'`, node, hint);
        }

        // Boolean operators: AND, OR
        if (op === "AND" || op === "OR") {
            if (left !== "BOOLEAN" || right !== "BOOLEAN") {
                const which = left !== "BOOLEAN" ? "left" : "right";
                const t = left !== "BOOLEAN" ? left : right;
                throw this.err(`The ${which} side of ${op} must be a true/false (BOOLEAN) expression, but it is ${t}`,
                    left !== "BOOLEAN" ? node.left : node.right,
                    `write each condition in full, e.g. x > 1 ${op} x < 5`);
            }
            return "BOOLEAN";
        }

        throw this.err(`Unknown binary operator: ${op}`, node);
    }

    // ------------------------------------------
    // UNARY EXPRESSIONS
    // ------------------------------------------

    checkUnary(node) {
        const operandType = this.checkExpression(node.operand);

        if (isUnknown(operandType)) return node.op === "NOT" ? "BOOLEAN" : "UNKNOWN";

        if (node.op === "NOT") {
            if (operandType !== "BOOLEAN") {
                throw this.err(`NOT needs a true/false (BOOLEAN) value, but this is ${operandType}`, node.operand);
            }
            return "BOOLEAN";
        }

        if (node.op === "NEGATE") {
            if (isNumericType(operandType)) return operandType;
            throw this.err(`A minus sign needs a number, but this is ${operandType}`, node.operand);
        }

        throw this.err(`Unknown unary operator: ${node.op}`, node);
    }
}
