// ============================================================
// AST NODE FACTORY
// ============================================================
// Depends on: nothing

const AST = {
    Program(statements) {
        return { type: "Program", statements };
    },

    Declare(name, dataType, arrayDimensions = null) {
        return { type: "Declare", name, dataType, arrayDimensions };
    },

    Constant(name, dataType, value) {
        return { type: "Constant", name, dataType, value };
    },

    Assignment(name, expr, indices = null) {
        return { type: "Assignment", name, expr, indices };
    },

    // Output now supports a list of expressions (for comma-separated OUTPUT)
    Output(exprs) {
        return { type: "Output", exprs };
    },

    Input(name, indices = null) {
        return { type: "Input", name, indices };
    },

    If(condition, thenBlock, elseBlock) {
        return { type: "If", condition, thenBlock, elseBlock };
    },

    While(condition, body) {
        return { type: "While", condition, body };
    },

    For(loopVar, start, end, step, body) {
        return { type: "For", loopVar, start, end, step, body };
    },

    Repeat(body, condition) {
        return { type: "Repeat", body, condition };
    },

    Case(expr, branches, otherwiseBranch) {
        return { type: "Case", expr, branches, otherwiseBranch };
    },

    Procedure(name, params, body) {
        return { type: "Procedure", name, params, body };
    },

    Function(name, params, returnType, body) {
        return { type: "Function", name, params, returnType, body };
    },

    Call(name, args) {
        return { type: "Call", name, args };
    },

    Return(expr) {
        return { type: "Return", expr };
    },

    Binary(op, left, right) {
        return { type: "Binary", op, left, right };
    },

    Unary(op, operand) {
        return { type: "Unary", op, operand };
    },

    ArrayAccess(name, indices) {
        return { type: "ArrayAccess", name, indices };
    },

    Identifier(name) {
        return { type: "Identifier", name };
    },

    IntegerLiteral(value) {
        return { type: "IntegerLiteral", value };
    },

    RealLiteral(value) {
        return { type: "RealLiteral", value };
    },

    StringLiteral(value) {
        return { type: "StringLiteral", value };
    },

    BooleanLiteral(value) {
        return { type: "BooleanLiteral", value };
    },

    // User-defined record types
    TypeDef(name, fields) {
        return { type: "TypeDef", name, fields }; // fields: [{ name, type }]
    },

    FieldAccess(name, field) {
        return { type: "FieldAccess", name, field };
    },

    // File handling
    OpenFile(filename, mode) {
        return { type: "OpenFile", filename, mode }; // mode: "READ", "WRITE", "APPEND"
    },

    ReadFile(filename, variable) {
        return { type: "ReadFile", filename, variable };
    },

    WriteFile(filename, expr) {
        return { type: "WriteFile", filename, expr };
    },

    CloseFile(filename) {
        return { type: "CloseFile", filename };
    }
};
