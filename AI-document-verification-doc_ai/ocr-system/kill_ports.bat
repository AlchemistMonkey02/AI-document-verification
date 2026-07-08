@echo off
echo Killing any processes on Port 3000 (Node) and 5005 (Python)...

for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5005" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1

:: Force kill by Image Name as well just to be safe
taskkill /IM node.exe /F >nul 2>&1
taskkill /IM python.exe /F >nul 2>&1

echo Ports cleared and processes terminated.
pause
