// ============================================================
// SEMANTIC ERROR CLASS
// ============================================================
// Depends on: nothing

class SemanticError extends Error {
    constructor(message, node = null) {
        super(message);
        this.node = node;
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

    declare(name, type, arrayDimensions = null, isConstant = false) {
        if (this.table.has(name)) {
            throw new SemanticError(`Variable '${name}' already declared.`);
        }
        this.table.set(name, {
            type,
            assigned: false,
            isArray: arrayDimensions !== null,
            dimensions: arrayDimensions,
            isConstant: isConstant
        });
    }

    assign(name) {
        const entry = this.resolve(name);
        if (!entry) {
            throw new SemanticError(`Variable '${name}' not declared.`);
        }
        if (entry.isConstant && entry.assigned) {
            throw new SemanticError(`Cannot reassign CONSTANT '${name}'.`);
        }
        entry.assigned = true;
    }

    require(name) {
        const entry = this.resolve(name);
        if (!entry) {
            throw new SemanticError(`Variable '${name}' not declared.`);
        }
        if (!entry.assigned) {
            throw new SemanticError(`Variable '${name}' used before assignment.`);
        }
        return entry.type;
    }

    getType(name) {
        const entry = this.resolve(name);
        if (!entry) {
            throw new SemanticError(`Variable '${name}' not declared.`);
        }
        return entry.type;
    }

    get(name) {
        return this.resolve(name);
    }

    has(name) {
        return this.resolve(name) !== null;
    }

    // Walk up the scope chain
    resolve(name) {
        if (this.table.has(name)) {
            return this.table.get(name);
        }
        if (this.parent) {
            return this.parent.resolve(name);
        }
        return null;
    }
}


// ============================================================
// SEMANTIC ANALYZER
// ============================================================
// Walks the AST and performs all semantic checks.

class SemanticAnalyzer {
    constructor() {
        this.symbols = new SymbolTable();
        this.procedures = new Map(); // name -> { params: [...] }
        this.functions = new Map();  // name -> { params: [...], returnType: string }
        this.userTypes = new Map();  // name -> { fields: [{ name, type }] }

        // Built-in function signatures: name -> { argCount, returnType }
        this.builtins = new Map([
            ["LENGTH",      { argCount: 1, returnType: "INTEGER" }],
            ["LCASE",       { argCount: 1, returnType: "STRING" }],
            ["UCASE",       { argCount: 1, returnType: "STRING" }],
            ["TO_LOWER",    { argCount: 1, returnType: "STRING" }],
            ["TO_UPPER",    { argCount: 1, returnType: "STRING" }],
            ["MID",         { argCount: 3, returnType: "STRING" }],
            ["LEFT",        { argCount: 2, returnType: "STRING" }],
            ["RIGHT",       { argCount: 2, returnType: "STRING" }],
            ["INT",         { argCount: 1, returnType: "INTEGER" }],
            ["RAND",        { argCount: 1, returnType: "INTEGER" }],
            ["NUM_TO_STR",  { argCount: 1, returnType: "STRING" }],
            ["STR_TO_NUM",  { argCount: 1, returnType: "REAL" }],
            ["CHR",         { argCount: 1, returnType: "CHAR" }],
            ["ASC",         { argCount: 1, returnType: "INTEGER" }],
            ["EOF",         { argCount: 1, returnType: "BOOLEAN" }],
        ]);
    }

    analyze(programNode) {
        // First pass: register user-defined types, procedures, and functions
        for (const stmt of programNode.statements) {
            if (stmt.type === "TypeDef") {
                this.userTypes.set(stmt.name, { fields: stmt.fields });
            } else if (stmt.type === "Procedure") {
                this.procedures.set(stmt.name, { params: stmt.params });
            } else if (stmt.type === "Function") {
                this.functions.set(stmt.name, { params: stmt.params, returnType: stmt.returnType });
            }
        }

        // Second pass: check everything
        for (const stmt of programNode.statements) {
            this.checkStatement(stmt);
        }
        return true;
    }

    // ------------------------------------------
    // TYPE COMPATIBILITY CHECK
    // ------------------------------------------

