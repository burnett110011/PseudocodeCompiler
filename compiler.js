// ============================================================
// COMPILER CONTEXT
// ============================================================
// Depends on: nothing

class CompilerContext {
    constructor({ debug = false } = {}) {
        this.debug = !!debug;
        this.logs = [];
    }

    log(msg) {
        if (this.debug) {
            this.logs.push(String(msg));
        }
    }

    getLogs() {
        return this.logs.slice();
    }

    clearLogs() {
        this.logs = [];
    }
}


// ============================================================
// COMPILER PIPELINE
// ============================================================
// Depends on: lexer.js, parser.js, semantic.js, ir-generator.js, optimizer.js, runtime.js, debugger.js

class Compiler {
    constructor({ optimize = true, debug = false } = {}) {
        this.optimizeEnabled = !!optimize;
        this.ctx = new CompilerContext({ debug });
    }

    // ---------------- LEXING ----------------
    lex(source) {
        this.ctx.log("LEX: start");
        const lexer = new Lexer(source);
        const tokens = lexer.tokenize();
        this.ctx.log(`LEX: produced ${tokens.length} tokens`);
        return tokens;
    }

    // ---------------- PARSING ----------------
    parse(tokens) {
        this.ctx.log("PARSE: start");
        const parser = new Parser(tokens);
        const ast = parser.parseProgram();
        this.ctx.log("PARSE: AST built");
        return ast;
    }

    // ---------------- SEMANTIC ----------------
    analyze(ast) {
        this.ctx.log("SEMANTIC: start");
        const sema = new SemanticAnalyzer();
        sema.analyze(ast);
        this.ctx.log("SEMANTIC: ok");
    }

    // ---------------- IR GEN ----------------
    generate(ast) {
        this.ctx.log("IR: generation start");
        const irgen = new IRGenerator();
        const ir = irgen.generate(ast);
        this.ctx.log(`IR: ${ir.length} instructions`);
        return ir;
    }

    // ---------------- OPTIMIZE ----------------
    optimise(ir) {
        if (!this.optimizeEnabled) {
            this.ctx.log("OPT: disabled");
            return ir;
        }
        this.ctx.log("OPT: start");
        const opt = new Optimizer(ir).optimize();
        this.ctx.log(`OPT: ${ir.length} → ${opt.length} instructions`);
        return opt;
    }

    // ---------------- EXECUTE ----------------
    execute(ir) {
        this.ctx.log("RUN: start");
        const runtime = new Runtime(ir);
        const result = runtime.run();
        this.ctx.log("RUN: finished");
        return result;
    }

    // ---------------- ONE-SHOT ----------------
    compile(source) {
        const tokens = this.lex(source);
        const ast = this.parse(tokens);
        this.analyze(ast);
        const ir = this.generate(ast);
        const finalIR = this.optimise(ir);
        return { tokens, ast, ir: finalIR };
    }

    run(source) {
        const { ir } = this.compile(source);
        const result = this.execute(ir);
        return { ir, result, logs: this.ctx.getLogs() };
    }

    debug(source) {
        const { ir } = this.compile(source);
        const dbg = new Debugger(ir);
        return { ir, debugger: dbg, logs: this.ctx.getLogs() };
    }
}


// ============================================================
// CONVENIENCE HELPERS
// ============================================================

function compileToIR(source, { optimize = true, debug = false } = {}) {
    const compiler = new Compiler({ optimize, debug });
    const { ir } = compiler.compile(source);
    return { ir, logs: compiler.ctx.getLogs() };
}

function runProgram(source, { optimize = true, debug = false } = {}) {
    const compiler = new Compiler({ optimize, debug });
    const { ir, result, logs } = compiler.run(source);
    return { ir, vars: result.vars, output: result.output, logs };
}

function debugProgram(source, { optimize = true, debug = false } = {}) {
    const compiler = new Compiler({ optimize, debug });
    const { ir, debugger: dbg, logs } = compiler.debug(source);
    return { ir, debugger: dbg, logs };
}
