// ============================================================
// HTML INTEGRATION / UI
// ============================================================
// Depends on: compiler.js, runtime.js, editor.js, examples.js
//
// This expects the HTML to contain:
//   - #editor-container       (div for the syntax-highlighted editor)
//   - #terminal-output        (div for console output)
//   - #terminal-input         (textarea for user input, 5 rows)
//   - #ir-code                (pre for IR code display)
//   - #example-select         (select for example programs)
//
// Buttons call:
//   PSC_runProgram()
//   PSC_stopProgram()
//   PSC_clearOutput()
//   PSC_loadExample()

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function $id(sel) {
    return document.querySelector(sel);
}

// ------------------------------------------------------------
// EDITOR INSTANCE
// ------------------------------------------------------------

let pscEditor = null;

// ------------------------------------------------------------
// TERMINAL MANAGEMENT
// ------------------------------------------------------------

let terminalState = {
    runtime: null,
    waiting: false,
    waitingFor: '',
    onInputCallback: null
};

function PSC_setInputEnabled(enabled) {
    const input = $id("#terminal-input");
    const btn = $id("#terminal-submit-btn");
    if (input) input.disabled = !enabled;
    if (btn)   btn.disabled   = !enabled;
}

function PSC_clearConsole() {
    $id("#terminal-output").innerHTML = "";
    $id("#terminal-input").value = "";
    PSC_setInputEnabled(false);
    terminalState.waiting = false;
    terminalState.waitingFor = '';
}

function PSC_clearOutput() {
    PSC_clearConsole();
    $id("#ir-code").textContent = "";
    if (pscEditor) pscEditor.clearError();
}

function PSC_switchTab(tab, btn) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(b => {
        b.classList.remove('active');
    });
    if (btn) {
        btn.classList.add('active');
    }

    // Show/hide panels
    $id("#pane-terminal").style.display = 'none';
    $id("#pane-files").style.display   = 'none';
    $id("#pane-ir").style.display      = 'none';

    if (tab === 'terminal') {
        $id("#pane-terminal").style.display = 'flex';
    } else if (tab === 'files') {
        $id("#pane-files").style.display = 'flex';
    } else if (tab === 'ir') {
        $id("#pane-ir").style.display = 'block';
    }
}

function PSC_writeTerminal(text, className = 'terminal-output-line') {
    const output = $id("#terminal-output");
    const line = document.createElement('div');
    line.className = `terminal-line ${className}`;
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

function PSC_waitForInput(prompt, callback) {
    terminalState.waiting = true;
    terminalState.waitingFor = prompt;
    terminalState.onInputCallback = callback;

    const input = $id("#terminal-input");
    input.placeholder = prompt;
    PSC_setInputEnabled(true);
    input.focus();
}

function PSC_submitInput() {
    if (!terminalState.waiting) return;

    const input = $id("#terminal-input");
    const value = input.value;

    input.value = '';
    input.placeholder = 'Enter input here...';
    PSC_setInputEnabled(false);

    terminalState.waiting = false;

    if (terminalState.onInputCallback) {
        terminalState.onInputCallback(value);
        terminalState.onInputCallback = null;
    }
}

// ------------------------------------------------------------
// EXAMPLE PROGRAMS
// ------------------------------------------------------------

function PSC_loadExample(index) {
    if (index === '' || index === undefined) return;
    const idx = parseInt(index);
    if (isNaN(idx) || idx < 0 || idx >= EXAMPLE_PROGRAMS.length) return;

    const example = EXAMPLE_PROGRAMS[idx];
    if (pscEditor) {
        pscEditor.setValue(example.code);
        pscEditor.clearError();
    }

    // Reset the select back to placeholder
    $id("#example-select").value = "";
}

function PSC_populateExamples() {
    const select = $id("#example-select");
    if (!select || typeof EXAMPLE_PROGRAMS === 'undefined') return;

    for (let i = 0; i < EXAMPLE_PROGRAMS.length; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = EXAMPLE_PROGRAMS[i].name;
        select.appendChild(option);
    }
}

// ------------------------------------------------------------
// INITIALIZATION
// ------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function() {
    // Create the syntax-highlighted editor
    pscEditor = new PseudocodeEditor('editor-container');

    // Set default program
    pscEditor.setValue(
`// CIE 9618 Pseudocode - Hello World
// Click "Run" to execute, or choose an example from the dropdown

DECLARE Name : STRING

OUTPUT "Welcome to the CIE Pseudocode Compiler!"
OUTPUT "What is your name?"
INPUT Name
OUTPUT "Hello, " & Name & "!"`
    );

    // Console input: Enter submits, Shift+Enter adds newline
    const input = $id("#terminal-input");
    if (input) {
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                PSC_submitInput();
            }
        });
    }

    // Populate example programs dropdown
    PSC_populateExamples();
});


// ------------------------------------------------------------
// FILE SAVE / OPEN
// ------------------------------------------------------------

function PSC_saveFile() {
    const code = pscEditor ? pscEditor.getValue() : '';
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'program.psc';
    a.click();
    URL.revokeObjectURL(url);
}

function PSC_openFile() {
    $id('#file-open-input').value = '';  // reset so same file can be re-opened
    $id('#file-open-input').click();
}

function PSC_handleFileOpen(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        if (pscEditor) {
            pscEditor.setValue(e.target.result);
            pscEditor.clearError();
        }
    };
    reader.readAsText(file);
}

// ------------------------------------------------------------
// VIRTUAL FILESYSTEM (for pseudocode OPENFILE/READFILE/WRITEFILE)
// ------------------------------------------------------------

// Persistent virtual files: filename -> { lines: [], userCreated: bool }
const PSC_virtualFiles = {};

