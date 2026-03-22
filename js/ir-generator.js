// ============================================================
// IR GENERATOR (Three-Address Code)
// ============================================================
// Depends on: tokens.js (TokenType), ast.js (AST)
//
// Produces instructions like:
//   T0 = X + 1
//   IFZ T0 GOTO L1
//   GOTO L2
//   L1:
//   ...

class IRGenerator {
    constructor() {
        this.instructions = [];
        this.tempCount = 0;
        this.labelCount = 0;
        this.scopeDepth = 0; // Track whether we're inside a function/procedure

        // Built-in function names (checked to emit CALL_BUILTIN instead of CALL FUNC_)
        this.builtins = new Set([
            "LENGTH", "LCASE", "UCASE", "MID", "LEFT", "RIGHT",
            "TO_UPPER", "TO_LOWER",
            "INT", "RAND",
            "NUM_TO_STR", "STR_TO_NUM", "CHR", "ASC",
            "EOF"
        ]);
    }

    newTemp() {
        return `T${this.tempCount++}`;
    }

    newLabel() {
        return `L${this.labelCount++}`;
    }

    emit(text) {
        this.instructions.push(text);
    }

    // ============================================================
    // ENTRY
    // ============================================================

    generate(programNode) {
        for (const stmt of programNode.statements) {
            this.genStatement(stmt);
        }
        return this.instructions;
    }

    // ============================================================
    // STATEMENTS
    // ============================================================

    genStatement(node) {
        switch (node.type) {

            case "TypeDef":
                // No IR needed; type info used only by semantic analysis
                break;

            case "Declare":
                // For arrays, emit array allocation instruction
                if (node.arrayDimensions) {
                    const dims = node.arrayDimensions.map(d => `${d.start}:${d.end}`).join(',');
                    this.emit(`ARRAY ${node.name} [${dims}]`);
                } else if (this.scopeDepth > 0) {
                    // Inside a function/procedure: pre-create local variable
                    // so it doesn't accidentally shadow a global of the same name
                    this.emit(`LOCAL ${node.name}`);
                }
                break;

            case "Constant":
                this.genConstant(node);
                break;

            case "Assignment":
                this.genAssignment(node);
                break;

            case "Output":
                this.genOutput(node);
                break;

            case "Input":
                this.genInput(node);
                break;

            case "If":
                this.genIf(node);
                break;

            case "While":
                this.genWhile(node);
                break;

            case "For":
                this.genFor(node);
                break;

            case "Repeat":
                this.genRepeat(node);
                break;

            case "Case":
                this.genCase(node);
                break;

            case "Procedure":
                this.genProcedure(node);
                break;

            case "Function":
                this.genFunction(node);
                break;

            case "Call":
                this.genCallStatement(node);
                break;

            case "Return":
                this.genReturn(node);
                break;

            case "OpenFile":
                this.genOpenFile(node);
                break;

            case "ReadFile":
                this.genReadFile(node);
                break;

            case "WriteFile":
                this.genWriteFile(node);
                break;

            case "CloseFile":
                this.genCloseFile(node);
                break;

            default:
                throw new Error(`Unknown statement node type: ${node.type}`);
        }
    }

    // ------------------------------------------------------------
    // CONSTANT
    // ------------------------------------------------------------

    genConstant(node) {
        const value = this.genExpression(node.value);
        this.emit(`${node.name} = ${value}`);
    }

    // ------------------------------------------------------------
    // ASSIGNMENT
    // ------------------------------------------------------------

    genAssignment(node) {
        const value = this.genExpression(node.expr);

        if (node.field) {
            // Record field assignment: record.field = value
            this.emit(`${node.name}.${node.field} = ${value}`);
        } else if (node.indices) {
            // Array element assignment
            const indices = node.indices.map(idx => this.genExpression(idx)).join(',');
            this.emit(`${node.name}[${indices}] = ${value}`);
        } else {
            this.emit(`${node.name} = ${value}`);
        }
    }

