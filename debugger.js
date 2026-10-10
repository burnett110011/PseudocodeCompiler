// ============================================================
// DEBUGGER
// ============================================================
// Depends on: runtime.js (Runtime)

class Debugger {
    constructor(instructions = []) {
        this.instructions = instructions.slice();
        this.breakpoints = new Set();
        this.runtime = null;
    }

    load(instructions) {
        this.instructions = instructions.slice();
        this.breakpoints.clear();
        this.runtime = null;
    }

    addBreakpoint(index) {
        if (index >= 0 && index < this.instructions.length) {
            this.breakpoints.add(index);
        }
    }

    removeBreakpoint(index) {
        this.breakpoints.delete(index);
    }

    clearBreakpoints() {
        this.breakpoints.clear();
    }

    start() {
        this.runtime = new Runtime(this.instructions);
        return this.state();
    }

    isFinished() {
        if (!this.runtime) return true;
        return this.runtime.pc >= this.instructions.length;
    }

    currentInstruction() {
        if (!this.runtime) return null;
        return this.instructions[this.runtime.pc] ?? null;
    }

    step() {
        if (!this.runtime) this.start();
        if (this.isFinished()) return this.state();

        this.runtime.step();
        return this.state();
    }

    continue() {
        if (!this.runtime) this.start();
        while (!this.isFinished()) {
            if (this.breakpoints.has(this.runtime.pc)) break;
            this.runtime.step();
        }
        return this.state();
    }

    state() {
        const pc = this.runtime ? this.runtime.pc : 0;
        const instr = this.runtime ? (this.instructions[pc] ?? null) : null;
        const vars = this.runtime ? { ...this.runtime.vars } : {};
        const output = this.runtime ? this.runtime.output.slice() : [];

        return {
            pc,
            instruction: instr,
            vars,
            output,
            breakpoints: Array.from(this.breakpoints),
            code: this.instructions.slice()
        };
    }
}