function PSC_renderFilesList() {
    const list = $id('#files-list');
    const empty = $id('#files-empty');
    const names = Object.keys(PSC_virtualFiles);

    // Remove all file entries (not the empty notice)
    list.querySelectorAll('.file-entry').forEach(el => el.remove());

    if (names.length === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    for (const name of names) {
        const file = PSC_virtualFiles[name];
        const entry = document.createElement('div');
        entry.className = 'file-entry';
        entry.dataset.filename = name;

        const isWritten = !file.userCreated;
        const badge = isWritten
            ? '<span class="file-entry-badge written">written by program</span>'
            : '<span class="file-entry-badge user">user file</span>';

        entry.innerHTML = `
            <div class="file-entry-header">
                <span class="file-entry-name">${name}</span>
                ${badge}
                <div class="file-entry-actions">
                    <button class="file-btn-download" onclick="PSC_downloadVirtualFile('${name}')">Download</button>
                    <button class="file-btn-delete" onclick="PSC_deleteVirtualFile('${name}')">Delete</button>
                </div>
            </div>
            <textarea class="file-entry-content" rows="4"
                ${isWritten ? 'readonly' : ''}
                onchange="PSC_virtualFileEdited('${name}', this.value)"
            >${file.lines.join('\n')}</textarea>`;

        list.appendChild(entry);
    }
}

function PSC_createVirtualFile() {
    const input = $id('#new-file-name');
    const name = input.value.trim();
    if (!name) return;

    PSC_virtualFiles[name] = { lines: [], userCreated: true };
    input.value = '';
    PSC_renderFilesList();
}

function PSC_deleteVirtualFile(name) {
    delete PSC_virtualFiles[name];
    PSC_renderFilesList();
}

function PSC_virtualFileEdited(name, value) {
    if (PSC_virtualFiles[name]) {
        PSC_virtualFiles[name].lines = value === '' ? [] : value.split('\n');
    }
}

function PSC_downloadVirtualFile(name) {
    const file = PSC_virtualFiles[name];
    if (!file) return;
    const content = file.lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}

// Sync virtual files into a runtime's file store before execution
function PSC_injectFilesIntoRuntime(runtime) {
    for (const [name, file] of Object.entries(PSC_virtualFiles)) {
        runtime.files[name] = {
            lines: [...file.lines],
            readPos: 0,
            mode: null,
            open: false
        };
    }
}

// Pull any files the program wrote back into the virtual file store
function PSC_syncFilesFromRuntime(runtime) {
    for (const [name, rFile] of Object.entries(runtime.files)) {
        const existing = PSC_virtualFiles[name];
        // If it was opened for write/append, treat it as program-written
        if (!existing || !existing.userCreated) {
            PSC_virtualFiles[name] = {
                lines: [...rFile.lines],
                userCreated: false
            };
        }
    }
    PSC_renderFilesList();
}

// ------------------------------------------------------------
// RUN / STOP PROGRAM
// ------------------------------------------------------------

let activeRuntime = null; // reference to running runtime so Stop can halt it

function PSC_setRunning(running) {
    const stopBtn = $id("#btn-stop");
    if (stopBtn) {
        stopBtn.disabled = !running;
    }
}

function PSC_stopProgram() {
    if (activeRuntime) {
        activeRuntime.halt();
    }
}

async function PSC_runProgram() {
    PSC_clearOutput();
    PSC_setRunning(true);

    // Switch to console tab
    const consoleBtn = document.querySelector('.tab-button');
    PSC_switchTab('terminal', consoleBtn);

    const source = pscEditor ? pscEditor.getValue() : '';

    try {
        // Compile to IR
        const compiler = new Compiler({ optimize: true, debug: false });
        const { ir } = compiler.compile(source);

        // Show IR in IR tab
        $id("#ir-code").textContent = ir.join('\n');

        // Create runtime with terminal support
        const runtime = new Runtime(ir);
        activeRuntime = runtime;

        // Inject any user-created virtual files so the program can read them
        PSC_injectFilesIntoRuntime(runtime);

        runtime.terminalMode = true;
        runtime.writeOutput = (text) => {
            PSC_writeTerminal(text, 'terminal-output-line');
        };
        runtime.readInput = (varName) => {
            return new Promise((resolve, reject) => {
                // If already halted, reject immediately
                if (runtime.halted) {
                    reject(new Error("Program stopped by user"));
                    return;
                }
                PSC_waitForInput(`Enter value for ${varName}:`, (value) => {
                    if (runtime.halted) {
                        reject(new Error("Program stopped by user"));
                        return;
                    }
                    const parsed = parseFloat(value);
                    const result = isNaN(parsed) ? value : parsed;
                    resolve(result);
                });
            });
        };

        // Run the program asynchronously
        await runtime.runAsync();

        PSC_writeTerminal('', 'terminal-output-line');
        PSC_writeTerminal('--- Program finished ---', 'terminal-output-line');

        // Pull written files back into the virtual file store
        PSC_syncFilesFromRuntime(runtime);

    } catch (err) {
        PSC_writeTerminal('', 'terminal-error');
        PSC_writeTerminal(err.message, 'terminal-error');
        console.error(err);

        // Still sync any files written before the error
        if (activeRuntime) {
            PSC_syncFilesFromRuntime(activeRuntime);
        }

        // Try to highlight the error line in the editor
        if (pscEditor) {
            const lineMatch = err.message.match(/line (\d+)/i);
            if (lineMatch) {
                pscEditor.setErrorLine(parseInt(lineMatch[1]));
            }
        }
    } finally {
        activeRuntime = null;
        PSC_setRunning(false);
        PSC_setInputEnabled(false);
        const input = $id("#terminal-input");
        if (input) input.placeholder = 'Enter input here...';
        terminalState.waiting = false;
        terminalState.onInputCallback = null;
    }
}
