// ============================================================
// OPTIMIZER
// ============================================================
// Depends on: nothing
//
// Performs simple optimizations:
//   - Constant folding:  T0 = 2 + 3   →   T0 = 5
//   - Removes dead temporaries

class Optimizer {

    constructor(instructions) {
        this.instructions = instructions;
    }

    // ------------------------------------------
    // CONSTANT FOLDING
    // ------------------------------------------

    constantFold(instr) {
        const parts = instr.split(" ");

        // Expected:  T0 = a op b
        if (parts.length === 5 && parts[1] === "=") {
            const left = parts[2];
            const op = parts[3];
            const right = parts[4];

            // Check numeric constants
            if (!isNaN(left) && !isNaN(right)) {
                const a = parseFloat(left);
                const b = parseFloat(right);

                switch (op) {
                    case "+": return `${parts[0]} = ${a + b}`;
                    case "-": return `${parts[0]} = ${a - b}`;
                    case "*": return `${parts[0]} = ${a * b}`;
                    case "/": return `${parts[0]} = ${a / b}`;       // Real division
                    case "DIV": return `${parts[0]} = ${Math.trunc(a / b)}`; // Integer division
                    case "MOD": return `${parts[0]} = ${a % b}`;     // Modulo
                    case "^": return `${parts[0]} = ${Math.pow(a, b)}`;
                    default: return instr; // non-arithmetic op (comparisons etc.) — leave as-is
                }
            }
        }

        return instr;
    }

    // ------------------------------------------
    // DEAD CODE REMOVAL
    // ------------------------------------------

    deadCodeEliminate(instructions) {
        const used = new Set();

        // Find all temps referenced (not as assignment target)
        for (const line of instructions) {
            const parts = line.split(" ");
            for (let i = 0; i < parts.length; i++) {
                const p = parts[i];
                if (p.startsWith("T") && /^T\d+$/.test(p) && i !== 0) {
                    used.add(p);
                }
                // Also check inside array brackets and OUTPUT etc.
                if (p.includes("[")) {
                    const match = p.match(/T\d+/g);
                    if (match) match.forEach(m => used.add(m));
                }
            }
        }

        // Keep only assignments where the target temp is actually used
        const result = [];

        for (const line of instructions) {
            const parts = line.split(" ");

            if (parts.length >= 3 && /^T\d+$/.test(parts[0]) && parts[1] === "=") {
                const temp = parts[0];

                if (used.has(temp)) {
                    result.push(line);
                }
                // else: dead temp, remove
            } else {
                result.push(line);
            }
        }

        return result;
    }

    // ------------------------------------------
    // APPLY ALL OPTIMIZATIONS
    // ------------------------------------------

    optimize() {
        const folded = this.instructions.map(i =>
            i.endsWith(":") ? i : this.constantFold(i)
        );

        return this.deadCodeEliminate(folded);
    }
}
