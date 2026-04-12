@echo off
echo =========================================
echo  VerseCon Link - Fast Executable Builder
echo =========================================
echo.
echo Building Windows Executable without installer...

call npm run build:fast

if %errorlevel% neq 0 (
    echo.
    echo BUILD FAILED! Check the errors above.
    pause
    exit /b %errorlevel%
)

echo.
echo Build successful! Launching VerseCon Link...
start "" "dist\win-unpacked\VerseCon Link.exe"
