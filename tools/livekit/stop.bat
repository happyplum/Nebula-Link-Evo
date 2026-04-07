@echo off
setlocal EnableDelayedExpansion

echo ==========================================
echo   Stopping LiveKit Server
echo ==========================================
echo.

set "LK_PORT=7880"
set "found=0"

REM Find and kill processes listening on port 7880
set "TMPFILE=%TEMP%\nebula_stop_7880.tmp"
netstat -ano | findstr ":!LK_PORT!.*LISTENING" > "%TMPFILE%" 2>nul
for /f "tokens=5" %%a in (%TMPFILE%) do (
    set "found=1"
    echo [INFO] Stopping LiveKit Server ^(^PID: %%a^) on port !LK_PORT!
    taskkill /PID %%a /F >nul 2>&1
)
del "%TMPFILE%" >nul 2>&1

if "!found!"=="0" (
    echo [INFO] No process found listening on port !LK_PORT!.
    exit /b 0
)

REM Wait a moment for the process to terminate
ping -n 2 127.0.0.1 >nul

REM Verify port is free
netstat -ano | findstr ":!LK_PORT!.*LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [OK] LiveKit Server stopped successfully.
) else (
    echo [ERROR] Failed to stop LiveKit Server.
    echo         Port !LK_PORT! is still in use.
    exit /b 1
)
