// ============================================================
// RUNTIME (VIRTUAL MACHINE)
// ============================================================
// Depends on: nothing
//
// Executes the IR instructions produced by IRGenerator.

class Runtime {

    constructor(instructions) {
        this.instructions = instructions;
        this.pc = 0;
        this.globals = {};        // global variable store
        this.scopeStack = [];     // stack of local scope frames
        this.labels = this.mapLabels();
        this.output = [];
        this.inputQueue = [];

        // Terminal mode support
        this.terminalMode = false;
        this.writeOutput = null;
        this.readInput = null;

        // Buffer for multi-part OUTPUT
        this.outputBuffer = "";

        // Halt flag — set to true to stop execution
        this.halted = false;

        // Call stack for procedures/functions
        this.callStack = [];
        this.returnValue = undefined;
        this.argStack = [];     // values
        this.refStack = [];     // reference names for BYREF

        // Virtual filesystem (in-memory)
        this.files = {};  // filename -> { lines: [], readPos: 0, mode: null, open: false }

        // Backward-compatible: this.vars points to globals by default
        this.vars = this.globals;
    }

    // ------------------------------------------
    // Extract labels and their positions
    // ------------------------------------------

    mapLabels() {
        const map = {};

        for (let i = 0; i < this.instructions.length; i++) {
            const line = this.instructions[i];
            if (line.endsWith(":")) {
                const label = line.slice(0, -1);
                map[label] = i;
            }
        }

        return map;
    }

    // ------------------------------------------
    // Scope management
    // ------------------------------------------

    enterScope() {
        this.scopeStack.push({ locals: {}, byrefMap: {} });
    }

    exitScope() {
        this.scopeStack.pop();
    }

    currentScope() {
        if (this.scopeStack.length > 0) {
            return this.scopeStack[this.scopeStack.length - 1];
        }
        return null;
    }

    // Resolve a variable name: check local scope first, then globals
    resolveVar(name) {
        const scope = this.currentScope();
        if (scope && name in scope.locals) {
            return scope.locals[name];
        }
        return this.globals[name];
    }

    // Set a variable: if in a local scope and the var exists locally, set it there;
    // otherwise set in globals (unless it's a new var in a scope — new vars in scope go local)
    setVar(name, value) {
        const scope = this.currentScope();
        if (scope && name in scope.locals) {
            scope.locals[name] = value;
        } else if (scope && !(name in this.globals)) {
            // New variable declared inside a procedure/function — make it local
            scope.locals[name] = value;
        } else {
            this.globals[name] = value;
        }
    }

    // ------------------------------------------
    // Value resolution
    // ------------------------------------------

    getValue(x) {
        // Handle string literals (wrapped in quotes)
        if (typeof x === 'string' && x.startsWith('"') && x.endsWith('"')) {
            return x.slice(1, -1);
        }

        // Handle numeric literals
        if (!isNaN(x) && x !== '' && x !== null && x !== undefined) {
            return parseFloat(x);
        }

        // Handle array access: Numbers[5] or Grid[2,3]
        if (typeof x === 'string' && x.includes('[')) {
            const match = x.match(/^(\w+)\[(.+)\]$/);
            if (match) {
                const arrayName = match[1];
                const indicesStr = match[2];

                const indices = indicesStr.split(',').map(idx => {
                    const val = this.getValue(idx.trim());
                    return Math.floor(val);
                });

                const arr = this.resolveVar(arrayName);
                if (!arr) {
                    throw new Error(`Array '${arrayName}' not initialized`);
                }

                if (indices.length === 1) {
                    return arr[indices[0]];
                } else if (indices.length === 2) {
                    return arr[indices[0]][indices[1]];
                }
            }
        }

        // Handle record field access: record.field
        if (typeof x === 'string' && x.includes('.') && !x.startsWith('"')) {
            const dotIdx = x.indexOf('.');
            const recName = x.substring(0, dotIdx);
            const fieldName = x.substring(dotIdx + 1);
            if (/^\w+$/.test(recName) && /^\w+$/.test(fieldName)) {
                const rec = this.resolveVar(recName);
                if (rec !== undefined && rec !== null && typeof rec === 'object') {
                    return rec[fieldName];
                }
            }
        }

        // Handle RETVAL keyword
        if (x === 'RETVAL') {
            return this.returnValue;
        }

        // Handle variable references (scope-aware)
        return this.resolveVar(x);
    }

