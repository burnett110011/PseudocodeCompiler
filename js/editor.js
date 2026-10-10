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
        this.errorLines = new Set(); // 0-based line indexes to flag

        // Undo/redo history: a stack of {value, start, end} snapshots.
        // Rapid consecutive edits (plain typing) are coalesced into a single
        // undo step; structural edits (Tab/Enter/Backspace) always start a new one.
        this.history = [];
        this.historyIndex = -1;
        this.isUndoRedo = false;
        this.lastRecordTime = 0;
        this.groupTimeoutMs = 500;
        this.maxHistory = 500;
        this.onHistoryChange = null; // optional callback(editor) for UI hookup

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
            "IF", "WHILE", "FOR", "REPEAT", "CASE", "PROCEDURE", "FUNCTION", "TYPE"
        ]);
        this.dedentKeywords = new Set([
            "ENDIF", "ENDWHILE", "NEXT", "UNTIL", "ENDCASE",
            "ENDPROCEDURE", "ENDFUNCTION", "ENDTYPE", "ELSE"
        ]);
        // ELSE dedents itself back to its IF's level, but (unlike a true closer
        // such as ENDIF) its own body is then indented again, so the line after
        // it should return to the pre-dedent level.
        // OTHERWISE is deliberately in neither set: it sits at the same level as
        // the CASE values and its body follows on the same line.
        this.reopenKeywords = new Set(["ELSE"]);

        this.build();
        this.attachEvents();
        this.resetHistory();
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
        this.textarea.addEventListener('input', () => {
            this.update();
            this.pushHistory();
        });

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

        // Other ways the text can change without a reliable 'input' event
        // (drag-drop, IME, cut/paste, browser-native undo, autofill).
        for (const evt of ['change', 'paste', 'cut', 'drop', 'compositionend', 'keyup', 'select']) {
            this.textarea.addEventListener(evt, () => this.ensureSynced());
        }
        // Drop/paste/cut apply their change after the event fires
        for (const evt of ['paste', 'cut', 'drop']) {
            this.textarea.addEventListener(evt, () => setTimeout(() => this.ensureSynced(), 0));
        }

        // Safety net: if the overlay ever drifts from the textarea, repaint it.
        // Comparing two strings per frame is negligible.
        const watch = () => {
            this.ensureSynced();
            requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
    }

    // Repaint the highlight layer if it no longer reflects the textarea
    ensureSynced() {
        if (this.renderedValue !== this.textarea.value) {
            this.update();
            this.pushHistory();
        }
    }

    handleKeydown(e) {
        const mod = e.ctrlKey || e.metaKey;

        if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            this.undo();
        } else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
            e.preventDefault();
            this.redo();
        } else if (e.key === 'Tab') {
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
        this.pushHistory(true);
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

        if (this.dedentKeywords.has(firstWord) && indent.length >= 4) {
            // Closing keyword — dedent the current line by one level, then
            // actually insert a new line at that same (reduced) level.
            const correctIndent = indent.substring(4);
            const lineEndRel = value.indexOf('\n', end);
            const lineEnd = lineEndRel === -1 ? value.length : lineEndRel;

            const textBeforeCursor = value.substring(lineStart, start).trimStart();
            const textAfterCursor = value.substring(end, lineEnd);
            const restOfFile = value.substring(lineEnd);

            const newLineIndent = this.reopenKeywords.has(firstWord) ? indent : correctIndent;
            const newCurrentLine = correctIndent + textBeforeCursor;
            const insertion = '\n' + newLineIndent;

            this.textarea.value = value.substring(0, lineStart) + newCurrentLine +
                insertion + textAfterCursor + restOfFile;
            this.textarea.selectionStart = this.textarea.selectionEnd =
                lineStart + newCurrentLine.length + insertion.length;
            this.update();
            this.pushHistory(true);
            return;
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
        this.pushHistory(true);
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
        this.pushHistory(true);
        return true;    // tell caller to preventDefault
    }

    // ------------------------------------------
    // Undo / redo history
    // ------------------------------------------

    snapshot() {
        return {
            value: this.textarea.value,
            start: this.textarea.selectionStart,
            end: this.textarea.selectionEnd
        };
    }

    resetHistory() {
        this.history = [this.snapshot()];
        this.historyIndex = 0;
        this.lastRecordTime = 0;
        this.notifyHistoryChange();
    }

    // Records the current textarea state as an undo step. Consecutive calls
    // within groupTimeoutMs are coalesced into the same step (so a burst of
    // typing undoes as one unit); pass forceNewGroup for discrete edits
    // (Tab/Enter/Backspace) that should always be their own undo step.
    pushHistory(forceNewGroup = false) {
        if (this.isUndoRedo) return;

        const snap = this.snapshot();
        const last = this.history[this.historyIndex];
        if (last && last.value === snap.value) return; // nothing actually changed

        const now = Date.now();
        const withinGroup = !forceNewGroup && last && (now - this.lastRecordTime) < this.groupTimeoutMs;

        if (withinGroup) {
            this.history[this.historyIndex] = snap;
        } else {
            this.history = this.history.slice(0, this.historyIndex + 1);
            this.history.push(snap);
            this.historyIndex++;
            if (this.history.length > this.maxHistory) {
                this.history.shift();
                this.historyIndex--;
            }
        }

        this.lastRecordTime = now;
        this.notifyHistoryChange();
    }

    notifyHistoryChange() {
        if (this.onHistoryChange) this.onHistoryChange(this);
    }

    canUndo() {
        return this.historyIndex > 0;
    }

    canRedo() {
        return this.historyIndex < this.history.length - 1;
    }

    restoreSnapshot(entry) {
        this.isUndoRedo = true;
        this.textarea.value = entry.value;
        this.textarea.selectionStart = entry.start;
        this.textarea.selectionEnd = entry.end;
        this.update();
        this.isUndoRedo = false;
        this.lastRecordTime = 0; // next edit should start a fresh undo group
    }

    undo() {
        if (!this.canUndo()) return;
        this.historyIndex--;
        this.restoreSnapshot(this.history[this.historyIndex]);
        this.notifyHistoryChange();
    }

    redo() {
        if (!this.canRedo()) return;
        this.historyIndex++;
        this.restoreSnapshot(this.history[this.historyIndex]);
        this.notifyHistoryChange();
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
            if (this.errorLines.has(i)) {
                parts.push('<span class="psc-error-line">' + highlighted + '</span>');
            } else {
                parts.push(highlighted);
            }
        }
        // Trailing newline keeps the pre's scroll height equal to the textarea's
        // when the code ends in an empty line.
        this.highlight.innerHTML = parts.join('\n') + '\n';
        this.renderedValue = code;

        // Update line numbers
        let gutterHTML = '';
        for (let i = 1; i <= lines.length; i++) {
            const errorClass = this.errorLines.has(i - 1) ? ' psc-gutter-error' : '';
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
        this.resetHistory();
    }

    setErrorLine(lineNumber) {
        // lineNumber is 1-based, -1 to clear
        this.errorLines = lineNumber > 0 ? new Set([lineNumber - 1]) : new Set();
        this.update();
    }

    // Flag several lines at once (1-based line numbers)
    setErrorLines(lineNumbers) {
        this.errorLines = new Set(lineNumbers.filter(n => n > 0).map(n => n - 1));
        this.update();
    }

    clearError() {
        this.errorLines = new Set();
        this.update();
    }

    focus() {
        this.textarea.focus();
    }
}
