@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo ==========================================
echo   Proxy Adapter Shutdown
echo ==========================================
echo.

echo [INFO] Searching for processes on port 3000...
set "FOUND=0"
set "TMPFILE=%TEMP%\nebula_stop_3000.tmp"
netstat -ano | findstr ":3000.*LISTENING" > "%TMPFILE%" 2>nul
for /f "tokens=5" %%a in (%TMPFILE%) do (
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
    echo [INFO] No process found listening on port 3000.
    echo.
    exit /b 0
)

echo [INFO] Verifying port 3000 is freed...
ping -n 2 127.0.0.1 >nul

netstat -ano | findstr ":3000.*LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [OK] Port 3000 is now free.
) else (
    echo [WARN] Port 3000 is still in use.
    echo        The following processes are still listening:
    netstat -ano | findstr ":3000.*LISTENING"
)

echo.
echo ==========================================
echo   Proxy Adapter stopped
echo ==========================================
echo.
