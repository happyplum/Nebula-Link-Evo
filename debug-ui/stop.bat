@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo [INFO] Stopping Debug UI on port 5173...

set "found=0"
set "TMPFILE=%TEMP%\nebula_stop_5173.tmp"
netstat -ano | findstr ":5173.*LISTENING" > "%TMPFILE%" 2>nul
for /f "tokens=5" %%a in (%TMPFILE%) do (
    echo [INFO] Killing process on port 5173 ^(^PID: %%a^)
    taskkill /PID %%a /F >nul 2>&1
    set "found=1"
)
del "%TMPFILE%" >nul 2>&1

if "!found!"=="0" (
    echo [INFO] No process found on port 5173.
)

echo.
echo [INFO] Checking port 5173 is free...
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr ":5173.*LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [OK] Port 5173 is free.
) else (
    echo [ERROR] Port 5173 is still in use.
    exit /b 1
)

echo.
echo ==========================================
echo   Debug UI stopped!
echo ==========================================
exit /b 0