    // ------------------------------------------
    // Assign to a target (variable or array element)
    // ------------------------------------------

    assignTarget(target, val) {
        if (target.includes('[')) {
            const match = target.match(/^(\w+)\[(.+)\]$/);
            if (match) {
                const arrayName = match[1];
                const indicesStr = match[2];
                const indices = indicesStr.split(',').map(idx => {
                    const idxVal = this.getValue(idx.trim());
                    return Math.floor(idxVal);
                });

                // Arrays are always global (or resolved from scope)
                let arr = this.resolveVar(arrayName);
                if (!arr) {
                    arr = {};
                    this.setVar(arrayName, arr);
                }

                if (indices.length === 1) {
                    arr[indices[0]] = val;
                } else if (indices.length === 2) {
                    if (!arr[indices[0]]) arr[indices[0]] = {};
                    arr[indices[0]][indices[1]] = val;
                }
            }
        } else if (target.includes('.')) {
            // Record field assignment: record.field
            const dotIdx = target.indexOf('.');
            const recName = target.substring(0, dotIdx);
            const fieldName = target.substring(dotIdx + 1);
            let rec = this.resolveVar(recName);
            if (rec === undefined || rec === null || typeof rec !== 'object') {
                rec = {};
                this.setVar(recName, rec);
            }
            rec[fieldName] = val;
        } else {
            this.setVar(target, val);
        }
    }

    // ------------------------------------------
    // Execute a single instruction
    // ------------------------------------------

