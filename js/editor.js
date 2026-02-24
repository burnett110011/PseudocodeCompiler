// ============================================================
// SYNTAX-HIGHLIGHTED CODE EDITOR
// ============================================================
// Depends on: tokens.js (for keyword list reference)
//
// Provides a custom code editor with:
//   - Syntax highlighting (keywords, strings, comments, numbers, types)
//   - Line numbers
//   - Auto-indentation
//   - Error line highlighting
//   - Synchronised scrolling between textarea and highlight overlay

class PseudocodeEditor {

    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.errorLine = -1;

        // CIE pseudocode language definitions
        this.keywords = new Set([
            "DECLARE", "CONSTANT", "IF", "THEN", "ELSE", "ENDIF",
            "WHILE", "DO", "ENDWHILE", "FOR", "TO", "STEP", "NEXT",
            "OUTPUT", "INPUT", "REPEAT", "UNTIL",
            "CASE", "OF", "ENDCASE", "OTHERWISE",
            "ARRAY", "PROCEDURE", "ENDPROCEDURE",
            "FUNCTION", "ENDFUNCTION", "CALL", "RETURN", "RETURNS",
            "BYREF", "BYVAL", "AND", "OR", "NOT", "DIV", "MOD",
            "OPENFILE", "READFILE", "WRITEFILE", "CLOSEFILE",
            "TYPE", "ENDTYPE",
            "TRUE", "FALSE"
        ]);

        this.types = new Set([
            "INTEGER", "REAL", "STRING", "BOOLEAN", "CHAR",
            "READ", "WRITE", "APPEND"
        ]);

        this.builtins = new Set([
            "LENGTH", "LCASE", "UCASE", "MID", "LEFT", "RIGHT",
            "TO_UPPER", "TO_LOWER", "INT", "RAND",
            "NUM_TO_STR", "STR_TO_NUM", "CHR", "ASC", "EOF"
        ]);

        // Indentation rules
        this.indentKeywords = new Set([
            "IF", "WHILE", "FOR", "REPEAT", "CASE", "PROCEDURE", "FUNCTION", "OTHERWISE", "TYPE"
        ]);
        this.dedentKeywords = new Set([
            "ENDIF", "ENDWHILE", "NEXT", "UNTIL", "ENDCASE",
            "ENDPROCEDURE", "ENDFUNCTION", "ENDTYPE", "ELSE", "OTHERWISE"
        ]);

