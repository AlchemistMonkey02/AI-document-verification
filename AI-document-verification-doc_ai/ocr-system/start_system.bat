@echo off
TITLE OCR System Launcher

echo ===================================================
echo      Starting OCR System
echo ===================================================

:: Install Root Deps
if not exist "node_modules" (
    echo Installing Root modules...
    call npm install
)

echo System is starting...
echo APIs:
echo - OCR: POST http://localhost:3000/ocr
echo.
node app.js
pause