    step() {
        if (this.pc >= this.instructions.length) return false;

        const line = this.instructions[this.pc];

        // Label-only line
        if (line.endsWith(":")) {
            this.pc++;
            return true;
        }

        const parts = line.split(" ");

        // -----------------------------------------------------------------
        // ARRAY declaration
        // -----------------------------------------------------------------
        if (parts[0] === "ARRAY") {
            const arrayName = parts[1];
            const dimsMatch = line.match(/\[(.+)\]/);
            if (dimsMatch) {
                const dimsStr = dimsMatch[1];
                const dims = dimsStr.split(',').map(d => {
                    const [start, end] = d.trim().split(':').map(n => parseInt(n));
                    return { start, end };
                });

                const arr = {};
                if (dims.length === 1) {
                    const { start, end } = dims[0];
                    for (let i = start; i <= end; i++) {
                        arr[i] = 0;
                    }
                } else if (dims.length === 2) {
                    const { start: start1, end: end1 } = dims[0];
                    const { start: start2, end: end2 } = dims[1];
                    for (let i = start1; i <= end1; i++) {
                        arr[i] = {};
                        for (let j = start2; j <= end2; j++) {
                            arr[i][j] = 0;
                        }
                    }
                }
                this.setVar(arrayName, arr);
            }
            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // LOCAL varName (pre-create a variable in the current local scope)
        // -----------------------------------------------------------------
        if (parts[0] === "LOCAL") {
            const varName = parts[1];
            const scope = this.currentScope();
            if (scope) {
                scope.locals[varName] = 0;  // initialize to 0 (default)
            }
            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // OUTPUT X
        // -----------------------------------------------------------------
        if (parts[0] === "OUTPUT") {
            const expr = parts.slice(1).join(" ");
            const val = this.getValue(expr);

            if (this.terminalMode && this.writeOutput) {
                this.writeOutput(String(val));
            } else {
                this.output.push(val);
            }

            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // OUTPUT_PART X  (accumulate into buffer, don't print yet)
        // -----------------------------------------------------------------
        if (parts[0] === "OUTPUT_PART") {
            const expr = parts.slice(1).join(" ");
            const val = this.getValue(expr);
            this.outputBuffer += String(val);
            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // OUTPUT_END  (flush the accumulated buffer as one line)
        // -----------------------------------------------------------------
        if (parts[0] === "OUTPUT_END") {
            if (this.terminalMode && this.writeOutput) {
                this.writeOutput(this.outputBuffer);
            } else {
                this.output.push(this.outputBuffer);
            }
            this.outputBuffer = "";
            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // INPUT variable or INPUT Array[index]
        // -----------------------------------------------------------------
        if (parts[0] === "INPUT") {
            const target = parts[1];

            if (this.terminalMode && this.readInput) {
                this.pendingInput = { target, line: this.pc };
                return 'WAIT_INPUT';
            }

            let value;
            if (this.inputQueue.length > 0) {
                value = this.inputQueue.shift();
            } else {
                const input = prompt(`Enter value for ${target}:`);
                if (input === null) {
                    throw new Error("Input cancelled");
                }
                const parsed = parseFloat(input);
                value = isNaN(parsed) ? input : parsed;
            }

            this.assignTarget(target, value);

            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // PUSH value (for procedure/function calls)
        // -----------------------------------------------------------------
        if (parts[0] === "PUSH") {
            const val = this.getValue(parts.slice(1).join(" "));
            this.argStack.push(val);
            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // PUSH_REF refName (push a reference name for BYREF)
        // -----------------------------------------------------------------
        if (parts[0] === "PUSH_REF") {
            const refName = parts.slice(1).join(" ");
            this.refStack.push(refName);
            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // ENTER_SCOPE (push a new local scope frame)
        // -----------------------------------------------------------------
        if (parts[0] === "ENTER_SCOPE") {
            this.enterScope();
            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // EXIT_SCOPE (pop the local scope frame)
        // -----------------------------------------------------------------
        if (parts[0] === "EXIT_SCOPE") {
            this.exitScope();
            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // POP_PARAM paramName (pop value from arg stack into local param)
        // -----------------------------------------------------------------
        if (parts[0] === "POP_PARAM") {
            const paramName = parts[1];
            const val = this.argStack.pop();
            this.refStack.pop(); // discard the ref for BYVAL
            const scope = this.currentScope();
            if (scope) {
                scope.locals[paramName] = val;
            }
            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // POP_BYREF paramName (pop value and ref from stacks into local param)
        // -----------------------------------------------------------------
        if (parts[0] === "POP_BYREF") {
            const paramName = parts[1];
            const val = this.argStack.pop();
            const refName = this.refStack.pop();
            const scope = this.currentScope();
            if (scope) {
                scope.locals[paramName] = val;
                scope.byrefMap[paramName] = refName; // remember where to write back
            }
            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // WRITEBACK_BYREF paramName (write local value back to the caller's variable)
        // -----------------------------------------------------------------
        if (parts[0] === "WRITEBACK_BYREF") {
            const paramName = parts[1];
            const scope = this.currentScope();
            if (scope && scope.byrefMap[paramName]) {
                const refName = scope.byrefMap[paramName];
                const val = scope.locals[paramName];
                // Write back to the caller's scope (temporarily pop current scope)
                this.scopeStack.pop();
                this.assignTarget(refName, val);
                this.scopeStack.push(scope);
            }
            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // CALL label
        // -----------------------------------------------------------------
        if (parts[0] === "CALL") {
            const label = parts[1];
            if (!(label in this.labels)) {
                const name = label.replace(/^(FUNC_|PROC_)/, "");
                throw new Error(`Undefined function or procedure: '${name}'. Check spelling and capitalisation.`);
            }
            this.callStack.push(this.pc + 1); // return address
            this.pc = this.labels[label];
            return true;
        }

        // -----------------------------------------------------------------
        // RETVAL value (set return value)
        // -----------------------------------------------------------------
        if (parts[0] === "RETVAL") {
            const val = this.getValue(parts.slice(1).join(" "));
            this.returnValue = val;
            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // RET (return from procedure/function)
        // -----------------------------------------------------------------
        if (parts[0] === "RET") {
            if (this.callStack.length > 0) {
                this.pc = this.callStack.pop();
            } else {
                this.pc++;
            }
            return true;
        }

        // -----------------------------------------------------------------
        // OPENFILE filename mode
        // -----------------------------------------------------------------
        if (parts[0] === "OPENFILE") {
            const filename = String(this.getValue(parts[1]));
            const mode = parts[2]; // READ, WRITE, APPEND

            if (!this.files[filename]) {
                this.files[filename] = { lines: [], readPos: 0, mode: null, open: false };
            }

            const file = this.files[filename];
            file.mode = mode;
            file.open = true;

            if (mode === "WRITE") {
                file.lines = [];
                file.readPos = 0;
            } else if (mode === "APPEND") {
                // Keep existing content, append position at end
            } else if (mode === "READ") {
                file.readPos = 0;
            }

            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // READFILE filename variable
        // -----------------------------------------------------------------
        if (parts[0] === "READFILE") {
            const filename = String(this.getValue(parts[1]));
            const variable = parts[2];

            const file = this.files[filename];
            if (!file || !file.open) {
                throw new Error(`File '${filename}' is not open`);
            }
            if (file.mode !== "READ") {
                throw new Error(`File '${filename}' is not open for reading`);
            }
            if (file.readPos >= file.lines.length) {
                throw new Error(`End of file reached for '${filename}'`);
            }

            const lineData = file.lines[file.readPos];
            file.readPos++;

            // Try to parse as number, otherwise keep as string
            const parsed = parseFloat(lineData);
            const val = isNaN(parsed) ? lineData : parsed;

            this.assignTarget(variable, val);

            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // WRITEFILE filename data
        // -----------------------------------------------------------------
        if (parts[0] === "WRITEFILE") {
            const filename = String(this.getValue(parts[1]));
            const data = this.getValue(parts[2]);

            const file = this.files[filename];
            if (!file || !file.open) {
                throw new Error(`File '${filename}' is not open`);
            }
            if (file.mode !== "WRITE" && file.mode !== "APPEND") {
                throw new Error(`File '${filename}' is not open for writing`);
            }

            file.lines.push(String(data));

            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // CLOSEFILE filename
        // -----------------------------------------------------------------
        if (parts[0] === "CLOSEFILE") {
            const filename = String(this.getValue(parts[1]));

            const file = this.files[filename];
            if (file) {
                file.open = false;
                file.mode = null;
            }

            this.pc++;
            return true;
        }

        // -----------------------------------------------------------------
        // GOTO LABEL
        // -----------------------------------------------------------------
        if (parts[0] === "GOTO") {
            this.pc = this.labels[parts[1]];
            return true;
        }

        // -----------------------------------------------------------------
        // IFZ X GOTO LABEL (jump if zero/false)
        // -----------------------------------------------------------------
        if (parts[0] === "IFZ") {
            const val = this.getValue(parts[1]);
            const label = parts[3];

            if (val === 0 || val === false || val === undefined || val === null) {
                this.pc = this.labels[label];
            } else {
                this.pc++;
            }

            return true;
        }

        // -----------------------------------------------------------------
        // IFNZ X GOTO LABEL (jump if non-zero/true) — used by CASE
        // -----------------------------------------------------------------
        if (parts[0] === "IFNZ") {
            const val = this.getValue(parts[1]);
            const label = parts[3];

            if (val && val !== 0) {
                this.pc = this.labels[label];
            } else {
                this.pc++;
            }

            return true;
        }

        // -----------------------------------------------------------------
        // ASSIGNMENT: X = value | T0 = a op b | T0 = BUILTIN name args...
        // -----------------------------------------------------------------
        if (parts[1] === "=") {
            const target = parts[0];
            let val;

            // Check for BUILTIN call: T0 = BUILTIN NAME arg1 arg2 ...
            if (parts[2] === "BUILTIN") {
                const builtinName = parts[3];
                const rawArgStr = line.substring(line.indexOf(builtinName) + builtinName.length).trim();
                const builtinArgs = this.parseBuiltinArgs(rawArgStr);
                val = this.executeBuiltin(builtinName, builtinArgs);
            }
            // Check for RETVAL assignment: T0 = RETVAL
            else if (parts.length === 3 && parts[2] === "RETVAL") {
                val = this.returnValue;
            }
            // Use token-aware parsing for everything else
            else {
                // Parse the right-hand side respecting quoted strings
                const rhsStr = line.substring(line.indexOf("=") + 1).trim();
                const rhsTokens = this.tokenizeRHS(rhsStr);

                if (rhsTokens.length === 1) {
                    // Simple assignment: X = Y or X = "string value"
                    val = this.getValue(rhsTokens[0]);
                } else if (rhsTokens.length === 3) {
                    // Binary op: T0 = a op b
                    const left = this.getValue(rhsTokens[0]);
                    const op = rhsTokens[1];
                    const right = this.getValue(rhsTokens[2]);

                    switch (op) {
                        case "+":
                            if (typeof left === 'string' || typeof right === 'string') {
                                val = String(left) + String(right);
                            } else {
                                val = left + right;
                            }
                            break;
                        case "-": val = left - right; break;
                        case "*": val = left * right; break;
                        case "/": val = left / right; break;
                        case "DIV": val = Math.trunc(left / right); break;
                        case "MOD": val = left % right; break;
                        case "^": val = Math.pow(left, right); break;

                        case "&":
                            val = String(left) + String(right);
                            break;

                        case "==": val = (left == right ? 1 : 0); break;
                        case "!=": val = (left != right ? 1 : 0); break;
                        case "<":  val = (left < right  ? 1 : 0); break;
                        case ">":  val = (left > right  ? 1 : 0); break;
                        case "<=": val = (left <= right ? 1 : 0); break;
                        case ">=": val = (left >= right ? 1 : 0); break;

                        case "&&": val = (left && right ? 1 : 0); break;
                        case "||": val = (left || right ? 1 : 0); break;

                        default:
                            throw new Error(`Unknown operator: ${op}`);
                    }
                } else {
                    throw new Error(`Cannot parse assignment: ${line}`);
                }
            }

            this.assignTarget(target, val);

            this.pc++;
            return true;
        }

        throw new Error(`Unknown instruction: ${line}`);
    }

    // ------------------------------------------
    // Built-in function execution
    // ------------------------------------------

    // Tokenize a right-hand side expression, respecting quoted strings
    // e.g. '"Hello World" & X' -> ['"Hello World"', '&', 'X']
    tokenizeRHS(str) {
        const tokens = [];
        let i = 0;
        while (i < str.length) {
            while (i < str.length && str[i] === ' ') i++;
            if (i >= str.length) break;

            if (str[i] === '"') {
                let j = i + 1;
                while (j < str.length && str[j] !== '"') j++;
                tokens.push(str.substring(i, j + 1));
                i = j + 1;
            } else {
                let j = i;
                while (j < str.length && str[j] !== ' ') j++;
                tokens.push(str.substring(i, j));
                i = j;
            }
        }
        return tokens;
    }

    // Parse space-separated arguments, respecting quoted strings
    parseBuiltinArgs(str) {
        if (!str) return [];
        const args = [];
        let i = 0;
        while (i < str.length) {
            // Skip whitespace
            while (i < str.length && str[i] === ' ') i++;
            if (i >= str.length) break;

            if (str[i] === '"') {
                // Quoted string: find matching end quote
                let j = i + 1;
                while (j < str.length && str[j] !== '"') j++;
                args.push(str.substring(i, j + 1)); // include quotes
                i = j + 1;
            } else {
                // Non-quoted token
                let j = i;
                while (j < str.length && str[j] !== ' ') j++;
                args.push(str.substring(i, j));
                i = j;
            }
        }
        return args;
    }

    executeBuiltin(name, rawArgs) {
        const args = rawArgs.map(a => this.getValue(a));

        switch (name) {
            // --- String functions ---
            case "LENGTH":
                return String(args[0]).length;

            case "LCASE":
            case "TO_LOWER":
                return String(args[0]).toLowerCase();

            case "UCASE":
            case "TO_UPPER":
                return String(args[0]).toUpperCase();

            case "MID": {
                // MID(s, start, length) — CIE uses 1-based indexing
                const s = String(args[0]);
                const start = Math.floor(args[1]) - 1; // convert to 0-based
                const len = Math.floor(args[2]);
                return s.substring(start, start + len);
            }

            case "LEFT": {
                const s = String(args[0]);
                const n = Math.floor(args[1]);
                return s.substring(0, n);
            }

            case "RIGHT": {
                const s = String(args[0]);
                const n = Math.floor(args[1]);
                return s.substring(s.length - n);
            }

            // --- Numeric functions ---
            case "INT":
                return Math.trunc(args[0]);

            case "RAND":
                return Math.floor(Math.random() * (Math.floor(args[0]) + 1));

            // --- Conversion functions ---
            case "NUM_TO_STR":
                return String(args[0]);

            case "STR_TO_NUM": {
                const parsed = parseFloat(args[0]);
                if (isNaN(parsed)) {
                    throw new Error(`STR_TO_NUM: cannot convert '${args[0]}' to a number`);
                }
                return parsed;
            }

            case "CHR":
                return String.fromCharCode(Math.floor(args[0]));

            case "ASC":
                return String(args[0]).charCodeAt(0);

            // --- File functions ---
            case "EOF": {
                const filename = String(args[0]);
                const file = this.files[filename];
                if (!file || !file.open) {
                    return 1; // treat as EOF if file doesn't exist or isn't open
                }
                return file.readPos >= file.lines.length ? 1 : 0;
            }

            default:
                throw new Error(`Unknown built-in function: ${name}`);
        }
    }

    // ------------------------------------------
    // Run until completion
    // ------------------------------------------

    run() {
        let safety = 0;
        const MAX_STEPS = 10000000;

        while (this.step()) {
            safety++;
            if (safety > MAX_STEPS) {
                throw new Error("Infinite loop detected (exceeded 10,000,000 steps)");
            }
        }

        return {
            vars: this.globals,
            output: this.output
        };
    }

    // ------------------------------------------
    // Async step (for terminal mode)
    // ------------------------------------------

    async stepAsync() {
        const result = this.step();

        if (result === 'WAIT_INPUT' && this.pendingInput) {
            const { target } = this.pendingInput;

            let varName = target;
            if (target.includes('[')) {
                const match = target.match(/^(\w+)\[/);
                if (match) varName = match[1];
            }

            const value = await this.readInput(varName);

            this.assignTarget(target, value);

            this.pendingInput = null;
            this.pc++;
            return true;
        }

        return result;
    }

    // ------------------------------------------
    // Async run (for terminal mode)
    // ------------------------------------------

    halt() {
        this.halted = true;
    }

    async runAsync() {
        let safety = 0;
        const MAX_STEPS = 10000000;
        const YIELD_EVERY = 1000; // yield to browser every N steps

        while (true) {
            if (this.halted) {
                throw new Error("Program stopped by user");
            }

            const result = await this.stepAsync();
            if (!result) break;

            safety++;
            if (safety > MAX_STEPS) {
                throw new Error("Infinite loop detected (exceeded 10,000,000 steps)");
            }

            // Yield to the browser periodically so UI can repaint
            if (safety % YIELD_EVERY === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return {
            vars: this.globals,
            output: this.output
        };
    }
}