        this.build();
        this.attachEvents();
    }

    // ------------------------------------------
    // Build DOM structure
    // ------------------------------------------

    build() {
        this.container.innerHTML = '';
        this.container.className = 'psc-editor-container';

        // Line numbers gutter
        this.gutter = document.createElement('div');
        this.gutter.className = 'psc-gutter';
        this.container.appendChild(this.gutter);

        // Editor area (textarea + highlight overlay)
        const editorArea = document.createElement('div');
        editorArea.className = 'psc-editor-area';

        // Highlighted code (behind the textarea)
        this.highlight = document.createElement('pre');
        this.highlight.className = 'psc-highlight';
        this.highlight.setAttribute('aria-hidden', 'true');
        editorArea.appendChild(this.highlight);

        // Transparent textarea (on top)
        this.textarea = document.createElement('textarea');
        this.textarea.className = 'psc-textarea';
        this.textarea.spellcheck = false;
        this.textarea.autocomplete = 'off';
        this.textarea.autocapitalize = 'off';
        this.textarea.setAttribute('autocorrect', 'off');
        this.textarea.wrap = 'off';
        editorArea.appendChild(this.textarea);

        this.container.appendChild(editorArea);
    }

    // ------------------------------------------
    // Event handlers
    // ------------------------------------------

    attachEvents() {
        // Update highlighting on input
        this.textarea.addEventListener('input', () => this.update());

        // Sync scroll
        this.textarea.addEventListener('scroll', () => this.syncScroll());

        // Tab key handling + auto-indent on Enter
        this.textarea.addEventListener('keydown', (e) => this.handleKeydown(e));

        // On iOS/iPadOS the transparent textarea can miss touch-to-focus.
        // Tapping anywhere in the editor area explicitly focuses the textarea.
        this.container.addEventListener('touchstart', (e) => {
            // Don't steal focus from the textarea itself or the gutter
            if (e.target !== this.textarea) {
                this.textarea.focus();
            }
        }, { passive: true });

        // Initial render
        requestAnimationFrame(() => this.update());
    }

    handleKeydown(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            this.handleTab(e.shiftKey);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.handleEnter();
        } else if (e.key === 'Backspace') {
            if (this.handleBackspace()) {
                e.preventDefault();
            }
        }
    }

    handleTab(shift) {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const value = this.textarea.value;

        if (shift) {
            // Dedent: remove up to 4 leading spaces from current line
            const before = value.substring(0, start);
            const lineStart = before.lastIndexOf('\n') + 1;
            const lineText = value.substring(lineStart);

            if (lineText.startsWith('    ')) {
                this.textarea.value = value.substring(0, lineStart) +
                    lineText.substring(4);
                this.textarea.selectionStart = Math.max(lineStart, start - 4);
                this.textarea.selectionEnd = Math.max(lineStart, end - 4);
            }
        } else {
            // Indent: insert 4 spaces
            this.textarea.value = value.substring(0, start) + '    ' + value.substring(end);
            this.textarea.selectionStart = this.textarea.selectionEnd = start + 4;
        }

        this.update();
    }

    handleEnter() {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const value = this.textarea.value;

        // Find current line
        const before = value.substring(0, start);
        const lineStart = before.lastIndexOf('\n') + 1;
        const currentLine = before.substring(lineStart);

        // Get current indentation
        const indentMatch = currentLine.match(/^(\s*)/);
        let indent = indentMatch ? indentMatch[1] : '';

        const trimmed = currentLine.trim().toUpperCase();
        const firstWord = trimmed.split(/\s/)[0];

        if (this.dedentKeywords.has(firstWord)) {
            // Line is a closing keyword — next line stays at the same (already-reduced) indent
            // but we also auto-reduce the current line's indent by one level if it's over-indented
            if (indent.length >= 4) {
                // Rewrite the current line with one less indent level
                const correctIndent = indent.substring(4);
                const rest = value.substring(lineStart);           // from line start to EOF
                const lineEnd = rest.indexOf('\n');
                const restOfLine = lineEnd === -1 ? rest : rest.substring(0, lineEnd);
                const afterLine = lineEnd === -1 ? '' : rest.substring(lineEnd);

                const newLineContent = correctIndent + restOfLine.trimStart();
                this.textarea.value = value.substring(0, lineStart) + newLineContent + afterLine;

                // Recalculate start position after rewrite
                const newStart = lineStart + newLineContent.length;
                indent = correctIndent;

                const insertion = '\n' + indent;
                const finalPos = lineStart + newLineContent.length + insertion.length;
                this.textarea.value = value.substring(0, lineStart) + newLineContent +
                    insertion + afterLine.substring(afterLine.startsWith('\n') ? 1 : 0);
                this.textarea.selectionStart = this.textarea.selectionEnd = finalPos;
                this.update();
                return;
            }
        } else if (this.indentKeywords.has(firstWord) ||
                   trimmed.endsWith('THEN') || trimmed.endsWith('DO') || trimmed.endsWith('ELSE')) {
            // Opening keyword — indent the next line one level deeper
            indent += '    ';
        }

        // Insert newline with indentation
        const insertion = '\n' + indent;
        const newPos = start + insertion.length;
        this.textarea.value = value.substring(0, start) + insertion + value.substring(end);
        this.textarea.selectionStart = this.textarea.selectionEnd = newPos;

        this.update();
    }

    handleBackspace() {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;

        // Only intercept when there is no selection (plain cursor)
        if (start !== end) return false;

        const value = this.textarea.value;
        const before = value.substring(0, start);
        const lineStart = before.lastIndexOf('\n') + 1;
        const cursorCol = start - lineStart;          // 0-based column within line
        const leadingText = before.substring(lineStart); // text from line start to cursor

        // Only act when cursor is sitting inside (or just after) leading whitespace
        if (!/^ +$/.test(leadingText)) return false;

        // Snap back to the previous multiple-of-4 indent level
        const spaces = leadingText.length;
        const remove = spaces % 4 === 0 ? 4 : spaces % 4;

        // Don't remove more spaces than exist
        if (spaces < remove) return false;

        this.textarea.value = value.substring(0, start - remove) + value.substring(start);
        this.textarea.selectionStart = this.textarea.selectionEnd = start - remove;
        this.update();
        return true;    // tell caller to preventDefault
    }

    // ------------------------------------------
    // Syntax highlighting
    // ------------------------------------------

    highlightLine(line) {
        if (!line) return '';

        let result = '';
        let i = 0;

        while (i < line.length) {
            // Comments
            if (line[i] === '/' && line[i + 1] === '/') {
                result += '<span class="psc-comment">' + this.escapeHTML(line.substring(i)) + '</span>';
                break;
            }

            // Strings (double or single quotes)
            if (line[i] === '"' || line[i] === "'") {
                const quote = line[i];
                let j = i + 1;
                while (j < line.length && line[j] !== quote) {
                    if (line[j] === '\\') j++; // skip escaped chars
                    j++;
                }
                if (j < line.length) j++; // include closing quote
                result += '<span class="psc-string">' + this.escapeHTML(line.substring(i, j)) + '</span>';
                i = j;
                continue;
            }

            // Numbers
            if (/[0-9]/.test(line[i])) {
                let j = i;
                while (j < line.length && /[0-9.]/.test(line[j])) j++;
                result += '<span class="psc-number">' + this.escapeHTML(line.substring(i, j)) + '</span>';
                i = j;
                continue;
            }

            // Identifiers / Keywords
            if (/[A-Za-z_]/.test(line[i])) {
                let j = i;
                while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
                const word = line.substring(i, j);
                const upper = word.toUpperCase();

                if (this.keywords.has(upper)) {
                    result += '<span class="psc-keyword">' + this.escapeHTML(word) + '</span>';
                } else if (this.types.has(upper)) {
                    result += '<span class="psc-type">' + this.escapeHTML(word) + '</span>';
                } else if (this.builtins.has(upper)) {
                    result += '<span class="psc-builtin">' + this.escapeHTML(word) + '</span>';
                } else {
                    result += this.escapeHTML(word);
                }
                i = j;
                continue;
            }

            // Operators
            if (line[i] === '<' && line[i + 1] === '-') {
                result += '<span class="psc-operator">' + '&lt;-' + '</span>';
                i += 2;
                continue;
            }
            if (line[i] === '<' && line[i + 1] === '>') {
                result += '<span class="psc-operator">' + '&lt;&gt;' + '</span>';
                i += 2;
                continue;
            }
            if (line[i] === '<' && line[i + 1] === '=') {
                result += '<span class="psc-operator">&lt;=</span>';
                i += 2;
                continue;
            }
            if (line[i] === '>' && line[i + 1] === '=') {
                result += '<span class="psc-operator">&gt;=</span>';
                i += 2;
                continue;
            }
            if ('<>=+-*/^&'.includes(line[i])) {
                result += '<span class="psc-operator">' + this.escapeHTML(line[i]) + '</span>';
                i++;
                continue;
            }

            // Everything else
            result += this.escapeHTML(line[i]);
            i++;
        }

        return result;
    }

    escapeHTML(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // ------------------------------------------
    // Update display
    // ------------------------------------------

    update() {
        const code = this.textarea.value;
        const lines = code.split('\n');

        // Preserve scroll position — setting innerHTML resets it
        const scrollTop = this.textarea.scrollTop;
        const scrollLeft = this.textarea.scrollLeft;

        // Update syntax highlighting.
        // Each line is highlighted text joined with '\n' (NOT inside spans).
        // The error-span wraps only the text, not the newline, so line heights stay uniform.
        const parts = [];
        for (let i = 0; i < lines.length; i++) {
            const highlighted = this.highlightLine(lines[i]);
            if (i === this.errorLine) {
                parts.push('<span class="psc-error-line">' + highlighted + '</span>');
            } else {
                parts.push(highlighted);
            }
        }
        this.highlight.innerHTML = parts.join('\n');

        // Update line numbers
        let gutterHTML = '';
        for (let i = 1; i <= lines.length; i++) {
            const errorClass = (i - 1 === this.errorLine) ? ' psc-gutter-error' : '';
            gutterHTML += '<div class="psc-line-number' + errorClass + '">' + i + '</div>';
        }
        this.gutter.innerHTML = gutterHTML;

        // Restore scroll position
        this.highlight.scrollTop = scrollTop;
        this.highlight.scrollLeft = scrollLeft;
        this.gutter.scrollTop = scrollTop;
    }

    syncScroll() {
        this.highlight.scrollTop = this.textarea.scrollTop;
        this.highlight.scrollLeft = this.textarea.scrollLeft;
        this.gutter.scrollTop = this.textarea.scrollTop;
    }

    // ------------------------------------------
    // Public API
    // ------------------------------------------

    getValue() {
        return this.textarea.value;
    }

    setValue(code) {
        this.textarea.value = code;
        this.update();
    }

    setErrorLine(lineNumber) {
        // lineNumber is 1-based, -1 to clear
        this.errorLine = lineNumber > 0 ? lineNumber - 1 : -1;
        this.update();
    }

    clearError() {
        this.errorLine = -1;
        this.update();
    }

    focus() {
        this.textarea.focus();
    }
}