    checkTypeCompatible(varType, exprType, varName) {
        if (varType === exprType) return; // exact match always OK

        const numeric = ["INTEGER", "REAL"];
        const stringLike = ["STRING", "CHAR"];

        // INTEGER <- REAL: not allowed (would lose precision)
        if (varType === "INTEGER" && exprType === "REAL") {
            throw new SemanticError(
                `Type mismatch: cannot assign REAL to INTEGER variable '${varName}'. Use INT() to convert.`
            );
        }

        // REAL <- INTEGER: allowed (widening)
        if (varType === "REAL" && exprType === "INTEGER") return;

        // STRING <- CHAR: allowed (widening)
        if (varType === "STRING" && exprType === "CHAR") return;

        // CHAR <- STRING: not allowed
        if (varType === "CHAR" && exprType === "STRING") {
            throw new SemanticError(
                `Type mismatch: cannot assign STRING to CHAR variable '${varName}'.`
            );
        }

        // Numeric used where string expected, or vice versa
        if (numeric.includes(varType) && stringLike.includes(exprType)) {
            throw new SemanticError(
                `Type mismatch: cannot assign ${exprType} to ${varType} variable '${varName}'.`
            );
        }
        if (stringLike.includes(varType) && numeric.includes(exprType)) {
            throw new SemanticError(
                `Type mismatch: cannot assign ${exprType} to ${varType} variable '${varName}'.`
            );
        }

        // BOOLEAN used where numeric/string expected, or vice versa
        if (varType === "BOOLEAN" && exprType !== "BOOLEAN") {
            throw new SemanticError(
                `Type mismatch: cannot assign ${exprType} to BOOLEAN variable '${varName}'.`
            );
        }
        if (exprType === "BOOLEAN" && varType !== "BOOLEAN") {
            throw new SemanticError(
                `Type mismatch: cannot assign BOOLEAN to ${varType} variable '${varName}'.`
            );
        }

        // User-defined types must match exactly
        if (!numeric.includes(varType) && !stringLike.includes(varType) &&
            varType !== "BOOLEAN") {
            throw new SemanticError(
                `Type mismatch: cannot assign ${exprType} to ${varType} variable '${varName}'.`
            );
        }
    }

    // ------------------------------------------
    // STATEMENT CHECKING
    // ------------------------------------------

    checkStatement(node) {
        switch (node.type) {

            case "TypeDef":
                // Already registered in first pass; validate field types
                for (const field of node.fields) {
                    const validTypes = ["INTEGER", "REAL", "STRING", "BOOLEAN", "CHAR"];
                    if (!validTypes.includes(field.type) && !this.userTypes.has(field.type)) {
                        throw new SemanticError(`Unknown type '${field.type}' in TYPE definition '${node.name}'.`);
                    }
                }
                break;

            case "Declare":
                // Allow user-defined types in declarations
                if (node.dataType && !["INTEGER", "REAL", "STRING", "BOOLEAN", "CHAR"].includes(node.dataType)) {
                    if (!this.userTypes.has(node.dataType)) {
                        throw new SemanticError(`Unknown type '${node.dataType}'. Did you define it with TYPE...ENDTYPE?`);
                    }
                }
                this.symbols.declare(node.name, node.dataType, node.arrayDimensions);
                break;

            case "Constant":
                this.checkConstant(node);
                break;

            case "Assignment":
                this.checkAssignment(node);
                break;

            case "Output":
                for (const expr of node.exprs) {
                    this.checkExpression(expr);
                }
                break;

            case "Input":
                this.checkInput(node);
                break;

            case "If":
                this.checkIf(node);
                break;

            case "While":
                this.checkWhile(node);
                break;

            case "For":
                this.checkFor(node);
                break;

            case "Repeat":
                this.checkRepeat(node);
                break;

            case "Case":
                this.checkCase(node);
                break;

            case "Procedure":
                this.checkProcedure(node);
                break;

            case "Function":
                this.checkFunction(node);
                break;

            case "Call":
                this.checkCall(node);
                break;

            case "Return":
                this.checkExpression(node.expr);
                break;

            case "OpenFile":
                this.checkExpression(node.filename);
                break;

            case "ReadFile":
                this.checkExpression(node.filename);
                if (!this.symbols.has(node.variable)) {
                    throw new SemanticError(`Variable '${node.variable}' not declared.`);
                }
                this.symbols.assign(node.variable);
                break;

            case "WriteFile":
                this.checkExpression(node.filename);
                this.checkExpression(node.expr);
                break;

            case "CloseFile":
                this.checkExpression(node.filename);
                break;

            default:
                throw new SemanticError(`Unknown statement type: ${node.type}`);
        }
    }

