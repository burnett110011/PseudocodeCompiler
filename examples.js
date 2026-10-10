// ============================================================
// EXAMPLE PROGRAMS
// ============================================================
// Depends on: nothing

const EXAMPLE_PROGRAMS = [
    {
        name: "Hello World",
        code: `OUTPUT "Hello, World!"`
    },
    {
        name: "Variables & Input",
        code: `DECLARE Name : STRING
DECLARE Age : INTEGER

OUTPUT "What is your name?"
INPUT Name
OUTPUT "How old are you?"
INPUT Age

OUTPUT "Hello, " & Name & "!"
OUTPUT "Next year you will be " & NUM_TO_STR(Age + 1) & " years old."`
    },
    {
        name: "IF Statement",
        code: `DECLARE Score : INTEGER

OUTPUT "Enter your score (0-100):"
INPUT Score

IF Score >= 90 THEN
    OUTPUT "Grade: A*"
ELSE
    IF Score >= 70 THEN
        OUTPUT "Grade: A"
    ELSE
        IF Score >= 50 THEN
            OUTPUT "Grade: B"
        ELSE
            OUTPUT "Grade: U"
        ENDIF
    ENDIF
ENDIF`
    },
    {
        name: "CASE Statement",
        code: `DECLARE Day : INTEGER
DECLARE DayName : STRING

OUTPUT "Enter day number (1-7):"
INPUT Day

CASE OF Day
    1 : DayName <- "Monday"
    2 : DayName <- "Tuesday"
    3 : DayName <- "Wednesday"
    4 : DayName <- "Thursday"
    5 : DayName <- "Friday"
    6, 7 : DayName <- "Weekend"
    OTHERWISE : DayName <- "Invalid"
ENDCASE

OUTPUT "Day: " & DayName`
    },
    {
        name: "FOR Loop",
        code: `DECLARE I : INTEGER
DECLARE Sum : INTEGER

Sum <- 0
FOR I <- 1 TO 10 STEP 1
    Sum <- Sum + I
    OUTPUT "Sum after " & NUM_TO_STR(I) & " = " & NUM_TO_STR(Sum)
NEXT I

OUTPUT ""
OUTPUT "Total: " & NUM_TO_STR(Sum)`
    },
    {
        name: "WHILE Loop",
        code: `DECLARE Guess : INTEGER
DECLARE Secret : INTEGER
DECLARE Attempts : INTEGER

Secret <- RAND(100)
Attempts <- 0

OUTPUT "I'm thinking of a number between 0 and 100."
OUTPUT "Try to guess it!"

Guess <- -1
WHILE Guess <> Secret DO
    OUTPUT "Enter your guess:"
    INPUT Guess
    Attempts <- Attempts + 1
    IF Guess < Secret THEN
        OUTPUT "Too low!"
    ELSE
        IF Guess > Secret THEN
            OUTPUT "Too high!"
        ENDIF
    ENDIF
ENDWHILE

OUTPUT "Correct! You got it in " & NUM_TO_STR(Attempts) & " attempts."`
    },
    {
        name: "REPEAT UNTIL",
        code: `DECLARE Password : STRING

REPEAT
    OUTPUT "Enter password:"
    INPUT Password
    IF Password <> "secret" THEN
        OUTPUT "Wrong password. Try again."
    ENDIF
UNTIL Password = "secret"

OUTPUT "Access granted!"`
    },
    {
        name: "Arrays",
        code: `DECLARE Numbers : ARRAY[1:5] OF INTEGER
DECLARE I : INTEGER
DECLARE Max : INTEGER

OUTPUT "Enter 5 numbers:"
FOR I <- 1 TO 5 STEP 1
    OUTPUT "Number " & NUM_TO_STR(I) & ":"
    INPUT Numbers[I]
NEXT I

// Find the maximum
Max <- Numbers[1]
FOR I <- 2 TO 5 STEP 1
    IF Numbers[I] > Max THEN
        Max <- Numbers[I]
    ENDIF
NEXT I

OUTPUT ""
OUTPUT "The largest number is: " & NUM_TO_STR(Max)`
    },
    {
        name: "Procedures & BYREF",
        code: `DECLARE A : INTEGER
DECLARE B : INTEGER

PROCEDURE Swap(BYREF X : INTEGER, BYREF Y : INTEGER)
    DECLARE Temp : INTEGER
    Temp <- X
    X <- Y
    Y <- Temp
ENDPROCEDURE

A <- 10
B <- 20
OUTPUT "Before swap: A=" & NUM_TO_STR(A) & " B=" & NUM_TO_STR(B)

CALL Swap(A, B)
OUTPUT "After swap:  A=" & NUM_TO_STR(A) & " B=" & NUM_TO_STR(B)`
    },
    {
        name: "Functions",
        code: `DECLARE Result : INTEGER

FUNCTION Factorial(N : INTEGER) RETURNS INTEGER
    DECLARE F : INTEGER
    DECLARE I : INTEGER
    F <- 1
    FOR I <- 1 TO N STEP 1
        F <- F * I
    NEXT I
    RETURN F
ENDFUNCTION

FUNCTION IsPrime(N : INTEGER) RETURNS BOOLEAN
    DECLARE I : INTEGER
    IF N < 2 THEN
        RETURN FALSE
    ENDIF
    FOR I <- 2 TO N - 1 STEP 1
        IF N MOD I = 0 THEN
            RETURN FALSE
        ENDIF
    NEXT I
    RETURN TRUE
ENDFUNCTION

OUTPUT "Factorials:"
Result <- 1
DECLARE I : INTEGER
FOR I <- 1 TO 8 STEP 1
    OUTPUT NUM_TO_STR(I) & "! = " & NUM_TO_STR(Factorial(I))
NEXT I

OUTPUT ""
OUTPUT "Prime numbers up to 20:"
FOR I <- 2 TO 20 STEP 1
    IF IsPrime(I) = TRUE THEN
        OUTPUT NUM_TO_STR(I) & " is prime"
    ENDIF
NEXT I`
    },
    {
        name: "String Functions",
        code: `DECLARE S : STRING
DECLARE I : INTEGER

S <- "Hello World"

OUTPUT "String: " & S
OUTPUT "Length: " & NUM_TO_STR(LENGTH(S))
OUTPUT "Upper:  " & UCASE(S)
OUTPUT "Lower:  " & LCASE(S)
OUTPUT "Left 5: " & LEFT(S, 5)
OUTPUT "Right 5:" & RIGHT(S, 5)
OUTPUT "Mid 4,3:" & MID(S, 4, 3)

OUTPUT ""
OUTPUT "Character codes:"
FOR I <- 1 TO LENGTH(S) STEP 1
    OUTPUT MID(S, I, 1) & " = " & NUM_TO_STR(ASC(MID(S, I, 1)))
NEXT I`
    },
    {
        name: "Bubble Sort",
        code: `DECLARE Numbers : ARRAY[1:6] OF INTEGER
DECLARE I : INTEGER
DECLARE J : INTEGER
DECLARE N : INTEGER

N <- 6

// Fill array
OUTPUT "Enter " & NUM_TO_STR(N) & " numbers to sort:"
FOR I <- 1 TO N STEP 1
    OUTPUT "Number " & NUM_TO_STR(I) & ":"
    INPUT Numbers[I]
NEXT I

// Bubble sort
PROCEDURE Swap(BYREF A : INTEGER, BYREF B : INTEGER)
    DECLARE Temp : INTEGER
    Temp <- A
    A <- B
    B <- Temp
ENDPROCEDURE

FOR I <- 1 TO N - 1 STEP 1
    FOR J <- 1 TO N - I STEP 1
        IF Numbers[J] > Numbers[J + 1] THEN
            CALL Swap(Numbers[J], Numbers[J + 1])
        ENDIF
    NEXT J
NEXT I

// Display sorted array
OUTPUT ""
OUTPUT "Sorted:"
FOR I <- 1 TO N STEP 1
    OUTPUT Numbers[I]
NEXT I`
    },
    {
        name: "File Handling",
        code: `DECLARE Line : STRING
DECLARE I : INTEGER

// Write to a file
OPENFILE "data.txt" FOR WRITE
FOR I <- 1 TO 5 STEP 1
    WRITEFILE "data.txt", "Line " & NUM_TO_STR(I)
NEXT I
CLOSEFILE "data.txt"

OUTPUT "File written!"
OUTPUT ""

// Read from the file
OPENFILE "data.txt" FOR READ
WHILE EOF("data.txt") = FALSE DO
    READFILE "data.txt", Line
    OUTPUT "Read: " & Line
ENDWHILE
CLOSEFILE "data.txt"

OUTPUT ""
OUTPUT "Done reading file."`
    },
    {
        name: "User-Defined Types",
        code: `TYPE StudentType
    DECLARE Name : STRING
    DECLARE Age  : INTEGER
    DECLARE Score : REAL
ENDTYPE

DECLARE Student : StudentType

OUTPUT "Enter student name:"
INPUT Student.Name
OUTPUT "Enter age:"
INPUT Student.Age
OUTPUT "Enter score (0-100):"
INPUT Student.Score

OUTPUT ""
OUTPUT "--- Student Record ---"
OUTPUT "Name:  " & Student.Name
OUTPUT "Age:   " & NUM_TO_STR(Student.Age)
OUTPUT "Score: " & NUM_TO_STR(Student.Score)

IF Student.Score >= 50.0 THEN
    OUTPUT "Result: PASS"
ELSE
    OUTPUT "Result: FAIL"
ENDIF`
    }
];
