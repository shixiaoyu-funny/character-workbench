@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================================
echo   AI Role Generator - Starting...
echo   URL: http://127.0.0.1:8765/
echo   Press Ctrl+C to stop
echo ==========================================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [Error] Python not found. Please install Python 3 and add it to PATH.
    pause
    exit /b 1
)

rem Auto-open the browser 2 seconds after the server is ready.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8765/'"

python server\app.py

echo.
echo Server stopped.
pause