    // ------------------------------------------
    // CONSTANT
    // ------------------------------------------

    checkConstant(node) {
        this.symbols.declare(node.name, node.dataType, null, true);
        this.symbols.assign(node.name);
    }

    // ------------------------------------------
    // INPUT
    // ------------------------------------------

    checkInput(node) {
        const varInfo = this.symbols.get(node.name);
        if (!varInfo) {
            throw new SemanticError(`Variable '${node.name}' not declared.`);
        }

        // INPUT record.field
        if (node.field) {
            const typeDef = this.userTypes.get(varInfo.type);
            if (!typeDef) {
                throw new SemanticError(`Variable '${node.name}' is not a record type.`);
            }
            const fieldDef = typeDef.fields.find(f => f.name === node.field);
            if (!fieldDef) {
                throw new SemanticError(`Field '${node.field}' does not exist in type '${varInfo.type}'.`);
            }
            this.symbols.assign(node.name);
            return;
        }

        // INPUT array element
        if (node.indices) {
            if (!varInfo.isArray) {
                throw new SemanticError(`Variable '${node.name}' is not an array.`);
            }
            if (node.indices.length !== varInfo.dimensions.length) {
                throw new SemanticError(
                    `Array '${node.name}' requires ${varInfo.dimensions.length} indices, got ${node.indices.length}.`
                );
            }
            for (const idx of node.indices) {
                this.checkExpression(idx);
            }
        }

        // INPUT marks the variable (or array element) as assigned
        this.symbols.assign(node.name);
    }

    // ------------------------------------------
    // ASSIGNMENT
    // ------------------------------------------

    checkAssignment(node) {
        const varInfo = this.symbols.get(node.name);

        if (!varInfo) {
            throw new SemanticError(`Variable '${node.name}' not declared.`);
        }

        // Prevent reassignment of constants
        if (varInfo.isConstant) {
            throw new SemanticError(`Cannot reassign CONSTANT '${node.name}'.`);
        }

        // Handle field access assignment: record.field <- expr
        if (node.field) {
            const typeDef = this.userTypes.get(varInfo.type);
            if (!typeDef) {
                throw new SemanticError(`Variable '${node.name}' is not a record type.`);
            }
            const fieldDef = typeDef.fields.find(f => f.name === node.field);
            if (!fieldDef) {
                throw new SemanticError(`Field '${node.field}' does not exist in type '${varInfo.type}'.`);
            }
            const exprType = this.checkExpression(node.expr);
            this.checkTypeCompatible(fieldDef.type, exprType, `${node.name}.${node.field}`);
            this.symbols.assign(node.name);
            return;
        }

        // Handle array element assignment
        if (node.indices) {
            if (!varInfo.isArray) {
                throw new SemanticError(`Variable '${node.name}' is not an array.`);
            }

            // Validate number of indices matches dimensions
            if (node.indices.length !== varInfo.dimensions.length) {
                throw new SemanticError(
                    `Array '${node.name}' requires ${varInfo.dimensions.length} indices, got ${node.indices.length}.`
                );
            }

            // Check each index is numeric
            for (const idx of node.indices) {
                const idxType = this.checkExpression(idx);
                if (idxType !== "INTEGER" && idxType !== "REAL") {
                    throw new SemanticError(`Array index must be numeric.`);
                }
            }
        } else {
            // Regular variable assignment - cannot assign to whole array
            if (varInfo.isArray) {
                throw new SemanticError(`Cannot assign to whole array '${node.name}'. Use array indexing.`);
            }
        }

        const varType = varInfo.type;
        const exprType = this.checkExpression(node.expr);

        this.checkTypeCompatible(varType, exprType, node.name);

        this.symbols.assign(node.name);
    }

