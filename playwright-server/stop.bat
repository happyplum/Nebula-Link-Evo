@echo off
setlocal EnableDelayedExpansion

echo ==========================================
echo   Stopping Playwright Server
echo ==========================================
echo.

echo [INFO] Checking for processes on port 3001...
set "TMPFILE=%TEMP%\nebula_stop_3001.tmp"
netstat -ano | findstr ":3001.*LISTENING" > "%TMPFILE%" 2>nul
for /f "tokens=5" %%a in (%TMPFILE%) do (
    echo [INFO] Stopping PID %%a...
    taskkill /PID %%a /F >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK]   PID %%a stopped successfully.
    ) else (
        echo [ERROR] Failed to stop PID %%a.
    )
)
del "%TMPFILE%" >nul 2>&1

REM Verify port is freed
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr ":3001.*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] Port 3001 is still in use.
    echo         Manually check remaining processes.
    exit /b 1
)

echo [OK] Playwright Server stopped.
