// ============================================================
// PARSER (RECURSIVE DESCENT)
// ============================================================
// Depends on: tokens.js (TokenType), ast.js (AST), errors.js (CompileError)
//
// Error handling strategy
//   * Every AST node carries line/col/length so later phases can point at the
//     exact source location.
//   * A syntax error inside a statement is recorded, the parser skips to the
//     start of the next statement, and carries on - so one run reports every
//     independent syntax error rather than only the first.
//   * Missing keywords that are unambiguous (THEN, DO, TO, OF, ':', ')' ...)
//     are reported but "assumed present", which stops one slip causing a
//     cascade of follow-on errors.
//   * Blocks (IF/WHILE/FOR/REPEAT/CASE/PROCEDURE/FUNCTION/TYPE) are tracked on
//     a stack so a missing or mismatched END... is reported against the block
//     that was left open.

const BUILTIN_TYPES = ["INTEGER", "REAL", "STRING", "BOOLEAN", "CHAR"];

const STATEMENT_START = new Set([
    TokenType.DECLARE, TokenType.CONSTANT, TokenType.IDENTIFIER,
    TokenType.OUTPUT, TokenType.INPUT, TokenType.IF, TokenType.WHILE,
    TokenType.FOR, TokenType.REPEAT, TokenType.CASE, TokenType.PROCEDURE,
    TokenType.FUNCTION, TokenType.CALL, TokenType.RETURN, TokenType.OPENFILE,
    TokenType.READFILE, TokenType.WRITEFILE, TokenType.CLOSEFILE, TokenType.TYPE
]);

// closer token -> the keyword that opens its block
const CLOSER_OPENS = {
    [TokenType.ENDIF]: "IF",
    [TokenType.ELSE]: "IF",
    [TokenType.ENDWHILE]: "WHILE",
    [TokenType.NEXT]: "FOR",
    [TokenType.UNTIL]: "REPEAT",
    [TokenType.ENDCASE]: "CASE",
    [TokenType.OTHERWISE]: "CASE",
    [TokenType.ENDPROCEDURE]: "PROCEDURE",
    [TokenType.ENDFUNCTION]: "FUNCTION",
    [TokenType.ENDTYPE]: "TYPE"
};

// block name -> the keyword that closes it
const BLOCK_CLOSER_NAME = {
    IF: "ENDIF", WHILE: "ENDWHILE", FOR: "NEXT", REPEAT: "UNTIL",
    CASE: "ENDCASE", PROCEDURE: "ENDPROCEDURE", FUNCTION: "ENDFUNCTION", TYPE: "ENDTYPE"
};

// Words a student might be trying to type when an identifier starts a line
const KEYWORD_SUGGESTIONS = [
    "DECLARE", "CONSTANT", "OUTPUT", "INPUT", "IF", "THEN", "ELSE", "ENDIF",
    "WHILE", "DO", "ENDWHILE", "FOR", "TO", "STEP", "NEXT", "REPEAT", "UNTIL",
    "CASE", "OF", "OTHERWISE", "ENDCASE", "PROCEDURE", "ENDPROCEDURE",
    "FUNCTION", "ENDFUNCTION", "RETURNS", "RETURN", "CALL", "TYPE", "ENDTYPE",
    "OPENFILE", "READFILE", "WRITEFILE", "CLOSEFILE"
];

class ParseError extends Error {
    constructor(diag) {
        super(diag.message);
        this.diag = diag;
    }
}

// Thrown to abandon parsing once too many errors have piled up
class ParseLimit extends Error {}

