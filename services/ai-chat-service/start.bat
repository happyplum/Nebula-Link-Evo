@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo ==========================================
echo   AI Chat Service Startup
echo ==========================================
echo.

set "SKIP_BUILD=0"
if "%~1"=="--skip-build" set "SKIP_BUILD=1"

echo [INFO] Checking port 3001...
netstat -ano | findstr ":3001.*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] Port 3001 is already in use.
    echo         Run stop.bat to terminate the existing service.
    exit /b 1
)
echo [OK] Port 3001 is available.
echo.

if "%SKIP_BUILD%"=="0" (
    echo [INFO] Building ai-chat-service...
    call pnpm build
    if errorlevel 1 (
        echo [ERROR] Build failed.
        exit /b 1
    )
    echo [OK] Build completed successfully.
    echo.
) else (
    echo [INFO] Skipping build ^(--skip-build flag detected^).
    echo.
)

if not exist "dist\server.js" (
    echo [ERROR] Build artifact dist\server.js not found.
    echo         Run without --skip-build to build the project.
    exit /b 1
)

echo [INFO] Starting AI Chat Service on port 3001...
start "AI Chat Service" cmd /c "set NODE_ENV=production&& node dist/server.js"

echo [INFO] Waiting for service to start...
set /a MAX_WAIT=15
set /a WAIT_COUNT=0

:wait_loop
set /a WAIT_COUNT+=1
if !WAIT_COUNT! gtr !MAX_WAIT! (
    echo [ERROR] Timeout - Service did not start within !MAX_WAIT! seconds.
    exit /b 1
)

netstat -ano | findstr ":3001.*LISTENING" >nul 2>&1
if errorlevel 1 (
    ping -n 2 127.0.0.1 >nul
    goto wait_loop
)

echo.
echo ==========================================
echo   AI Chat Service is running on port 3001
echo ==========================================
echo   PID:
netstat -ano | findstr ":3001.*LISTENING"
echo.
echo   Health: http://localhost:3001/health
echo.
echo   Press Ctrl+C in the AI Chat Service window to stop.
echo   Or run stop.bat from this directory.
echo.
exit /b 0
