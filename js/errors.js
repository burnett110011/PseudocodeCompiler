// ============================================================
// DIAGNOSTICS
// ============================================================
// Depends on: nothing
//
// Every compile-time problem (lexical, syntax, semantic) is described by a
// Diagnostic: { phase, message, line, col, length, hint }.
// A CompileError carries one or more of them, so the UI can show every
// problem found in a single run instead of stopping at the first.

class CompileError extends Error {
    constructor(diagnostics, source = "") {
        const list = Array.isArray(diagnostics) ? diagnostics : [diagnostics];
        super(CompileError.summarise(list));
        this.name = "CompileError";
        this.diagnostics = list;
        this.source = source;
    }

    static summarise(list) {
        const lines = list.map(d => formatDiagnosticOneLine(d));
        if (list.length > 1) lines.push(`${list.length} errors found.`);
        return lines.join("\n");
    }
}

const PHASE_LABELS = {
    lexical: "Lexical error",
    syntax: "Syntax error",
    semantic: "Error"
};

function formatDiagnosticOneLine(d) {
    const label = PHASE_LABELS[d.phase] || "Error";
    const where = d.line ? ` at line ${d.line}${d.col ? `, col ${d.col}` : ""}` : "";
    return `${label}${where}: ${d.message}` + (d.hint ? ` (${d.hint})` : "");
}

// Multi-line report for one diagnostic: header, the source line, a caret
// underline, then the hint. Returns an array of lines.
function formatDiagnosticLines(d, sourceLines) {
    const label = PHASE_LABELS[d.phase] || "Error";
    const where = d.line ? ` at line ${d.line}${d.col ? `, col ${d.col}` : ""}` : "";
    const out = [`${label}${where}: ${d.message}`];

    const text = d.line && sourceLines ? sourceLines[d.line - 1] : undefined;
    if (text !== undefined) {
        const gutter = String(d.line).padStart(4) + " | ";
        out.push(gutter + text.replace(/\t/g, " "));
        if (d.col) {
            const len = Math.max(1, Math.min(d.length || 1, Math.max(1, text.length - d.col + 1)));
            out.push(" ".repeat(gutter.length - 2) + "| " + " ".repeat(d.col - 1) + "^".repeat(len));
        }
    }
    if (d.hint) out.push("  hint: " + d.hint);
    return out;
}

// ------------------------------------------------------------
// "Did you mean ...?" helper
// ------------------------------------------------------------

function editDistance(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 3) return 99;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
            cur[j] = Math.min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        prev = cur;
    }
    return prev[n];
}

// Best match for `name` among `candidates`, or null. Case differences are
// checked first because names in this language are case-sensitive.
function suggestName(name, candidates) {
    const lower = name.toLowerCase();
    let best = null;
    let bestScore = Infinity;
    for (const c of candidates) {
        if (c === name) continue;
        if (c.toLowerCase() === lower) return c;
        const d = editDistance(lower, c.toLowerCase());
        const limit = name.length <= 3 ? 1 : 2;
        if (d <= limit && d < bestScore) {
            best = c;
            bestScore = d;
        }
    }
    return best;
}
