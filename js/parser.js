// ============================================================
// PARSER (RECURSIVE DESCENT)
// ============================================================
// Depends on: tokens.js (TokenType), ast.js (AST)

class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    peek() {
        return this.tokens[this.pos];
    }

    advance() {
        return this.tokens[this.pos++];
    }

    match(type) {
        const t = this.peek();
        if (t.type === type) {
            this.advance();
            return true;
        }
        return false;
    }

    expect(type, message) {
        const t = this.peek();
        if (t.type !== type) {
            throw new Error(`${message} at line ${t.line}, col ${t.col}. Found: ${t.type}`);
        }
        return this.advance();
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    parseProgram() {
        const statements = [];

        while (this.peek().type !== TokenType.EOF) {
            statements.push(this.parseStatement());
        }

        return AST.Program(statements);
    }

    // ============================================================
    // STATEMENTS
    // ============================================================

    parseStatement() {
        const t = this.peek();

        switch (t.type) {
            case TokenType.TYPE:
                return this.parseTypeDef();

            case TokenType.DECLARE:
                return this.parseDeclare();

            case TokenType.CONSTANT:
                return this.parseConstant();

            case TokenType.IDENTIFIER:
                return this.parseAssignment();

            case TokenType.OUTPUT:
                return this.parseOutput();

            case TokenType.INPUT:
                return this.parseInput();

            case TokenType.IF:
                return this.parseIf();

            case TokenType.WHILE:
                return this.parseWhile();

            case TokenType.FOR:
                return this.parseFor();

            case TokenType.REPEAT:
                return this.parseRepeat();

            case TokenType.CASE:
                return this.parseCase();

            case TokenType.PROCEDURE:
                return this.parseProcedure();

            case TokenType.FUNCTION:
                return this.parseFunction();

            case TokenType.CALL:
                return this.parseCall();

            case TokenType.RETURN:
                return this.parseReturn();

            case TokenType.OPENFILE:
                return this.parseOpenFile();

            case TokenType.READFILE:
                return this.parseReadFile();

            case TokenType.WRITEFILE:
                return this.parseWriteFile();

            case TokenType.CLOSEFILE:
                return this.parseCloseFile();

            default:
                throw new Error(`Unexpected token: ${t.type} at line ${t.line}`);
        }
    }

    // ------------------------------------------------------------
    // TYPE DEFINITION
    // ------------------------------------------------------------
    // TYPE StudentType
    //     DECLARE name : STRING
    //     DECLARE age  : INTEGER
    // ENDTYPE

    parseTypeDef() {
        this.expect(TokenType.TYPE, "Expected TYPE");
        const name = this.expect(TokenType.IDENTIFIER, "Expected type name").lexeme;
        const fields = [];

        while (this.peek().type !== TokenType.ENDTYPE) {
            this.expect(TokenType.DECLARE, "Expected DECLARE before field name in TYPE definition");
            const fieldName = this.expect(TokenType.IDENTIFIER, "Expected field name").lexeme;
            this.expect(TokenType.COLON, "Expected ':' after field name");
            const fieldTypeToken = this.advance();
            const validBuiltins = ["INTEGER", "REAL", "STRING", "BOOLEAN", "CHAR"];
            let fieldType;
            if (validBuiltins.includes(fieldTypeToken.type)) {
                fieldType = fieldTypeToken.type;
            } else if (fieldTypeToken.type === TokenType.IDENTIFIER) {
                fieldType = fieldTypeToken.lexeme;
            } else {
                throw new Error(`Invalid field type '${fieldTypeToken.lexeme}' in TYPE definition at line ${fieldTypeToken.line}`);
            }
            fields.push({ name: fieldName, type: fieldType });
        }

        this.expect(TokenType.ENDTYPE, "Expected ENDTYPE");
        return AST.TypeDef(name, fields);
    }

    // ------------------------------------------------------------
    // DECLARE
    // ------------------------------------------------------------
    // DECLARE X : INTEGER
    // DECLARE Numbers : ARRAY[1:10] OF INTEGER

    parseDeclare() {
        this.expect(TokenType.DECLARE, "Expected DECLARE");

        const name = this.expect(TokenType.IDENTIFIER, "Expected identifier").lexeme;

        this.expect(TokenType.COLON, "Expected ':' after variable name");

        // Check for ARRAY keyword
        if (this.peek().type === TokenType.ARRAY) {
            this.advance(); // consume ARRAY
            this.expect(TokenType.LBRACKET, "Expected '[' after ARRAY");

            const dimensions = [];

            // First dimension
            const start1 = parseInt(this.expect(TokenType.INTEGER_LITERAL, "Expected start index").lexeme);
            this.expect(TokenType.COLON, "Expected ':' in array range");
            const end1 = parseInt(this.expect(TokenType.INTEGER_LITERAL, "Expected end index").lexeme);
            dimensions.push({ start: start1, end: end1 });

            // Check for second dimension (2D array)
            if (this.match(TokenType.COMMA)) {
                const start2 = parseInt(this.expect(TokenType.INTEGER_LITERAL, "Expected start index").lexeme);
                this.expect(TokenType.COLON, "Expected ':' in array range");
                const end2 = parseInt(this.expect(TokenType.INTEGER_LITERAL, "Expected end index").lexeme);
                dimensions.push({ start: start2, end: end2 });
            }

            this.expect(TokenType.RBRACKET, "Expected ']' after array dimensions");
            this.expect(TokenType.OF, "Expected OF after array dimensions");

            const typeToken = this.advance();
            const validTypes = ["INTEGER", "REAL", "STRING", "BOOLEAN", "CHAR"];

            if (!validTypes.includes(typeToken.type)) {
                throw new Error(`Invalid data type: ${typeToken.lexeme}`);
            }

            return AST.Declare(name, typeToken.type, dimensions);
        } else {
            // Regular variable — built-in or user-defined type
            const typeToken = this.advance();
            const validBuiltins = ["INTEGER", "REAL", "STRING", "BOOLEAN", "CHAR"];

            let typeName;
            if (validBuiltins.includes(typeToken.type)) {
                typeName = typeToken.type;
            } else if (typeToken.type === TokenType.IDENTIFIER) {
                // User-defined type name
                typeName = typeToken.lexeme;
            } else {
                throw new Error(`Invalid data type: ${typeToken.lexeme} at line ${typeToken.line}`);
            }

            return AST.Declare(name, typeName, null);
        }
    }

    // ------------------------------------------------------------
    // CONSTANT
    // ------------------------------------------------------------
    // CONSTANT PI = 3.14159

    parseConstant() {
        this.expect(TokenType.CONSTANT, "Expected CONSTANT");

        const name = this.expect(TokenType.IDENTIFIER, "Expected identifier").lexeme;

        this.expect(TokenType.EQ, "Expected '=' after constant name");

        // Parse the literal value
        const t = this.peek();
        let value;
        let dataType;

        switch (t.type) {
            case TokenType.INTEGER_LITERAL:
                this.advance();
                value = AST.IntegerLiteral(parseInt(t.lexeme));
                dataType = "INTEGER";
                break;
            case TokenType.REAL_LITERAL:
                this.advance();
                value = AST.RealLiteral(parseFloat(t.lexeme));
                dataType = "REAL";
                break;
            case TokenType.STRING_LITERAL:
                this.advance();
                value = AST.StringLiteral(t.lexeme);
                dataType = "STRING";
                break;
            case TokenType.IDENTIFIER:
                if (t.lexeme === "TRUE" || t.lexeme === "FALSE") {
                    this.advance();
                    value = AST.BooleanLiteral(t.lexeme === "TRUE");
                    dataType = "BOOLEAN";
                    break;
                }
                // fall through
            default:
                throw new Error(`CONSTANT value must be a literal at line ${t.line}`);
        }

        // Handle negative number literals
        if (t.type === TokenType.MINUS) {
            this.advance();
            const num = this.peek();
            if (num.type === TokenType.INTEGER_LITERAL) {
                this.advance();
                value = AST.IntegerLiteral(-parseInt(num.lexeme));
                dataType = "INTEGER";
            } else if (num.type === TokenType.REAL_LITERAL) {
                this.advance();
                value = AST.RealLiteral(-parseFloat(num.lexeme));
                dataType = "REAL";
            } else {
                throw new Error(`CONSTANT value must be a literal at line ${num.line}`);
            }
        }

        return AST.Constant(name, dataType, value);
    }

    // ------------------------------------------------------------
    // ASSIGNMENT
    // ------------------------------------------------------------
    // X <- expression
    // Numbers[5] <- expression

    parseAssignment() {
        const name = this.expect(TokenType.IDENTIFIER, "Expected identifier").lexeme;

        // Check for field access: record.field <- expr
        if (this.peek().type === TokenType.DOT) {
            this.advance(); // consume .
            const field = this.expect(TokenType.IDENTIFIER, "Expected field name after '.'").lexeme;
            this.expect(TokenType.ASSIGN, "Expected '<-' for assignment");
            const expr = this.parseExpression();
            const node = AST.Assignment(name, expr, null);
            node.field = field;
            return node;
        }

        // Check for array index
        let indices = null;
        if (this.peek().type === TokenType.LBRACKET) {
            this.advance(); // consume [
            indices = [];

            indices.push(this.parseExpression());

            // Check for second index (2D array)
            if (this.match(TokenType.COMMA)) {
                indices.push(this.parseExpression());
            }

            this.expect(TokenType.RBRACKET, "Expected ']' after array index");
        }

        this.expect(TokenType.ASSIGN, "Expected '<-' for assignment");

        const expr = this.parseExpression();

        return AST.Assignment(name, expr, indices);
    }

    // ------------------------------------------------------------
    // OUTPUT (supports comma-separated expressions)
    // ------------------------------------------------------------
    // OUTPUT expression
    // OUTPUT "X is ", X, " and Y is ", Y

    parseOutput() {
        this.expect(TokenType.OUTPUT, "Expected OUTPUT");

        const exprs = [];
        exprs.push(this.parseExpression());

        // Collect additional comma-separated expressions
        while (this.peek().type === TokenType.COMMA) {
            this.advance(); // consume comma
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

        const name = this.expect(TokenType.IDENTIFIER, "Expected identifier").lexeme;

        // Check for field access: INPUT record.field
        if (this.peek().type === TokenType.DOT) {
            this.advance(); // consume .
            const field = this.expect(TokenType.IDENTIFIER, "Expected field name after '.'").lexeme;
            const node = AST.Input(name, null);
            node.field = field;
            return node;
        }

        // Check for array index
        let indices = null;
        if (this.peek().type === TokenType.LBRACKET) {
            this.advance(); // consume [
            indices = [];

            indices.push(this.parseExpression());

            // Check for second index (2D array)
            if (this.match(TokenType.COMMA)) {
                indices.push(this.parseExpression());
            }

            this.expect(TokenType.RBRACKET, "Expected ']' after array index");
        }

        return AST.Input(name, indices);
    }

    // ------------------------------------------------------------
    // IF BLOCK
    // ------------------------------------------------------------

    parseIf() {
        this.expect(TokenType.IF, "Expected IF");

        const condition = this.parseExpression();

        this.expect(TokenType.THEN, "Expected THEN after IF condition");

        const thenStatements = [];
        while (this.peek().type !== TokenType.ELSE &&
               this.peek().type !== TokenType.ENDIF) {
            thenStatements.push(this.parseStatement());
        }

        let elseStatements = [];

        if (this.match(TokenType.ELSE)) {
            while (this.peek().type !== TokenType.ENDIF) {
                elseStatements.push(this.parseStatement());
            }
        }

        this.expect(TokenType.ENDIF, "Expected ENDIF");

        return AST.If(condition, thenStatements, elseStatements);
    }

    // ------------------------------------------------------------
    // WHILE BLOCK
    // ------------------------------------------------------------

    parseWhile() {
        this.expect(TokenType.WHILE, "Expected WHILE");

        const condition = this.parseExpression();

        this.expect(TokenType.DO, "Expected DO after WHILE condition");

        const body = [];

        while (this.peek().type !== TokenType.ENDWHILE) {
            body.push(this.parseStatement());
        }

        this.expect(TokenType.ENDWHILE, "Expected ENDWHILE");

        return AST.While(condition, body);
    }

    // ------------------------------------------------------------
    // FOR LOOP
    // ------------------------------------------------------------
    // FOR X <- start TO end STEP step
    //    statements...
    // NEXT X

    parseFor() {
        this.expect(TokenType.FOR, "Expected FOR");

        const loopVar = this.expect(TokenType.IDENTIFIER, "Expected loop variable").lexeme;

        this.expect(TokenType.ASSIGN, "Expected '<-' after loop variable");

        const start = this.parseExpression();

        this.expect(TokenType.TO, "Expected TO in FOR loop");

        const end = this.parseExpression();

        let step = AST.IntegerLiteral(1); // default step = 1

        if (this.match(TokenType.STEP)) {
            step = this.parseExpression();
        }

        const body = [];

        while (this.peek().type !== TokenType.NEXT) {
            body.push(this.parseStatement());
        }

        this.expect(TokenType.NEXT, "Expected NEXT to close FOR loop");

        // Optionally consume the loop variable name after NEXT (CIE syntax: NEXT I)
        if (this.peek().type === TokenType.IDENTIFIER && this.peek().lexeme === loopVar) {
            this.advance();
        }

        return AST.For(loopVar, start, end, step, body);
    }

    // ------------------------------------------------------------
    // REPEAT LOOP
    // ------------------------------------------------------------

    parseRepeat() {
        this.expect(TokenType.REPEAT, "Expected REPEAT");

        const body = [];

        while (this.peek().type !== TokenType.UNTIL) {
            body.push(this.parseStatement());
        }

        this.expect(TokenType.UNTIL, "Expected UNTIL");

        const condition = this.parseExpression();

        return AST.Repeat(body, condition);
    }

    // ------------------------------------------------------------
    // CASE STATEMENT
    // ------------------------------------------------------------
    // CASE OF <identifier>
    //     <value> : <statements>
    //     <value> : <statements>
    //     OTHERWISE
    //         <statements>
    // ENDCASE

    parseCase() {
        this.expect(TokenType.CASE, "Expected CASE");
        this.expect(TokenType.OF, "Expected OF after CASE");

        const expr = this.parseExpression();

        const branches = [];
        let otherwiseBranch = [];

        while (this.peek().type !== TokenType.ENDCASE) {
            // Check for OTHERWISE
            if (this.peek().type === TokenType.OTHERWISE) {
                this.advance(); // consume OTHERWISE

                // Optionally consume a colon after OTHERWISE
                if (this.peek().type === TokenType.COLON) {
                    this.advance();
                }

                while (this.peek().type !== TokenType.ENDCASE) {
                    otherwiseBranch.push(this.parseStatement());
                }
                break;
            }

            // Parse case value(s) — could be a literal or identifier
            const values = [];
            values.push(this.parseExpression());

            // Support comma-separated values: 1, 2, 3 : ...
            while (this.peek().type === TokenType.COMMA) {
                this.advance();
                values.push(this.parseExpression());
            }

            this.expect(TokenType.COLON, "Expected ':' after CASE value");

            // Parse statements for this branch (until next value, OTHERWISE, or ENDCASE)
            const stmts = [];
            while (this.peek().type !== TokenType.ENDCASE &&
                   this.peek().type !== TokenType.OTHERWISE &&
                   !this.isCaseValue()) {
                stmts.push(this.parseStatement());
            }

            branches.push({ values, body: stmts });
        }

        this.expect(TokenType.ENDCASE, "Expected ENDCASE");

        return AST.Case(expr, branches, otherwiseBranch);
    }

    // Helper: heuristic to detect if current position is a new case value line
    // A case value is a literal or identifier followed by ':'
    isCaseValue() {
        const t = this.peek();
        // Look ahead: if this is a literal/identifier and the next is ':'
        if (t.type === TokenType.INTEGER_LITERAL ||
            t.type === TokenType.REAL_LITERAL ||
            t.type === TokenType.STRING_LITERAL ||
            t.type === TokenType.IDENTIFIER) {

            // Save position
            const savedPos = this.pos;
            this.advance();

            // Skip comma-separated values
            while (this.peek().type === TokenType.COMMA) {
                this.advance();
                this.advance(); // skip next value
            }

            const isCase = this.peek().type === TokenType.COLON;
            // Restore position
            this.pos = savedPos;
            return isCase;
        }
        return false;
    }

    // ------------------------------------------------------------
    // PROCEDURE
    // ------------------------------------------------------------

    parseProcedure() {
        this.expect(TokenType.PROCEDURE, "Expected PROCEDURE");

        const name = this.expect(TokenType.IDENTIFIER, "Expected procedure name").lexeme;

        let params = [];
        if (this.match(TokenType.LPAREN)) {
            params = this.parseParamList();
            this.expect(TokenType.RPAREN, "Expected ')' after parameter list");
        }

        const body = [];
        while (this.peek().type !== TokenType.ENDPROCEDURE) {
            body.push(this.parseStatement());
        }

        this.expect(TokenType.ENDPROCEDURE, "Expected ENDPROCEDURE");

        return AST.Procedure(name, params, body);
    }

    // ------------------------------------------------------------
    // FUNCTION
    // ------------------------------------------------------------

    parseFunction() {
        this.expect(TokenType.FUNCTION, "Expected FUNCTION");

        const name = this.expect(TokenType.IDENTIFIER, "Expected function name").lexeme;

        this.expect(TokenType.LPAREN, "Expected '(' after function name");
        const params = this.parseParamList();
        this.expect(TokenType.RPAREN, "Expected ')' after parameter list");

        this.expect(TokenType.RETURNS, "Expected RETURNS");

        const returnType = this.advance().type;

        const body = [];
        while (this.peek().type !== TokenType.ENDFUNCTION) {
            body.push(this.parseStatement());
        }

        this.expect(TokenType.ENDFUNCTION, "Expected ENDFUNCTION");

        return AST.Function(name, params, returnType, body);
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

            const paramName = this.expect(TokenType.IDENTIFIER, "Expected parameter name").lexeme;
            this.expect(TokenType.COLON, "Expected ':' after parameter name");

            // Handle array parameter type: ARRAY[start:end, ...] OF type
            if (this.peek().type === TokenType.ARRAY) {
                this.advance(); // consume ARRAY
                this.expect(TokenType.LBRACKET, "Expected '[' after ARRAY");

                const dimensions = [];
                const start1 = parseInt(this.expect(TokenType.INTEGER_LITERAL, "Expected start index").lexeme);
                this.expect(TokenType.COLON, "Expected ':' in array range");
                const end1 = parseInt(this.expect(TokenType.INTEGER_LITERAL, "Expected end index").lexeme);
                dimensions.push({ start: start1, end: end1 });

                if (this.match(TokenType.COMMA)) {
                    const start2 = parseInt(this.expect(TokenType.INTEGER_LITERAL, "Expected start index").lexeme);
                    this.expect(TokenType.COLON, "Expected ':' in array range");
                    const end2 = parseInt(this.expect(TokenType.INTEGER_LITERAL, "Expected end index").lexeme);
                    dimensions.push({ start: start2, end: end2 });
                }

                this.expect(TokenType.RBRACKET, "Expected ']' after array dimensions");
                this.expect(TokenType.OF, "Expected OF after array dimensions");
                const elemType = this.advance().type;
                params.push({ name: paramName, type: elemType, mode, arrayDimensions: dimensions });
            } else {
                const paramType = this.advance().type;
                params.push({ name: paramName, type: paramType, mode });
            }
        } while (this.match(TokenType.COMMA));

        return params;
    }

    // ------------------------------------------------------------
    // CALL
    // ------------------------------------------------------------

    parseCall() {
        this.expect(TokenType.CALL, "Expected CALL");

        const name = this.expect(TokenType.IDENTIFIER, "Expected procedure/function name").lexeme;

        let args = [];
        if (this.match(TokenType.LPAREN)) {
            if (this.peek().type !== TokenType.RPAREN) {
                args.push(this.parseExpression());
                while (this.match(TokenType.COMMA)) {
                    args.push(this.parseExpression());
                }
            }
            this.expect(TokenType.RPAREN, "Expected ')' after arguments");
        }

        return AST.Call(name, args);
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

        this.expect(TokenType.FOR, "Expected FOR after filename");

        const modeToken = this.peek();
        let mode;
        if (modeToken.type === TokenType.READ) {
            mode = "READ";
            this.advance();
        } else if (modeToken.type === TokenType.WRITE) {
            mode = "WRITE";
            this.advance();
        } else if (modeToken.type === TokenType.APPEND) {
            mode = "APPEND";
            this.advance();
        } else {
            throw new Error(`Expected READ, WRITE, or APPEND at line ${modeToken.line}`);
        }

        return AST.OpenFile(filename, mode);
    }

    // READFILE <filename>, <variable>
    parseReadFile() {
        this.expect(TokenType.READFILE, "Expected READFILE");

        const filename = this.parseExpression();

        this.expect(TokenType.COMMA, "Expected ',' after filename");

        const variable = this.expect(TokenType.IDENTIFIER, "Expected variable name").lexeme;

        return AST.ReadFile(filename, variable);
    }

    // WRITEFILE <filename>, <data>
    parseWriteFile() {
        this.expect(TokenType.WRITEFILE, "Expected WRITEFILE");

        const filename = this.parseExpression();

        this.expect(TokenType.COMMA, "Expected ',' after filename");

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
            this.advance();
            const right = this.parseAnd();
            left = AST.Binary("OR", left, right);
        }

        return left;
    }

    // AND: logical AND (higher than OR)
    parseAnd() {
        let left = this.parseEquality();

        while (this.peek().type === TokenType.AND) {
            this.advance();
            const right = this.parseEquality();
            left = AST.Binary("AND", left, right);
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
            const op = this.advance().type;
            const right = this.parseTerm();
            left = AST.Binary(op, left, right);
        }

        return left;
    }

    // TERM: +, -, & (string concatenation at same level)
    parseTerm() {
        let left = this.parseFactor();

        while (this.peek().type === TokenType.PLUS ||
               this.peek().type === TokenType.MINUS ||
               this.peek().type === TokenType.AMPERSAND) {
            const op = this.advance().type;
            const right = this.parseFactor();
            left = AST.Binary(op, left, right);
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
            const op = this.advance().type;
            const right = this.parseUnary();
            left = AST.Binary(op, left, right);
        }

        return left;
    }

    // UNARY: -expr, NOT expr
    parseUnary() {
        // Handle NOT operator
        if (this.peek().type === TokenType.NOT) {
            this.advance();
            const operand = this.parseUnary();
            return AST.Unary("NOT", operand);
        }

        // Handle negation
        if (this.peek().type === TokenType.MINUS) {
            this.advance();
            const right = this.parseUnary();
            return AST.Unary("NEGATE", right);
        }

        return this.parsePrimary();
    }

    // PRIMARY: literals, identifiers, (expression)
    parsePrimary() {
        const t = this.peek();

        switch (t.type) {
            case TokenType.INTEGER_LITERAL:
                this.advance();
                return AST.IntegerLiteral(parseInt(t.lexeme));

            case TokenType.REAL_LITERAL:
                this.advance();
                return AST.RealLiteral(parseFloat(t.lexeme));

            case TokenType.STRING_LITERAL:
                this.advance();
                return AST.StringLiteral(t.lexeme);

            case TokenType.IDENTIFIER: {
                const name = this.advance().lexeme;

                // Check for boolean literals TRUE/FALSE
                if (name === "TRUE" || name === "FALSE") {
                    return AST.BooleanLiteral(name === "TRUE");
                }

                // Check for array access
                if (this.peek().type === TokenType.LBRACKET) {
                    this.advance(); // consume [
                    const indices = [];

                    indices.push(this.parseExpression());

                    // Check for second index (2D array)
                    if (this.match(TokenType.COMMA)) {
                        indices.push(this.parseExpression());
                    }

                    this.expect(TokenType.RBRACKET, "Expected ']' after array index");
                    return AST.ArrayAccess(name, indices);
                }

                // Check for field access: record.field
                if (this.peek().type === TokenType.DOT) {
                    this.advance(); // consume .
                    const field = this.expect(TokenType.IDENTIFIER, "Expected field name after '.'").lexeme;
                    return AST.FieldAccess(name, field);
                }

                // Check for function call in expression context: Name(args)
                if (this.peek().type === TokenType.LPAREN) {
                    this.advance(); // consume (
                    const args = [];

                    if (this.peek().type !== TokenType.RPAREN) {
                        args.push(this.parseExpression());
                        while (this.match(TokenType.COMMA)) {
                            args.push(this.parseExpression());
                        }
                    }

                    this.expect(TokenType.RPAREN, "Expected ')' after function arguments");
                    return AST.Call(name, args);
                }

                return AST.Identifier(name);
            }

            case TokenType.LPAREN:
                this.advance();
                const expr = this.parseExpression();
                this.expect(TokenType.RPAREN, "Expected ')'");
                return expr;

            default:
                throw new Error(`Unexpected token in expression: ${t.type} (${t.lexeme}) at line ${t.line}`);
        }
    }
}
