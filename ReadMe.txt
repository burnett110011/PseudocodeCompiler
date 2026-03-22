
Please download all files into a folder. You should have a single html file and a folder with multiple js files.
Then open the cie-pseudocode-compiler.html using a browser.

Version History

Version 3.0

1. Added default: return instr; so non-arithmetic operators fall back to returning the instruction unchanged instead of undefined.
2. runtime.js — The CALL handler now throws a clear error (Undefined function or procedure: 'str_to_num') instead of silently setting this.pc = undefined which then caused the cryptic endsWith crash.

ir-generator.js — Built-in function lookup is now case-insensitive (str_to_num, STR_TO_NUM, Str_To_Num all work). The emitted instruction always uses uppercase so the runtime matches it correctly.

semantic.js — Same case-insensitive fix for the semantic analyzer so it correctly identifies built-in return types (e.g. str_to_num now correctly returns type REAL instead of falling through to "INTEGER").

3. parser.js — parseParamList(): When the parameter type is ARRAY, it now parses the full ARRAY[start:end, ...] OF type syntax (up to 2D), storing the dimensions in param.arrayDimensions.

semantic.js — checkProcedure and checkFunction now pass param.arrayDimensions when declaring array parameters, so the semantic analyzer knows the parameter is an array and validates array accesses on it correctly inside the function body.


Version 2.2

More updates for tablets/phones. 

Version 2.1

Fixes in this version

Changes aimed at improving functionality on tablet devices.



Version 2.0

Fixes in this version

1. Virtual files now work.
2. Automatic unindent implemented.
3. Type for records improved.
4. Stricter type controls, e.g. loop variables must be integers.