    // ------------------------------------------
    // IF STATEMENTS
    // ------------------------------------------

    checkIf(node) {
        const condType = this.checkExpression(node.condition);

        if (condType !== "BOOLEAN") {
            throw new SemanticError(`IF condition must be a BOOLEAN expression (got ${condType}).`);
        }

        for (const stmt of node.thenBlock) {
            this.checkStatement(stmt);
        }

        for (const stmt of node.elseBlock) {
            this.checkStatement(stmt);
        }
    }

    // ------------------------------------------
    // WHILE
    // ------------------------------------------

    checkWhile(node) {
        const condType = this.checkExpression(node.condition);

        if (condType !== "BOOLEAN") {
            throw new SemanticError(`WHILE condition must be a BOOLEAN expression (got ${condType}).`);
        }

        for (const stmt of node.body) {
            this.checkStatement(stmt);
        }
    }

    // ------------------------------------------
    // FOR
    // ------------------------------------------

    checkFor(node) {
        // Must be declared already
        if (!this.symbols.has(node.loopVar)) {
            throw new SemanticError(
                `Loop variable '${node.loopVar}' must be declared before the FOR loop.`
            );
        }

        // Loop variable must be INTEGER (CIE 9618: count-controlled loops require integer counter)
        const varType = this.symbols.getType(node.loopVar);
        if (varType !== "INTEGER") {
            throw new SemanticError(
                `Loop variable '${node.loopVar}' must be INTEGER. REAL variables cannot be used as a FOR loop counter.`
            );
        }

        // Start, end and step must all be INTEGER (not REAL)
        const startType = this.checkExpression(node.start);
        if (startType !== "INTEGER") {
            throw new SemanticError(
                `FOR loop start value must be INTEGER (got ${startType}).`
            );
        }

        const endType = this.checkExpression(node.end);
        if (endType !== "INTEGER") {
            throw new SemanticError(
                `FOR loop end value must be INTEGER (got ${endType}).`
            );
        }

        const stepType = this.checkExpression(node.step);
        if (stepType !== "INTEGER") {
            throw new SemanticError(
                `FOR loop STEP value must be INTEGER (got ${stepType}).`
            );
        }

        // Mark loop var as assigned before checking body
        this.symbols.assign(node.loopVar);

        for (const stmt of node.body) {
            this.checkStatement(stmt);
        }
    }

    // ------------------------------------------
    // REPEAT
    // ------------------------------------------

    checkRepeat(node) {
        for (const stmt of node.body) {
            this.checkStatement(stmt);
        }

        const condType = this.checkExpression(node.condition);

        if (condType !== "BOOLEAN") {
            throw new SemanticError(`REPEAT UNTIL condition must be a BOOLEAN expression (got ${condType}).`);
        }
    }

    // ------------------------------------------
    // CASE
    // ------------------------------------------

    checkCase(node) {
        const exprType = this.checkExpression(node.expr);

        for (const branch of node.branches) {
            // Check each case value
            for (const val of branch.values) {
                const valType = this.checkExpression(val);
                // Case values should be compatible with the expression type
                if (exprType !== valType &&
                    !(["INTEGER", "REAL"].includes(exprType) && ["INTEGER", "REAL"].includes(valType))) {
                    throw new SemanticError(`CASE value type mismatch.`);
                }
            }
            // Check body statements
            for (const stmt of branch.body) {
                this.checkStatement(stmt);
            }
        }

        // Check OTHERWISE branch
        for (const stmt of node.otherwiseBranch) {
            this.checkStatement(stmt);
        }
    }

    // ------------------------------------------
    // PROCEDURE
    // ------------------------------------------

    checkProcedure(node) {
        // Create a new scope for the procedure
        const outerSymbols = this.symbols;
        this.symbols = new SymbolTable(outerSymbols);

        // Declare parameters in local scope
        for (const param of node.params) {
            this.symbols.declare(param.name, param.type, param.arrayDimensions || null);
            this.symbols.assign(param.name); // params are considered assigned
        }

        for (const stmt of node.body) {
            this.checkStatement(stmt);
        }

        // Restore outer scope
        this.symbols = outerSymbols;
    }

