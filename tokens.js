// ============================================================
// TOKEN DEFINITIONS
// ============================================================

const TokenType = {
    IDENTIFIER: "IDENTIFIER",
    INTEGER_LITERAL: "INTEGER_LITERAL",
    REAL_LITERAL: "REAL_LITERAL",
    STRING_LITERAL: "STRING_LITERAL",

    // Keywords
    DECLARE: "DECLARE",
    CONSTANT: "CONSTANT",
    IF: "IF",
    THEN: "THEN",
    ELSE: "ELSE",
    ENDIF: "ENDIF",
    WHILE: "WHILE",
    DO: "DO",
    ENDWHILE: "ENDWHILE",
    FOR: "FOR",
    TO: "TO",
    STEP: "STEP",
    NEXT: "NEXT",
    OUTPUT: "OUTPUT",
    INPUT: "INPUT",

    // Loop keywords
    REPEAT: "REPEAT",
    UNTIL: "UNTIL",

    // Selection keywords
    CASE: "CASE",
    OF: "OF",
    ENDCASE: "ENDCASE",
    OTHERWISE: "OTHERWISE",

    // Array keywords
    ARRAY: "ARRAY",

    // Procedure/Function keywords
    PROCEDURE: "PROCEDURE",
    ENDPROCEDURE: "ENDPROCEDURE",
    FUNCTION: "FUNCTION",
    ENDFUNCTION: "ENDFUNCTION",
    CALL: "CALL",
    RETURN: "RETURN",
    RETURNS: "RETURNS",
    BYREF: "BYREF",
    BYVAL: "BYVAL",

    // Boolean operators
    AND: "AND",
    OR: "OR",
    NOT: "NOT",

    // Integer arithmetic keywords
    DIV: "DIV",
    MOD: "MOD",

    // User-defined type keywords
    TYPE: "TYPE",
    ENDTYPE: "ENDTYPE",

    // File handling keywords
    OPENFILE: "OPENFILE",
    READFILE: "READFILE",
    WRITEFILE: "WRITEFILE",
    CLOSEFILE: "CLOSEFILE",
    READ: "READ",
    WRITE: "WRITE",
    APPEND: "APPEND",

    // Operators
    ASSIGN: "ASSIGN", // <-
    EQ: "EQ",         // =
    LT: "LT",         // <
    GT: "GT",         // >
    LE: "LE",         // <=
    GE: "GE",         // >=
    NE: "NE",         // <>

    PLUS: "PLUS",
    MINUS: "MINUS",
    MULTIPLY: "MULTIPLY",
    DIVIDE: "DIVIDE",
    POWER: "POWER",
    AMPERSAND: "AMPERSAND",  // & for string concatenation

    // Punctuation
    LPAREN: "LPAREN",
    RPAREN: "RPAREN",
    COMMA: "COMMA",
    COLON: "COLON",
    LBRACKET: "LBRACKET",  // [
    RBRACKET: "RBRACKET",  // ]
    DOT: "DOT",            // .

    EOF: "EOF"
};
