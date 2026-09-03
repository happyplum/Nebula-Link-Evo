@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo ==========================================
echo   AI Chat Service Shutdown
echo ==========================================
echo.

echo [INFO] Searching for processes on port 3001...
set "FOUND=0"
set "TMPFILE=%TEMP%\nebula_stop_3001.tmp"
netstat -ano | findstr ":3001.*LISTENING" > "%TMPFILE%" 2>nul
for /f "usebackq tokens=5" %%a in ("%TMPFILE%") do (
    echo [INFO] Found process with PID: %%a
    taskkill /F /PID %%a >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Failed to terminate PID %%a
    ) else (
        echo [OK] Terminated PID %%a
        set "FOUND=1"
    )
)
del "%TMPFILE%" >nul 2>&1

if "!FOUND!"=="0" (
    echo [INFO] No process found listening on port 3001.
    echo.
    exit /b 0
)

echo [INFO] Verifying port 3001 is freed...
ping -n 2 127.0.0.1 >nul

netstat -ano | findstr ":3001.*LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [OK] Port 3001 is now free.
) else (
    echo [WARN] Port 3001 is still in use.
    echo        The following processes are still listening:
    netstat -ano | findstr ":3001.*LISTENING"
    exit /b 1
)

echo.
echo ==========================================
echo   AI Chat Service stopped
echo ==========================================
echo.
exit /b 0