    // ------------------------------------------
    // FUNCTION
    // ------------------------------------------

    checkFunction(node) {
        // Create a new scope for the function
        const outerSymbols = this.symbols;
        this.symbols = new SymbolTable(outerSymbols);

        // Declare parameters in local scope
        for (const param of node.params) {
            this.symbols.declare(param.name, param.type, param.arrayDimensions || null);
            this.symbols.assign(param.name);
        }

        for (const stmt of node.body) {
            this.checkStatement(stmt);
        }

        // Restore outer scope
        this.symbols = outerSymbols;
    }

    // ------------------------------------------
    // CALL
    // ------------------------------------------

    checkCall(node) {
        // Check arguments
        for (const arg of node.args) {
            this.checkExpression(arg);
        }

        // Check built-in functions (case-insensitive)
        const upperName = node.name.toUpperCase();
        if (this.builtins.has(upperName)) {
            const builtin = this.builtins.get(upperName);
            if (node.args.length !== builtin.argCount) {
                throw new SemanticError(
                    `Built-in '${node.name}' expects ${builtin.argCount} argument(s), got ${node.args.length}.`
                );
            }
            return;
        }

        // Validate against registered user-defined signature
        const proc = this.procedures.get(node.name);
        const func = this.functions.get(node.name);
        const signature = proc || func;

        if (signature) {
            if (node.args.length !== signature.params.length) {
                throw new SemanticError(
                    `'${node.name}' expects ${signature.params.length} arguments, got ${node.args.length}.`
                );
            }
        }
    }

    // ------------------------------------------
    // EXPRESSIONS
    // ------------------------------------------

    checkExpression(node) {
        switch (node.type) {

            case "IntegerLiteral":
                return "INTEGER";

            case "RealLiteral":
                return "REAL";

            case "StringLiteral":
                return "STRING";

            case "BooleanLiteral":
                return "BOOLEAN";

            case "Identifier":
                return this.symbols.require(node.name);

            case "ArrayAccess":
                return this.checkArrayAccess(node);

            case "FieldAccess":
                return this.checkFieldAccess(node);

            case "Binary":
                return this.checkBinary(node);

            case "Unary":
                return this.checkUnary(node);

            case "Call":
                // Function call in expression context — check args and validate
                this.checkCall(node);
                // Check built-in functions first (case-insensitive)
                if (this.builtins.has(node.name.toUpperCase())) {
                    return this.builtins.get(node.name.toUpperCase()).returnType;
                }
                // Look up return type from user-defined functions
                if (this.functions.has(node.name)) {
                    return this.functions.get(node.name).returnType;
                }
                // Unknown function — return generic type
                return "INTEGER";

            default:
                throw new SemanticError(`Unknown expression node type: ${node.type}`);
        }
    }

    // ------------------------------------------
    // FIELD ACCESS (record.field)
    // ------------------------------------------

    checkFieldAccess(node) {
        const varInfo = this.symbols.get(node.name);
        if (!varInfo) {
            throw new SemanticError(`Variable '${node.name}' not declared.`);
        }
        if (!varInfo.assigned) {
            throw new SemanticError(`Variable '${node.name}' used before assignment.`);
        }
        const typeDef = this.userTypes.get(varInfo.type);
        if (!typeDef) {
            throw new SemanticError(`Variable '${node.name}' is not a record type.`);
        }
        const fieldDef = typeDef.fields.find(f => f.name === node.field);
        if (!fieldDef) {
            throw new SemanticError(`Field '${node.field}' does not exist in type '${varInfo.type}'.`);
        }
        return fieldDef.type;
    }

    // ------------------------------------------
    // ARRAY ACCESS
    // ------------------------------------------