    // ------------------------------------------------------------
    // OUTPUT (supports multi-value: OUTPUT "X = ", X)
    // ------------------------------------------------------------

    genOutput(node) {
        if (node.exprs.length === 1) {
            // Single expression — standard OUTPUT
            const value = this.genExpression(node.exprs[0]);
            this.emit(`OUTPUT ${value}`);
        } else {
            // Multi-value: emit OUTPUT_PART for each, then OUTPUT_END to flush the line
            for (const expr of node.exprs) {
                const value = this.genExpression(expr);
                this.emit(`OUTPUT_PART ${value}`);
            }
            this.emit(`OUTPUT_END`);
        }
    }

    // ------------------------------------------------------------
    // INPUT
    // ------------------------------------------------------------

    genInput(node) {
        if (node.field) {
            // Record field input: INPUT record.field
            this.emit(`INPUT ${node.name}.${node.field}`);
        } else if (node.indices) {
            const indices = node.indices.map(idx => this.genExpression(idx)).join(',');
            this.emit(`INPUT ${node.name}[${indices}]`);
        } else {
            this.emit(`INPUT ${node.name}`);
        }
    }

    // ------------------------------------------------------------
    // IF STATEMENT
    // ------------------------------------------------------------

    genIf(node) {
        const cond = this.genExpression(node.condition);
        const labelElse = this.newLabel();
        const labelEnd = this.newLabel();

        this.emit(`IFZ ${cond} GOTO ${labelElse}`);

        for (const stmt of node.thenBlock) {
            this.genStatement(stmt);
        }

        this.emit(`GOTO ${labelEnd}`);
        this.emit(`${labelElse}:`);

        for (const stmt of node.elseBlock) {
            this.genStatement(stmt);
        }

        this.emit(`${labelEnd}:`);
    }

    // ------------------------------------------------------------
    // WHILE LOOP
    // ------------------------------------------------------------

    genWhile(node) {
        const labelStart = this.newLabel();
        const labelEnd = this.newLabel();

        this.emit(`${labelStart}:`);
        const cond = this.genExpression(node.condition);

        this.emit(`IFZ ${cond} GOTO ${labelEnd}`);

        for (const stmt of node.body) {
            this.genStatement(stmt);
        }

        this.emit(`GOTO ${labelStart}`);
        this.emit(`${labelEnd}:`);
    }

    // ------------------------------------------------------------
    // FOR LOOP (with direction-aware comparison)
    // ------------------------------------------------------------

    genFor(node) {
        const start = this.genExpression(node.start);
        const end = this.genExpression(node.end);
        const step = this.genExpression(node.step);

        this.emit(`${node.loopVar} = ${start}`);

        const labelStart = this.newLabel();
        const labelEnd = this.newLabel();

        this.emit(`${labelStart}:`);

        // Direction-aware loop condition
        // Check if step is a known literal to choose comparison direction
        const stepIsNegative = this.isNegativeStep(node.step);
        const stepIsPositive = this.isPositiveStep(node.step);

        const tempCond = this.newTemp();

        if (stepIsNegative) {
            // Counting down: continue while loopVar >= end
            this.emit(`${tempCond} = ${node.loopVar} >= ${end}`);
        } else if (stepIsPositive) {
            // Counting up: continue while loopVar <= end
            this.emit(`${tempCond} = ${node.loopVar} <= ${end}`);
        } else {
            // Dynamic step: need runtime direction check
            // If step > 0 then use <=, else use >=
            const tempStepPos = this.newTemp();
            const tempUp = this.newTemp();
            const tempDown = this.newTemp();

            this.emit(`${tempStepPos} = ${step} > 0`);

            // Compute both conditions
            this.emit(`${tempUp} = ${node.loopVar} <= ${end}`);
            this.emit(`${tempDown} = ${node.loopVar} >= ${end}`);

            // Select: if step > 0, use tempUp, else use tempDown
            // Implementation: cond = (stepPos AND up) OR (NOT stepPos AND down)
            const tempNotStepPos = this.newTemp();
            const tempA = this.newTemp();
            const tempB = this.newTemp();
            this.emit(`${tempNotStepPos} = ${tempStepPos} == 0`);
            this.emit(`${tempA} = ${tempStepPos} && ${tempUp}`);
            this.emit(`${tempB} = ${tempNotStepPos} && ${tempDown}`);
            this.emit(`${tempCond} = ${tempA} || ${tempB}`);
        }

        this.emit(`IFZ ${tempCond} GOTO ${labelEnd}`);

        // Body
        for (const stmt of node.body) {
            this.genStatement(stmt);
        }

        // Increment
        const tempInc = this.newTemp();
        this.emit(`${tempInc} = ${node.loopVar} + ${step}`);
        this.emit(`${node.loopVar} = ${tempInc}`);

        this.emit(`GOTO ${labelStart}`);
        this.emit(`${labelEnd}:`);
    }

