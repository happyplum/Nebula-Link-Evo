@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

REM Check if port is already in use
echo [INFO] Checking if port 5173 is available...
netstat -ano | findstr ":5173.*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] Port 5173 is already in use!
    echo         Run stop.bat to stop the existing service.
    exit /b 1
)
echo [OK] Port 5173 is available.

echo.
echo [INFO] Starting Debug UI dev server...
start "Debug UI" cmd /c "pnpm dev"

echo.
echo [INFO] Waiting for Debug UI to start...
set /a wait_count=0
:wait_loop
if !wait_count! geq 15 goto timeout
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr ":5173.*LISTENING" >nul 2>&1
if errorlevel 1 (
    set /a wait_count+=1
    goto wait_loop
)

echo [OK] Debug UI started successfully!
echo.
echo ==========================================
echo   Debug UI is running:
echo     http://localhost:5173/debug/
echo ==========================================
echo.
echo To stop: Run stop.bat
exit /b 0

:timeout
echo [ERROR] Debug UI failed to start within 15 seconds.
echo         Check the Debug UI window for error messages.
exit /b 1