class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
        this.errors = [];
        this.blocks = [];          // stack of open blocks
        this.lastUnclosed = false; // did the last parseBlock end without its closer?
        this.maxErrors = 25;
    }

    // ============================================================
    // TOKEN HELPERS
    // ============================================================

    peek() {
        return this.tokens[this.pos];
    }

    peekAt(offset) {
        return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
    }

    prev() {
        return this.tokens[this.pos - 1];
    }

    advance() {
        const t = this.tokens[this.pos];
        if (t.type !== TokenType.EOF) this.pos++;
        return t;
    }

    match(type) {
        if (this.peek().type === type) {
            this.advance();
            return true;
        }
        return false;
    }

    // Human-readable description of a token for error messages
    describe(t) {
        switch (t.type) {
            case TokenType.EOF: return "the end of the program";
            case TokenType.IDENTIFIER: return `'${t.lexeme}'`;
            case TokenType.STRING_LITERAL: return `the text ${t.quote || '"'}${t.lexeme}${t.quote || '"'}`;
            case TokenType.INTEGER_LITERAL:
            case TokenType.REAL_LITERAL: return `the number ${t.lexeme}`;
            default: return `'${t.lexeme}'`;
        }
    }

    // Same, without the leading "the" ("Unexpected number 6")
    describeShort(t) {
        return this.describe(t).replace(/^the /, "");
    }

    // Where to point an error about token `t`. A missing item is best shown at
    // the END of the previous token (like most compilers do), not at whatever
    // happens to start the next line.
    positionFor(t) {
        const p = this.prev();
        if (p && (t.type === TokenType.EOF || t.line > p.line)) {
            return { line: p.line, col: p.col + (p.length || 1), length: 1 };
        }
        return { line: t.line, col: t.col, length: t.length || 1 };
    }

    mk(node, tok) {
        node.line = tok.line;
        node.col = tok.col;
        node.length = tok.length || 1;
        return node;
    }

    // ============================================================
    // ERROR REPORTING
    // ============================================================

    makeDiag(message, pos, hint) {
        return {
            phase: "syntax", message,
            line: pos.line, col: pos.col, length: pos.length || 1, hint
        };
    }

    // Throwable error at a token
    fail(message, t, hint) {
        return new ParseError(this.makeDiag(message, this.positionFor(t), hint));
    }

    // Record an error without throwing. Only one error per line is kept, since
    // the rest are almost always knock-on effects of the first.
    record(diag, force = false) {
        if (!force && this.errors.some(e => e.line === diag.line)) return;
        this.errors.push(diag);
        if (this.errors.length >= this.maxErrors) throw new ParseLimit();
    }

    // "Expected X, but found Y" for the token at the cursor
    unexpected(message, hint) {
        const t = this.peek();
        const found = t.type === TokenType.EOF
            ? "but the program ended"
            : `but found ${this.describe(t)}`;
        return this.fail(`${message}, ${found}`, t, hint);
    }

    expect(type, message, hint) {
        if (this.peek().type !== type) {
            throw this.unexpected(message, hint || this.defaultHint(type));
        }
        return this.advance();
    }

    // Like expect(), but if the token is missing, report it and carry on as
    // if it had been there. For keywords whose absence is unambiguous.
    expectSoft(type, message, hint) {
        if (this.peek().type === type) return this.advance();
        this.record(this.unexpected(message, hint || this.defaultHint(type)).diag);
        return null;
    }

    defaultHint(type) {
        const found = this.peek().type;
        switch (type) {
            case TokenType.ASSIGN:
                if (found === TokenType.EQ) return "use '<-' to assign a value; '=' is only for comparing values";
                if (found === TokenType.COLON) return "use '<-' to assign a value (not ':=')";
                return undefined;
            case TokenType.RPAREN:
                return "check that every '(' has a matching ')'";
            case TokenType.RBRACKET:
                return found === TokenType.COMMA
                    ? "arrays can have at most 2 dimensions"
                    : "check that every '[' has a matching ']'";
            case TokenType.COLON:
                if (found === TokenType.ASSIGN) return "DECLARE only gives a variable a type; assign its value on a separate line";
                return undefined;
            default:
                return undefined;
        }
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    parseProgram() {
        const statements = [];

        try {
            while (this.peek().type !== TokenType.EOF) {
                this.parseStatementInto(statements);
            }
        } catch (e) {
            if (!(e instanceof ParseLimit)) throw e;
        }

        if (this.errors.length > 0) {
            throw new CompileError(this.errors);
        }

        return AST.Program(statements);
    }

    // Parse one statement; on a syntax error record it and resynchronise
    parseStatementInto(body) {
        const startPos = this.pos;
        try {
            body.push(this.parseStatement());
            this.checkEndOfStatement();
        } catch (e) {
            if (!(e instanceof ParseError)) throw e;
            this.record(e.diag);
            this.synchronize(startPos);
        }
    }

    // After a statement, anything else on the same line is a mistake
    // (e.g. "x <- 5 6" or OUTPUT "a" "b").
    checkEndOfStatement() {
        const t = this.peek();
        const last = this.prev();
        if (t.type === TokenType.EOF || t.line !== last.line) return;
        if (STATEMENT_START.has(t.type) && t.type !== TokenType.IDENTIFIER) return;
        if (CLOSER_OPENS[t.type]) return;
        if (t.type === TokenType.IDENTIFIER) {
            const n = this.peekAt(1).type;
            if (n === TokenType.ASSIGN || n === TokenType.LBRACKET || n === TokenType.DOT) return;
        }

        let hint;
        if (t.type === TokenType.ASSIGN) {
            hint = "give a variable its value in a separate statement, e.g. x <- 5";
        } else if (t.type === TokenType.STRING_LITERAL || t.type === TokenType.IDENTIFIER ||
            t.type === TokenType.INTEGER_LITERAL || t.type === TokenType.REAL_LITERAL) {
            hint = "put each statement on its own line; in OUTPUT, separate values with commas or join text with &";
        }
        const diag = this.fail(
            `Unexpected ${this.describeShort(t)} after the end of the statement`, t, hint).diag;
        this.record(diag);
        // Skip the rest of this line
        while (this.peek().type !== TokenType.EOF && this.peek().line === last.line) this.pos++;
    }

    // Skip forward to the start of the next statement (or block closer)
    synchronize(startPos) {
        if (this.pos <= startPos) this.advance(); // always make progress

        while (this.peek().type !== TokenType.EOF) {
            const t = this.peek();
            const p = this.prev();
            if (t.line > p.line && this.isRecoveryPoint(t)) break;
            this.pos++;
        }
    }

    isRecoveryPoint(t) {
        return STATEMENT_START.has(t.type) ||
               !!CLOSER_OPENS[t.type] ||
               t.type === TokenType.INTEGER_LITERAL ||
               t.type === TokenType.REAL_LITERAL ||
               t.type === TokenType.STRING_LITERAL;
    }

    // ============================================================
    // BLOCKS
    // ============================================================

    // Is `type` the closer of some block that encloses the current one?
    ownedByOuter(type) {
        for (let i = this.blocks.length - 2; i >= 0; i--) {
            if (this.blocks[i].closers.has(type)) return this.blocks[i];
        }
        return null;
    }

    reportUnclosed(name, openTok, t) {
        const closer = BLOCK_CLOSER_NAME[name];
        const where = t.type === TokenType.EOF
            ? "before the end of the program"
            : `before ${this.describe(t)} on line ${t.line}`;
        this.record({
            phase: "syntax",
            message: `${name} block opened on line ${openTok.line} is never closed: expected ${closer} ${where}`,
            line: openTok.line, col: openTok.col, length: openTok.length || 1,
            hint: `add ${closer} after the statements in this ${name}`
        }, true);
    }

    // Parse items until one of `closers` is reached. Sets this.lastUnclosed if
    // the block ended without its closer (end of file, or an enclosing block's
    // closer was met first) - in which case the error has already been recorded.
    parseBlock(name, openTok, closers, itemFn = null, extraStop = null) {
        const frame = { name, openTok, closers: new Set(closers) };
        this.blocks.push(frame);
        const body = [];
        let unclosed = false;

        while (true) {
            const t = this.peek();
            if (frame.closers.has(t.type)) break;
            if (t.type === TokenType.EOF || this.ownedByOuter(t.type)) {
                this.reportUnclosed(name, openTok, t);
                unclosed = true;
                break;
            }
            if (extraStop && extraStop()) break;

            if (itemFn) {
                const startPos = this.pos;
                try {
                    itemFn(body);
                } catch (e) {
                    if (!(e instanceof ParseError)) throw e;
                    this.record(e.diag);
                    this.synchronize(startPos);
                }
            } else {
                this.parseStatementInto(body);
            }
        }

        this.blocks.pop();
        this.lastUnclosed = unclosed;
        return body;
    }

    // Consume the closer if it is there (otherwise parseBlock already reported it)
    closeBlock(type) {
        if (this.peek().type === type) this.advance();
    }

    // ============================================================
    // STATEMENTS
    // ============================================================

    parseStatement() {
        const t = this.peek();
        let node;

        switch (t.type) {
            case TokenType.TYPE:      node = this.parseTypeDef(); break;
            case TokenType.DECLARE:   node = this.parseDeclare(); break;
            case TokenType.CONSTANT:  node = this.parseConstant(); break;
            case TokenType.IDENTIFIER: node = this.parseAssignment(); break;
            case TokenType.OUTPUT:    node = this.parseOutput(); break;
            case TokenType.INPUT:     node = this.parseInput(); break;
            case TokenType.IF:        node = this.parseIf(); break;
            case TokenType.WHILE:     node = this.parseWhile(); break;
            case TokenType.FOR:       node = this.parseFor(); break;
            case TokenType.REPEAT:    node = this.parseRepeat(); break;
            case TokenType.CASE:      node = this.parseCase(); break;
            case TokenType.PROCEDURE: node = this.parseProcedure(); break;
            case TokenType.FUNCTION:  node = this.parseFunction(); break;
            case TokenType.CALL:      node = this.parseCall(); break;
            case TokenType.RETURN:    node = this.parseReturn(); break;
            case TokenType.OPENFILE:  node = this.parseOpenFile(); break;
            case TokenType.READFILE:  node = this.parseReadFile(); break;
            case TokenType.WRITEFILE: node = this.parseWriteFile(); break;
            case TokenType.CLOSEFILE: node = this.parseCloseFile(); break;
            default:
                throw this.badStatementStart(t);
        }

        if (node && node.line === undefined) this.mk(node, t);
        return node;
    }

    badStatementStart(t) {
        // A closer with nothing to close
        if (CLOSER_OPENS[t.type]) {
            const opener = CLOSER_OPENS[t.type];
            let hint;
            const top = this.blocks[this.blocks.length - 1];
            if (top) {
                hint = `the open ${top.name} block (line ${top.openTok.line}) is closed with ${BLOCK_CLOSER_NAME[top.name]}`;
            } else {
                hint = `there is no open ${opener} block to close`;
            }
            if (t.type === TokenType.ELSE) {
                return this.fail("ELSE without a matching IF", t,
                    top && top.name === "IF" ? "an IF can only have one ELSE" : hint);
            }
            if (t.type === TokenType.OTHERWISE) {
                return this.fail("OTHERWISE can only be used inside a CASE statement", t, hint);
            }
            return this.fail(`${t.lexeme} has no matching ${opener}`, t, hint);
        }

        if (t.type === TokenType.STRING_LITERAL || t.type === TokenType.INTEGER_LITERAL ||
            t.type === TokenType.REAL_LITERAL) {
            return this.fail(
                `A value on its own is not a statement (found ${this.describe(t)})`, t,
                `did you mean an assignment (e.g. Variable <- ${t.type === TokenType.STRING_LITERAL ? (t.quote || '"') + t.lexeme + (t.quote || '"') : t.lexeme}) or OUTPUT?`);
        }

        let hint;
        switch (t.type) {
            case TokenType.THEN: hint = "THEN belongs after an IF condition"; break;
            case TokenType.DO: hint = "DO belongs after a WHILE condition"; break;
            case TokenType.TO: hint = "TO belongs in a FOR statement (FOR i <- 1 TO 10)"; break;
            case TokenType.ASSIGN: hint = "'<-' must follow a variable name (Variable <- value)"; break;
            case TokenType.COLON: hint = "a ':' is only used in DECLARE, CASE branches and parameter lists"; break;
        }
        return this.fail(`Unexpected ${this.describeShort(t)}: a statement was expected here`, t, hint);
    }

    // ------------------------------------------------------------
    // Data types
    // ------------------------------------------------------------

    // Built-in type keyword, or an identifier naming a user-defined TYPE
    // (whether that type exists is checked in the semantic phase).
    parseTypeName(context) {
        const t = this.peek();
        if (BUILTIN_TYPES.includes(t.type)) {
            this.advance();
            this.lastTypePos = { line: t.line, col: t.col, length: t.length || 1 };
            return t.type;
        }
        if (t.type === TokenType.IDENTIFIER) {
            this.advance();
            this.lastTypePos = { line: t.line, col: t.col, length: t.length || 1 };
            return t.lexeme;
        }
        throw this.unexpected(
            `Expected a data type (INTEGER, REAL, STRING, BOOLEAN or CHAR) ${context}`);
    }

    // ARRAY[lo:hi(, lo:hi)] OF type   - cursor is on ARRAY
    parseArraySpec() {
        this.expect(TokenType.ARRAY, "Expected ARRAY");
        this.expect(TokenType.LBRACKET, "Expected '[' after ARRAY");

        const dimensions = [];
        dimensions.push(this.parseArrayRange());
        if (this.match(TokenType.COMMA)) {
            dimensions.push(this.parseArrayRange());
        }

        this.expect(TokenType.RBRACKET, "Expected ']' after the array bounds");
        this.expectSoft(TokenType.OF, "Expected OF after the array bounds (ARRAY[1:10] OF INTEGER)");

        const t = this.peek();
        if (!BUILTIN_TYPES.includes(t.type)) {
            throw this.unexpected(
                "Expected the array element type (INTEGER, REAL, STRING, BOOLEAN or CHAR)");
        }
        this.advance();
        return {
            dimensions,
            elemType: t.type,
            typePos: { line: t.line, col: t.col, length: t.length || 1 }
        };
    }

    parseBound(what) {
        let sign = 1;
        if (this.match(TokenType.MINUS)) sign = -1;
        const tok = this.expect(TokenType.INTEGER_LITERAL, `Expected the ${what} of the array range as a whole number`);
        return sign * parseInt(tok.lexeme);
    }

    parseArrayRange() {
        const first = this.peek();
        const start = this.parseBound("lower bound");
        this.expect(TokenType.COLON, "Expected ':' between the array bounds (ARRAY[1:10])");
        const end = this.parseBound("upper bound");
        if (start > end) {
            this.record({
                phase: "syntax",
                message: `Array lower bound (${start}) is greater than the upper bound (${end})`,
                line: first.line, col: first.col, length: this.prev().col + (this.prev().length || 1) - first.col,
                hint: "write the smaller number first, e.g. ARRAY[1:10]"
            });
        }
        return { start, end };
    }

    // ------------------------------------------------------------
    // TYPE DEFINITION
    // ------------------------------------------------------------
    // TYPE StudentType
    //     DECLARE name : STRING
    //     DECLARE age  : INTEGER
    // ENDTYPE

    parseTypeDef() {
        const openTok = this.expect(TokenType.TYPE, "Expected TYPE");
        const nameTok = this.expect(TokenType.IDENTIFIER, "Expected a name for the type after TYPE");
        const fields = [];

        const body = this.parseBlock("TYPE", openTok, [TokenType.ENDTYPE], (out) => {
            this.expect(TokenType.DECLARE, "Expected DECLARE before each field in a TYPE definition");
            this.expandMultiDeclare();
            const fieldTok = this.expect(TokenType.IDENTIFIER, "Expected a field name after DECLARE");
            this.expectSoft(TokenType.COLON, `Expected ':' and a data type after '${fieldTok.lexeme}'`);
            const fieldType = this.parseTypeName(`for field '${fieldTok.lexeme}'`);
            fields.push({
                name: fieldTok.name || fieldTok.lexeme,
                type: fieldType,
                line: fieldTok.line, col: fieldTok.col, length: fieldTok.length,
                typePos: this.lastTypePos
            });
            out.push(fields[fields.length - 1]);
        });
        this.closeBlock(TokenType.ENDTYPE);

        return this.mk(AST.TypeDef(nameTok.lexeme, fields), nameTok);
    }

    // Called with pos just after DECLARE. Rewrites
    //     DECLARE a, b, c : TYPE
    // in the token stream as
    //     DECLARE a : TYPE  DECLARE b : TYPE  DECLARE c : TYPE
    // so each variable is parsed as an ordinary single declaration.
    expandMultiDeclare() {
        const toks = this.tokens;
        const first = this.pos;
        const names = [];
        let i = first;
        while (toks[i].type === TokenType.IDENTIFIER) {
            names.push(toks[i]);
            i++;
            if (toks[i].type !== TokenType.COMMA) break;
            i++;
        }
        if (names.length < 2 || toks[i].type !== TokenType.COLON) return;

        const colonIdx = i;
        let specEnd = colonIdx + 1; // exclusive
        if (toks[specEnd].type === TokenType.ARRAY) {
            while (toks[specEnd].type !== TokenType.OF && toks[specEnd].type !== TokenType.EOF) specEnd++;
            specEnd += 2; // OF + element type
        } else {
            specEnd += 1;
        }
        specEnd = Math.min(specEnd, toks.length - 1); // never swallow EOF
        const spec = toks.slice(colonIdx, specEnd); // COLON + type tokens
        const declTok = toks[first - 1];
        const extra = [];
        for (const n of names.slice(1)) {
            extra.push({ ...declTok }, n, ...spec.map(t => ({ ...t })));
        }
        // Insert later declarations after the type spec, then drop ", b, c" from the first
        toks.splice(specEnd, 0, ...extra);
        toks.splice(first + 1, colonIdx - (first + 1));
    }

    // ------------------------------------------------------------
    // DECLARE
    // ------------------------------------------------------------
    // DECLARE X : INTEGER
    // DECLARE X, Y, Z : INTEGER
    // DECLARE Numbers : ARRAY[1:10] OF INTEGER

    parseDeclare() {
        this.expect(TokenType.DECLARE, "Expected DECLARE");
        this.expandMultiDeclare();

        const nameTok = this.expect(TokenType.IDENTIFIER, "Expected a variable name after DECLARE",
            BUILTIN_TYPES.includes(this.peek().type) || CLOSER_OPENS[this.peek().type] ||
            STATEMENT_START.has(this.peek().type)
                ? `'${this.peek().lexeme}' is a reserved word and cannot be used as a variable name`
                : undefined);

        this.expectSoft(TokenType.COLON, `Expected ':' and a data type after '${nameTok.lexeme}'`);

        let node;
        if (this.peek().type === TokenType.ARRAY) {
            const spec = this.parseArraySpec();
            node = AST.Declare(nameTok.lexeme, spec.elemType, spec.dimensions);
            node.typePos = spec.typePos;
        } else {
            const typeName = this.parseTypeName(`after ':' in the DECLARE`);
            node = AST.Declare(nameTok.lexeme, typeName, null);
            node.typePos = this.lastTypePos;
        }
        return this.mk(node, nameTok);
    }

    // ------------------------------------------------------------
    // CONSTANT
    // ------------------------------------------------------------
    // CONSTANT PI = 3.14159

    parseConstant() {
        this.expect(TokenType.CONSTANT, "Expected CONSTANT");

        const nameTok = this.expect(TokenType.IDENTIFIER, "Expected a name for the constant after CONSTANT");

        // CIE material shows both "CONSTANT X = 5" and "CONSTANT X <- 5"
        if (!this.match(TokenType.EQ) && !this.match(TokenType.ASSIGN)) {
            throw this.unexpected(`Expected '=' and a value after the constant name '${nameTok.lexeme}'`);
        }

        let t = this.peek();
        let negative = false;
        if (t.type === TokenType.MINUS) {
            negative = true;
            this.advance();
            t = this.peek();
        }

        let value;
        let dataType;

        switch (t.type) {
            case TokenType.INTEGER_LITERAL:
                this.advance();
                value = AST.IntegerLiteral((negative ? -1 : 1) * parseInt(t.lexeme));
                dataType = "INTEGER";
                break;
            case TokenType.REAL_LITERAL:
                this.advance();
                value = AST.RealLiteral((negative ? -1 : 1) * parseFloat(t.lexeme));
                dataType = "REAL";
                break;
            case TokenType.STRING_LITERAL:
                if (negative) throw this.fail("A text value cannot be negative", t);
                this.advance();
                value = AST.StringLiteral(t.lexeme);
                value.quote = t.quote;
                dataType = (t.quote === "'" && t.lexeme.length === 1) ? "CHAR" : "STRING";
                break;
            case TokenType.IDENTIFIER:
                if (!negative && (t.lexeme.toUpperCase() === "TRUE" || t.lexeme.toUpperCase() === "FALSE")) {
                    this.advance();
                    value = AST.BooleanLiteral(t.lexeme.toUpperCase() === "TRUE");
                    dataType = "BOOLEAN";
                    break;
                }
                throw this.fail(`The value of a CONSTANT must be a literal (a number, text, TRUE or FALSE), not ${this.describe(t)}`, t,
                    "constants cannot be calculated from variables or other constants");
            default:
                throw this.unexpected("Expected a literal value (a number, text, TRUE or FALSE) for the CONSTANT");
        }

        this.mk(value, t);
        return this.mk(AST.Constant(nameTok.lexeme, dataType, value), nameTok);
    }

    // ------------------------------------------------------------
    // ASSIGNMENT
    // ------------------------------------------------------------
    // X <- expression
    // Numbers[5] <- expression

    parseAssignment() {
        const nameTok = this.expect(TokenType.IDENTIFIER, "Expected identifier");
        const name = nameTok.lexeme;
        const next = this.peek();

        // An identifier that is not followed by <- [ or . is probably a
        // mistyped keyword, or a procedure call missing CALL.
        if (next.type !== TokenType.ASSIGN && next.type !== TokenType.LBRACKET &&
            next.type !== TokenType.DOT && next.type !== TokenType.EQ) {
            throw this.unknownStatement(nameTok);
        }

        let field = null;
        let indices = null;

        // record.field <- expr
        if (this.match(TokenType.DOT)) {
            field = this.expect(TokenType.IDENTIFIER, "Expected a field name after '.'").lexeme;
        } else if (this.peek().type === TokenType.LBRACKET) {
            indices = this.parseIndices();
        }

        if (this.peek().type === TokenType.EQ) {
            // Common slip: '=' used for assignment. Report it, then carry on as if '<-'.
            this.record(this.fail(
                `'=' compares values; it cannot assign one`, this.peek(),
                `write ${name}${field ? "." + field : ""}${indices ? "[...]" : ""} <- value`).diag);
            this.advance();
        } else {
            this.expect(TokenType.ASSIGN, `Expected '<-' after '${name}' to assign a value`);
        }

        const expr = this.parseExpression();

        const node = AST.Assignment(name, expr, indices);
        if (field) node.field = field;
        return this.mk(node, nameTok);
    }

    unknownStatement(nameTok) {
        const name = nameTok.lexeme;
        const next = this.peek();

        if (next.type === TokenType.LPAREN) {
            return this.fail(`'${name}(...)' cannot be used as a statement`, nameTok,
                `to run a procedure write CALL ${name}(...); a function call must be used inside an expression`);
        }

        const guess = suggestName(name.toUpperCase(), KEYWORD_SUGGESTIONS);
        if (guess) {
            return this.fail(`Unknown statement '${name}'`, nameTok, `did you mean ${guess}?`);
        }
        if (next.type === TokenType.COLON) {
            return this.fail(`Unexpected ':' after '${name}'`, next,
                "':' is only used in DECLARE, CASE branches and parameter lists");
        }
        return this.fail(
            `Expected '<-' after '${name}' to assign a value, but found ${this.describe(next)}`, next,
            `if '${name}' is meant to be a command, check its spelling; commands include OUTPUT, INPUT, IF, WHILE, FOR`);
    }

    // [ expr (, expr) ]
    parseIndices() {
        this.expect(TokenType.LBRACKET, "Expected '['");
        const indices = [this.parseExpression()];
        if (this.match(TokenType.COMMA)) {
            indices.push(this.parseExpression());
        }
        this.expect(TokenType.RBRACKET, "Expected ']' after the array index");
        return indices;
    }

    // ------------------------------------------------------------
    // OUTPUT (supports comma-separated expressions)
    // ------------------------------------------------------------
    // OUTPUT expression
    // OUTPUT "X is ", X, " and Y is ", Y

    parseOutput() {
        this.expect(TokenType.OUTPUT, "Expected OUTPUT");

        const exprs = [this.parseExpression()];
        while (this.peek().type === TokenType.COMMA) {
            this.advance();
            exprs.push(this.parseExpression());
        }

        return AST.Output(exprs);
    }

    // ------------------------------------------------------------
    // INPUT
    // ------------------------------------------------------------
    // INPUT variable
    // INPUT Numbers[5]
    // INPUT record.field

    parseInput() {
        this.expect(TokenType.INPUT, "Expected INPUT");

        const nameTok = this.expect(TokenType.IDENTIFIER, "Expected the name of a variable to store the input in, after INPUT",
            this.peek().type === TokenType.STRING_LITERAL
                ? "INPUT does not take a prompt; use OUTPUT to show a message first"
                : undefined);

        if (this.match(TokenType.DOT)) {
            const field = this.expect(TokenType.IDENTIFIER, "Expected a field name after '.'").lexeme;
            const node = AST.Input(nameTok.lexeme, null);
            node.field = field;
            return this.mk(node, nameTok);
        }

        let indices = null;
        if (this.peek().type === TokenType.LBRACKET) {
            indices = this.parseIndices();
        }

        return this.mk(AST.Input(nameTok.lexeme, indices), nameTok);
    }

    // ------------------------------------------------------------
    // IF BLOCK
    // ------------------------------------------------------------

    parseIf() {
        const openTok = this.expect(TokenType.IF, "Expected IF");

        const condition = this.parseExpression();

        this.expectSoft(TokenType.THEN, "Expected THEN after the IF condition");

        const thenStatements = this.parseBlock("IF", openTok, [TokenType.ELSE, TokenType.ENDIF]);

        let elseStatements = [];
        if (!this.lastUnclosed && this.peek().type === TokenType.ELSE) {
            this.advance();
            elseStatements = this.parseBlock("IF", openTok, [TokenType.ENDIF]);
        }

        this.closeBlock(TokenType.ENDIF);

        return this.mk(AST.If(condition, thenStatements, elseStatements), openTok);
    }

    // ------------------------------------------------------------
    // WHILE BLOCK
    // ------------------------------------------------------------

    parseWhile() {
        const openTok = this.expect(TokenType.WHILE, "Expected WHILE");

        const condition = this.parseExpression();

        this.expectSoft(TokenType.DO, "Expected DO after the WHILE condition");

        const body = this.parseBlock("WHILE", openTok, [TokenType.ENDWHILE]);
        this.closeBlock(TokenType.ENDWHILE);

        return this.mk(AST.While(condition, body), openTok);
    }

    // ------------------------------------------------------------
    // FOR LOOP
    // ------------------------------------------------------------
    // FOR X <- start TO end STEP step
    //    statements...
    // NEXT X

    parseFor() {
        const openTok = this.expect(TokenType.FOR, "Expected FOR");

        const varTok = this.expect(TokenType.IDENTIFIER, "Expected a loop variable after FOR");
        const loopVar = varTok.lexeme;

        if (this.peek().type === TokenType.EQ) {
            this.record(this.fail("'=' cannot assign the start value of a FOR loop", this.peek(),
                `write FOR ${loopVar} <- start TO end`).diag);
            this.advance();
        } else {
            this.expect(TokenType.ASSIGN, `Expected '<-' after the loop variable '${loopVar}'`);
        }

        const start = this.parseExpression();

        this.expectSoft(TokenType.TO, "Expected TO after the FOR start value");

        const end = this.parseExpression();

        let step = this.mk(AST.IntegerLiteral(1), openTok); // default step = 1
        if (this.match(TokenType.STEP)) {
            step = this.parseExpression();
        }

        const body = this.parseBlock("FOR", openTok, [TokenType.NEXT]);

        if (this.peek().type === TokenType.NEXT) {
            this.advance();
            // Optional loop variable after NEXT (CIE syntax: NEXT I)
            const t = this.peek();
            if (t.type === TokenType.IDENTIFIER && t.line === this.prev().line) {
                if (t.lexeme === loopVar) {
                    this.advance();
                } else if (this.peekAt(1).type !== TokenType.ASSIGN &&
                           this.peekAt(1).type !== TokenType.LBRACKET &&
                           this.peekAt(1).type !== TokenType.DOT) {
                    this.record(this.fail(
                        `NEXT '${t.lexeme}' does not match the FOR loop variable '${loopVar}'`, t,
                        `write NEXT ${loopVar} (or just NEXT)`).diag);
                    this.advance();
                }
            }
        }

        const node = AST.For(loopVar, start, end, step, body);
        node.varLine = varTok.line;
        node.varCol = varTok.col;
        return this.mk(node, varTok);
    }

    // ------------------------------------------------------------
    // REPEAT LOOP
    // ------------------------------------------------------------

    parseRepeat() {
        const openTok = this.expect(TokenType.REPEAT, "Expected REPEAT");

        const body = this.parseBlock("REPEAT", openTok, [TokenType.UNTIL]);

        if (this.lastUnclosed) {
            return this.mk(AST.Repeat(body, this.mk(AST.BooleanLiteral(true), openTok)), openTok);
        }
        this.expect(TokenType.UNTIL, "Expected UNTIL");
        const condition = this.parseExpression();

        return this.mk(AST.Repeat(body, condition), openTok);
    }

    // ------------------------------------------------------------
    // CASE STATEMENT
    // ------------------------------------------------------------
    // CASE OF <identifier>
    //     <value> : <statements>
    //     <value> : <statements>
    //     OTHERWISE : <statements>
    // ENDCASE

    parseCase() {
        const openTok = this.expect(TokenType.CASE, "Expected CASE");
        this.expectSoft(TokenType.OF, "Expected OF after CASE (CASE OF <variable>)");

        const expr = this.parseExpression();

        const branches = [];
        let otherwiseBranch = [];
        let unclosed = false;

        while (true) {
            const t = this.peek();

            if (t.type === TokenType.ENDCASE) break;

            if (t.type === TokenType.EOF || this.ownedByOuter(t.type)) {
                this.reportUnclosed("CASE", openTok, t);
                unclosed = true;
                break;
            }

            if (t.type === TokenType.OTHERWISE) {
                this.advance();
                this.match(TokenType.COLON); // colon after OTHERWISE is optional
                otherwiseBranch = this.parseBlock("CASE", openTok, [TokenType.ENDCASE]);
                unclosed = this.lastUnclosed;
                break;
            }

            const startPos = this.pos;
            try {
                const values = [this.parseCaseValue()];
                while (this.peek().type === TokenType.COMMA) {
                    this.advance();
                    values.push(this.parseCaseValue());
                }

                this.expect(TokenType.COLON, "Expected ':' after the CASE value",
                    "each CASE branch looks like  value : statement");

                const body = this.parseBlock("CASE", openTok,
                    [TokenType.ENDCASE, TokenType.OTHERWISE], null, () => this.isCaseValue());
                branches.push({ values, body });
                if (this.lastUnclosed) {
                    unclosed = true;
                    break;
                }
            } catch (e) {
                if (!(e instanceof ParseError)) throw e;
                this.record(e.diag);
                this.synchronize(startPos);
            }
        }

        if (!unclosed) this.closeBlock(TokenType.ENDCASE);

        return this.mk(AST.Case(expr, branches, otherwiseBranch), openTok);
    }

    parseCaseValue() {
        const t = this.peek();
        if (t.type === TokenType.OTHERWISE) {
            throw this.fail("OTHERWISE must come after all the other CASE values", t);
        }
        return this.parseExpression();
    }

    // Helper: heuristic to detect if current position is a new case value line
    // A case value is a literal or identifier (possibly negative) followed by ':'
    isCaseValue() {
        const startType = this.peek().type;
        if (startType === TokenType.INTEGER_LITERAL ||
            startType === TokenType.REAL_LITERAL ||
            startType === TokenType.STRING_LITERAL ||
            startType === TokenType.IDENTIFIER ||
            startType === TokenType.MINUS) {

            const savedPos = this.pos;
            const skipValue = () => {
                if (this.peek().type === TokenType.MINUS) this.advance();
                this.advance();
            };
            skipValue();

            // Skip comma-separated values
            while (this.peek().type === TokenType.COMMA) {
                this.advance();
                skipValue();
            }

            const isCase = this.peek().type === TokenType.COLON;
            this.pos = savedPos;
            return isCase;
        }
        return false;
    }

    // ------------------------------------------------------------
    // PROCEDURE
    // ------------------------------------------------------------

    parseProcedure() {
        const openTok = this.expect(TokenType.PROCEDURE, "Expected PROCEDURE");

        const nameTok = this.expect(TokenType.IDENTIFIER, "Expected a procedure name after PROCEDURE");

        let params = [];
        if (this.match(TokenType.LPAREN)) {
            params = this.parseParamList();
            this.expect(TokenType.RPAREN, "Expected ')' after the parameter list");
        }

        const body = this.parseBlock("PROCEDURE", openTok, [TokenType.ENDPROCEDURE]);
        this.closeBlock(TokenType.ENDPROCEDURE);

        const node = AST.Procedure(nameTok.lexeme, params, body);
        node.endLine = this.prev().line;
        return this.mk(node, nameTok);
    }

    // ------------------------------------------------------------
    // FUNCTION
    // ------------------------------------------------------------

    parseFunction() {
        const openTok = this.expect(TokenType.FUNCTION, "Expected FUNCTION");

        const nameTok = this.expect(TokenType.IDENTIFIER, "Expected a function name after FUNCTION");

        this.expect(TokenType.LPAREN, `Expected '(' after the function name '${nameTok.lexeme}'`,
            "a function needs a parameter list, even if it is empty: FUNCTION Name() RETURNS INTEGER");
        const params = this.parseParamList();
        this.expect(TokenType.RPAREN, "Expected ')' after the parameter list");

        this.expect(TokenType.RETURNS, `Expected RETURNS and a data type after the parameters of '${nameTok.lexeme}'`);

        const returnType = this.parseTypeName("after RETURNS");
        const typePos = this.lastTypePos;

        const body = this.parseBlock("FUNCTION", openTok, [TokenType.ENDFUNCTION]);
        this.closeBlock(TokenType.ENDFUNCTION);

        const node = AST.Function(nameTok.lexeme, params, returnType, body);
        node.typePos = typePos;
        node.endLine = this.prev().line;
        return this.mk(node, nameTok);
    }

    // ------------------------------------------------------------
    // PARAMETER LIST (shared by PROCEDURE and FUNCTION)
    // ------------------------------------------------------------

    parseParamList() {
        const params = [];

        if (this.peek().type === TokenType.RPAREN) {
            return params; // empty list
        }

        do {
            let mode = "BYVAL"; // default
            if (this.peek().type === TokenType.BYREF) {
                mode = "BYREF";
                this.advance();
            } else if (this.peek().type === TokenType.BYVAL) {
                mode = "BYVAL";
                this.advance();
            }

            const nameTok = this.expect(TokenType.IDENTIFIER, "Expected a parameter name");
            this.expectSoft(TokenType.COLON, `Expected ':' and a data type after the parameter '${nameTok.lexeme}'`);

            const pos = { line: nameTok.line, col: nameTok.col, length: nameTok.length || 1 };
            if (this.peek().type === TokenType.ARRAY) {
                const spec = this.parseArraySpec();
                params.push({ name: nameTok.lexeme, type: spec.elemType, mode, arrayDimensions: spec.dimensions, ...pos, typePos: spec.typePos });
            } else {
                const paramType = this.parseTypeName(`for the parameter '${nameTok.lexeme}'`);
                params.push({ name: nameTok.lexeme, type: paramType, mode, ...pos, typePos: this.lastTypePos });
            }
        } while (this.match(TokenType.COMMA));

        return params;
    }

    // ------------------------------------------------------------
    // CALL
    // ------------------------------------------------------------

    parseCall() {
        this.expect(TokenType.CALL, "Expected CALL");

        const nameTok = this.expect(TokenType.IDENTIFIER, "Expected the name of a procedure after CALL");

        let args = [];
        if (this.match(TokenType.LPAREN)) {
            args = this.parseArgs();
            this.expectSoft(TokenType.RPAREN, "Expected ')' after the arguments");
        }

        return this.mk(AST.Call(nameTok.lexeme, args), nameTok);
    }

    parseArgs() {
        const args = [];
        if (this.peek().type !== TokenType.RPAREN) {
            args.push(this.parseExpression());
            while (this.match(TokenType.COMMA)) {
                args.push(this.parseExpression());
            }
        }
        return args;
    }

    // ------------------------------------------------------------
    // RETURN
    // ------------------------------------------------------------

    parseReturn() {
        this.expect(TokenType.RETURN, "Expected RETURN");

        const expr = this.parseExpression();

        return AST.Return(expr);
    }

    // ------------------------------------------------------------
    // FILE HANDLING
    // ------------------------------------------------------------
    // OPENFILE <filename> FOR READ | WRITE | APPEND

    parseOpenFile() {
        this.expect(TokenType.OPENFILE, "Expected OPENFILE");

        const filename = this.parseExpression();

        this.expect(TokenType.FOR, "Expected FOR after the file name (OPENFILE \"name\" FOR READ)");

        const modeToken = this.peek();
        let mode;
        if (modeToken.type === TokenType.READ) {
            mode = "READ";
        } else if (modeToken.type === TokenType.WRITE) {
            mode = "WRITE";
        } else if (modeToken.type === TokenType.APPEND) {
            mode = "APPEND";
        } else {
            throw this.unexpected("Expected READ, WRITE or APPEND as the file mode");
        }
        this.advance();

        return AST.OpenFile(filename, mode);
    }

    // READFILE <filename>, <variable>
    parseReadFile() {
        this.expect(TokenType.READFILE, "Expected READFILE");

        const filename = this.parseExpression();

        this.expect(TokenType.COMMA, "Expected ',' after the file name");

        const varTok = this.expect(TokenType.IDENTIFIER, "Expected the name of a variable to read into");

        return this.mk(AST.ReadFile(filename, varTok.lexeme), varTok);
    }

    // WRITEFILE <filename>, <data>
    parseWriteFile() {
        this.expect(TokenType.WRITEFILE, "Expected WRITEFILE");

        const filename = this.parseExpression();

        this.expect(TokenType.COMMA, "Expected ',' after the file name");

        const expr = this.parseExpression();

        return AST.WriteFile(filename, expr);
    }

    // CLOSEFILE <filename>
    parseCloseFile() {
        this.expect(TokenType.CLOSEFILE, "Expected CLOSEFILE");

        const filename = this.parseExpression();

        return AST.CloseFile(filename);
    }

    // ============================================================
    // EXPRESSIONS (Standard precedence)
    // ============================================================

    parseExpression() {
        return this.parseOr();
    }

    // OR: logical OR (lowest precedence for boolean)
    parseOr() {
        let left = this.parseAnd();

        while (this.peek().type === TokenType.OR) {
            const opTok = this.advance();
            const right = this.parseAnd();
            left = this.mk(AST.Binary("OR", left, right), opTok);
        }

        return left;
    }

    // AND: logical AND (higher than OR)
    parseAnd() {
        let left = this.parseEquality();

        while (this.peek().type === TokenType.AND) {
            const opTok = this.advance();
            const right = this.parseEquality();
            left = this.mk(AST.Binary("AND", left, right), opTok);
        }

        return left;
    }

    // EQUALITY: =, <>, <, >, <=, >=
    parseEquality() {
        let left = this.parseTerm();

        const eqOps = [
            TokenType.EQ, TokenType.NE,
            TokenType.LT, TokenType.GT,
            TokenType.LE, TokenType.GE
        ];

        while (eqOps.includes(this.peek().type)) {
            const opTok = this.advance();
            const right = this.parseTerm();
            left = this.mk(AST.Binary(opTok.type, left, right), opTok);
        }

        return left;
    }

    // TERM: +, -, & (string concatenation at same level)
    parseTerm() {
        let left = this.parseFactor();

        while (this.peek().type === TokenType.PLUS ||
               this.peek().type === TokenType.MINUS ||
               this.peek().type === TokenType.AMPERSAND) {
            // A + or - that starts a new line begins something new (e.g. the
            // CASE value "-1 :"), it does not continue the previous line.
            const next = this.peek();
            if (next.type !== TokenType.AMPERSAND && next.line > this.prev().line) break;
            const opTok = this.advance();
            const right = this.parseFactor();
            left = this.mk(AST.Binary(opTok.type, left, right), opTok);
        }

        return left;
    }

    // FACTOR: *, /, DIV, MOD, ^
    parseFactor() {
        let left = this.parseUnary();

        while (this.peek().type === TokenType.MULTIPLY ||
               this.peek().type === TokenType.DIVIDE ||
               this.peek().type === TokenType.DIV ||
               this.peek().type === TokenType.MOD ||
               this.peek().type === TokenType.POWER) {
            const opTok = this.advance();
            const right = this.parseUnary();
            left = this.mk(AST.Binary(opTok.type, left, right), opTok);
        }

        return left;
    }

    // UNARY: -expr, NOT expr
    parseUnary() {
        if (this.peek().type === TokenType.NOT) {
            const opTok = this.advance();
            const operand = this.parseUnary();
            return this.mk(AST.Unary("NOT", operand), opTok);
        }

        if (this.peek().type === TokenType.MINUS) {
            const opTok = this.advance();
            const right = this.parseUnary();
            return this.mk(AST.Unary("NEGATE", right), opTok);
        }

        return this.parsePrimary();
    }

    // PRIMARY: literals, identifiers, (expression)
    parsePrimary() {
        const t = this.peek();

        switch (t.type) {
            case TokenType.INTEGER_LITERAL:
                this.advance();
                return this.mk(AST.IntegerLiteral(parseInt(t.lexeme)), t);

            case TokenType.REAL_LITERAL:
                this.advance();
                return this.mk(AST.RealLiteral(parseFloat(t.lexeme)), t);

            case TokenType.STRING_LITERAL: {
                this.advance();
                const node = AST.StringLiteral(t.lexeme);
                node.quote = t.quote;
                return this.mk(node, t);
            }

            case TokenType.IDENTIFIER: {
                this.advance();
                const name = t.lexeme;
                const upper = name.toUpperCase();

                // Boolean literals TRUE/FALSE
                if ((upper === "TRUE" || upper === "FALSE") &&
                    this.peek().type !== TokenType.LBRACKET &&
                    this.peek().type !== TokenType.LPAREN) {
                    return this.mk(AST.BooleanLiteral(upper === "TRUE"), t);
                }

                // Array access
                if (this.peek().type === TokenType.LBRACKET) {
                    const indices = this.parseIndices();
                    return this.mk(AST.ArrayAccess(name, indices), t);
                }

                // Field access: record.field
                if (this.peek().type === TokenType.DOT) {
                    this.advance();
                    const field = this.expect(TokenType.IDENTIFIER, "Expected a field name after '.'").lexeme;
                    return this.mk(AST.FieldAccess(name, field), t);
                }

                // Function call in expression context: Name(args)
                if (this.peek().type === TokenType.LPAREN) {
                    this.advance();
                    const args = this.parseArgs();
                    this.expectSoft(TokenType.RPAREN, `Expected ')' to close the call to '${name}'`);
                    return this.mk(AST.Call(name, args), t);
                }

                return this.mk(AST.Identifier(name), t);
            }

            case TokenType.LPAREN: {
                this.advance();
                const expr = this.parseExpression();
                this.expectSoft(TokenType.RPAREN, "Expected ')' to close the bracket");
                return expr;
            }

            default: {
                let hint;
                if (CLOSER_OPENS[t.type] || STATEMENT_START.has(t.type) || t.type === TokenType.EOF) {
                    hint = "the line seems to be unfinished";
                } else if (t.type === TokenType.RPAREN) {
                    hint = "there may be an extra ')' or a missing value before it";
                }
                throw this.unexpected("Expected a value or expression", hint);
            }
        }
    }
}