    // Helper: is the step a positive literal?
    isPositiveStep(stepNode) {
        if (stepNode.type === "IntegerLiteral" || stepNode.type === "RealLiteral") {
            return stepNode.value > 0;
        }
        return false; // unknown at compile time
    }

    // Helper: is the step a negative literal?
    isNegativeStep(stepNode) {
        if (stepNode.type === "IntegerLiteral" || stepNode.type === "RealLiteral") {
            return stepNode.value < 0;
        }
        // Also check for Unary NEGATE of a positive literal
        if (stepNode.type === "Unary" && stepNode.op === "NEGATE") {
            const inner = stepNode.operand;
            if (inner.type === "IntegerLiteral" || inner.type === "RealLiteral") {
                return inner.value > 0; // negating a positive = negative
            }
        }
        return false;
    }

    // ------------------------------------------------------------
    // REPEAT LOOP
    // ------------------------------------------------------------

    genRepeat(node) {
        const labelStart = this.newLabel();

        this.emit(`${labelStart}:`);

        for (const stmt of node.body) {
            this.genStatement(stmt);
        }

        const cond = this.genExpression(node.condition);
        this.emit(`IFZ ${cond} GOTO ${labelStart}`);
    }

    // ------------------------------------------------------------
    // CASE STATEMENT
    // ------------------------------------------------------------

    genCase(node) {
        const exprVal = this.genExpression(node.expr);
        const labelEnd = this.newLabel();

        for (const branch of node.branches) {
            const labelNext = this.newLabel();

            // For each value in this branch, check for a match
            if (branch.values.length === 1) {
                // Single value
                const val = this.genExpression(branch.values[0]);
                const tempCond = this.newTemp();
                this.emit(`${tempCond} = ${exprVal} == ${val}`);
                this.emit(`IFZ ${tempCond} GOTO ${labelNext}`);
            } else {
                // Multiple values (OR'd together)
                const labelMatch = this.newLabel();
                for (const v of branch.values) {
                    const val = this.genExpression(v);
                    const tempCond = this.newTemp();
                    this.emit(`${tempCond} = ${exprVal} == ${val}`);
                    // If any match, jump to the body
                    this.emit(`IFNZ ${tempCond} GOTO ${labelMatch}`);
                }
                // None matched — skip to next branch
                this.emit(`GOTO ${labelNext}`);
                this.emit(`${labelMatch}:`);
            }

            // Emit branch body
            for (const stmt of branch.body) {
                this.genStatement(stmt);
            }

            this.emit(`GOTO ${labelEnd}`);
            this.emit(`${labelNext}:`);
        }

        // OTHERWISE branch
        for (const stmt of node.otherwiseBranch) {
            this.genStatement(stmt);
        }

        this.emit(`${labelEnd}:`);
    }

    // ------------------------------------------------------------
    // PROCEDURE
    // ------------------------------------------------------------