    checkArrayAccess(node) {
        const varInfo = this.symbols.get(node.name);

        if (!varInfo) {
            throw new SemanticError(`Variable '${node.name}' not declared.`);
        }

        if (!varInfo.isArray) {
            throw new SemanticError(`Variable '${node.name}' is not an array.`);
        }

        if (!varInfo.assigned) {
            throw new SemanticError(`Array '${node.name}' used before assignment.`);
        }

        // Validate number of indices matches dimensions
        if (node.indices.length !== varInfo.dimensions.length) {
            throw new SemanticError(
                `Array '${node.name}' requires ${varInfo.dimensions.length} indices, got ${node.indices.length}.`
            );
        }

        // Check each index is numeric
        for (const idx of node.indices) {
            const idxType = this.checkExpression(idx);
            if (idxType !== "INTEGER" && idxType !== "REAL") {
                throw new SemanticError(`Array index must be numeric.`);
            }
        }

        // Return the base type of the array
        return varInfo.type;
    }

    // ------------------------------------------
    // BINARY EXPRESSIONS
    // ------------------------------------------

    checkBinary(node) {
        const left = this.checkExpression(node.left);
        const right = this.checkExpression(node.right);

        const op = node.op;

        // Arithmetic: + - * / ^ DIV MOD
        const arithmeticOps = [
            "PLUS", "MINUS", "MULTIPLY", "DIVIDE", "POWER", "DIV", "MOD"
        ];

        if (arithmeticOps.includes(op)) {
            if ((left === "INTEGER" || left === "REAL") &&
                (right === "INTEGER" || right === "REAL")) {

                // DIVIDE always returns REAL
                if (op === "DIVIDE") return "REAL";
                // DIV and MOD always return INTEGER
                if (op === "DIV" || op === "MOD") return "INTEGER";
                // Otherwise, REAL if either operand is REAL
                if (left === "REAL" || right === "REAL") return "REAL";
                return "INTEGER";
            }

            throw new SemanticError(`Arithmetic operator '${op}' requires numeric operands.`);
        }

        // String concatenation: &
        if (op === "AMPERSAND") {
            const stringTypes = ["STRING", "CHAR"];
            if (stringTypes.includes(left) && stringTypes.includes(right)) {
                return "STRING";
            }
            // Allow concatenation of any type with string/char (auto-convert)
            if (stringTypes.includes(left) || stringTypes.includes(right)) {
                return "STRING";
            }
            throw new SemanticError(`Concatenation operator '&' requires at least one STRING operand.`);
        }

        // Comparison: = <> < > <= >=
        const comparisonOps = [
            "EQ", "NE", "LT", "GT", "LE", "GE"
        ];

        if (comparisonOps.includes(op)) {
            // Allow numeric comparisons
            if ((left === "INTEGER" || left === "REAL") &&
                (right === "INTEGER" || right === "REAL")) {
                return "BOOLEAN";
            }

            // Allow string/char comparisons
            const stringTypes = ["STRING", "CHAR"];
            if (stringTypes.includes(left) && stringTypes.includes(right)) {
                return "BOOLEAN";
            }

            // Allow boolean comparisons (= and <>)
            if (left === "BOOLEAN" && right === "BOOLEAN") {
                return "BOOLEAN";
            }

            throw new SemanticError(`Incompatible types for comparison '${op}'.`);
        }

        // Boolean operators: AND, OR
        if (op === "AND" || op === "OR") {
            if (left !== "BOOLEAN") {
                throw new SemanticError(`Left operand of '${op}' must be BOOLEAN (got ${left}).`);
            }
            if (right !== "BOOLEAN") {
                throw new SemanticError(`Right operand of '${op}' must be BOOLEAN (got ${right}).`);
            }
            return "BOOLEAN";
        }

        throw new SemanticError(`Unknown binary operator: ${op}`);
    }

    // ------------------------------------------
    // UNARY EXPRESSIONS
    // ------------------------------------------

    checkUnary(node) {
        const operandType = this.checkExpression(node.operand);

        if (node.op === "NOT") {
            if (operandType !== "BOOLEAN") {
                throw new SemanticError(`NOT operator requires a BOOLEAN operand (got ${operandType}).`);
            }
            return "BOOLEAN";
        }

        if (node.op === "NEGATE") {
            if (operandType === "INTEGER" || operandType === "REAL") {
                return operandType;
            }
            throw new SemanticError(`Negation requires a numeric operand.`);
        }

        throw new SemanticError(`Unknown unary operator: ${node.op}`);
    }
}