    genProcedure(node) {
        const labelSkip = this.newLabel();
        this.emit(`GOTO ${labelSkip}`);
        this.emit(`PROC_${node.name}:`);

        // Enter local scope
        this.emit(`ENTER_SCOPE`);

        // Pop arguments from arg stack into parameter names (in reverse order)
        for (let i = node.params.length - 1; i >= 0; i--) {
            const param = node.params[i];
            if (param.mode === "BYREF") {
                this.emit(`POP_BYREF ${param.name}`);
            } else {
                this.emit(`POP_PARAM ${param.name}`);
            }
        }

        this.scopeDepth++;
        for (const stmt of node.body) {
            this.genStatement(stmt);
        }
        this.scopeDepth--;

        // Write back BYREF params before exiting scope
        for (const param of node.params) {
            if (param.mode === "BYREF") {
                this.emit(`WRITEBACK_BYREF ${param.name}`);
            }
        }

        this.emit(`EXIT_SCOPE`);
        this.emit(`RET`);
        this.emit(`${labelSkip}:`);
    }

    // ------------------------------------------------------------
    // FUNCTION
    // ------------------------------------------------------------

    genFunction(node) {
        const labelSkip = this.newLabel();
        this.emit(`GOTO ${labelSkip}`);
        this.emit(`FUNC_${node.name}:`);

        // Enter local scope
        this.emit(`ENTER_SCOPE`);

        // Pop arguments from arg stack into parameter names (in reverse order)
        for (let i = node.params.length - 1; i >= 0; i--) {
            const param = node.params[i];
            if (param.mode === "BYREF") {
                this.emit(`POP_BYREF ${param.name}`);
            } else {
                this.emit(`POP_PARAM ${param.name}`);
            }
        }

        this.scopeDepth++;
        for (const stmt of node.body) {
            this.genStatement(stmt);
        }
        this.scopeDepth--;

        // RETURN should have been emitted inside the body
        this.emit(`EXIT_SCOPE`);
        this.emit(`RET`);
        this.emit(`${labelSkip}:`);
    }

    // ------------------------------------------------------------
    // CALL (as statement)
    // ------------------------------------------------------------

    genCallStatement(node) {
        // Push arguments — for BYREF args, push the variable name as a reference
        for (const arg of node.args) {
            if (arg.type === "Identifier") {
                // Could be BYREF — push both value and ref name
                this.emit(`PUSH ${arg.name}`);
                this.emit(`PUSH_REF ${arg.name}`);
            } else if (arg.type === "ArrayAccess") {
                const indices = arg.indices.map(idx => this.genExpression(idx)).join(',');
                const ref = `${arg.name}[${indices}]`;
                this.emit(`PUSH ${ref}`);
                this.emit(`PUSH_REF ${ref}`);
            } else {
                const val = this.genExpression(arg);
                this.emit(`PUSH ${val}`);
                this.emit(`PUSH_REF __NONE__`);
            }
        }
        this.emit(`CALL PROC_${node.name}`);
    }

    // ------------------------------------------------------------
    // RETURN
    // ------------------------------------------------------------

    genReturn(node) {
        const val = this.genExpression(node.expr);
        this.emit(`RETVAL ${val}`);
        this.emit(`EXIT_SCOPE`);
        this.emit(`RET`);
    }

    // ------------------------------------------------------------
    // FILE HANDLING
    // ------------------------------------------------------------

    genOpenFile(node) {
        const filename = this.genExpression(node.filename);
        this.emit(`OPENFILE ${filename} ${node.mode}`);
    }

    genReadFile(node) {
        const filename = this.genExpression(node.filename);
        this.emit(`READFILE ${filename} ${node.variable}`);
    }

    genWriteFile(node) {
        const filename = this.genExpression(node.filename);
        const data = this.genExpression(node.expr);
        this.emit(`WRITEFILE ${filename} ${data}`);
    }

    genCloseFile(node) {
        const filename = this.genExpression(node.filename);
        this.emit(`CLOSEFILE ${filename}`);
    }

    // ============================================================
    // EXPRESSIONS
    // ============================================================

    genExpression(node) {
        switch (node.type) {

            case "IntegerLiteral":
                return node.value.toString();

            case "RealLiteral":
                return node.value.toString();

            case "StringLiteral":
                return `"${node.value}"`;

            case "BooleanLiteral":
                return node.value ? "1" : "0";

            case "Identifier":
                return node.name;

            case "ArrayAccess": {
                const indices = node.indices.map(idx => this.genExpression(idx)).join(',');
                return `${node.name}[${indices}]`;
            }

            case "FieldAccess":
                return `${node.name}.${node.field}`;

            case "Binary":
                return this.genBinary(node);

            case "Unary":
                return this.genUnary(node);

            case "Call":
                return this.genCallExpression(node);

            default:
                throw new Error(`Unknown expression node: ${node.type}`);
        }
    }

    // ------------------------------------------------------------
    // BINARY OPERATORS
    // ------------------------------------------------------------

    genBinary(node) {
        const left = this.genExpression(node.left);
        const right = this.genExpression(node.right);

        const t = this.newTemp();
        this.emit(`${t} = ${left} ${this.mapOp(node.op)} ${right}`);
        return t;
    }

    // ------------------------------------------------------------
    // UNARY OPERATORS
    // ------------------------------------------------------------

    genUnary(node) {
        const operand = this.genExpression(node.operand);
        const t = this.newTemp();

        if (node.op === "NOT") {
            this.emit(`${t} = ${operand} == 0`);
        } else if (node.op === "NEGATE") {
            this.emit(`${t} = 0 - ${operand}`);
        } else {
            throw new Error(`Unknown unary operator: ${node.op}`);
        }

        return t;
    }

    // ------------------------------------------------------------
    // FUNCTION CALL (in expression context)
    // ------------------------------------------------------------

    genCallExpression(node) {
        // Check if this is a built-in function (case-insensitive)
        if (this.builtins.has(node.name.toUpperCase())) {
            return this.genBuiltinCall(node);
        }

        // Push arguments — for BYREF args, push the variable name as a reference
        for (const arg of node.args) {
            if (arg.type === "Identifier") {
                this.emit(`PUSH ${arg.name}`);
                this.emit(`PUSH_REF ${arg.name}`);
            } else if (arg.type === "ArrayAccess") {
                const indices = arg.indices.map(idx => this.genExpression(idx)).join(',');
                const ref = `${arg.name}[${indices}]`;
                this.emit(`PUSH ${ref}`);
                this.emit(`PUSH_REF ${ref}`);
            } else {
                const val = this.genExpression(arg);
                this.emit(`PUSH ${val}`);
                this.emit(`PUSH_REF __NONE__`);
            }
        }

        const t = this.newTemp();
        this.emit(`CALL FUNC_${node.name}`);
        this.emit(`${t} = RETVAL`);
        return t;
    }

    // ------------------------------------------------------------
    // BUILT-IN FUNCTION CALL
    // ------------------------------------------------------------

    genBuiltinCall(node) {
        // Evaluate all arguments
        const argTemps = node.args.map(arg => this.genExpression(arg));

        const t = this.newTemp();
        // Always emit builtin name in uppercase so the runtime matches correctly
        this.emit(`${t} = BUILTIN ${node.name.toUpperCase()} ${argTemps.join(' ')}`);
        return t;
    }

    // ------------------------------------------------------------
    // OPERATOR MAPPING
    // ------------------------------------------------------------

    mapOp(op) {
        switch (op) {
            case "PLUS": return "+";
            case "MINUS": return "-";
            case "MULTIPLY": return "*";
            case "DIVIDE": return "/";
            case "POWER": return "^";
            case "DIV": return "DIV";
            case "MOD": return "MOD";
            case "AMPERSAND": return "&";

            case "EQ": return "==";
            case "NE": return "!=";
            case "LT": return "<";
            case "GT": return ">";
            case "LE": return "<=";
            case "GE": return ">=";

            case "AND": return "&&";
            case "OR": return "||";

            default:
                throw new Error(`Unknown operator: ${op}`);
        }
    }
}
