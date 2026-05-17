@echo off
setlocal EnableDelayedExpansion

REM ============================================
REM Configuration
REM ============================================
cd /d "%~dp0"

echo ==========================================
echo   AI E2E Startup
echo ==========================================
echo.

REM ============================================
REM Parse arguments
REM ============================================
set "SKIP_BUILD=0"
if "%~1"=="--skip-build" set "SKIP_BUILD=1"

REM ============================================
REM Check if port 3002 is already in use
REM ============================================
echo [INFO] Checking port 3002...
netstat -ano | findstr ":3002.*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] Port 3002 is already in use.
    echo         Run stop.bat to terminate the existing service.
    exit /b 1
)
echo [OK] Port 3002 is available.
echo.

REM ============================================
REM Check dependency: proxy-adapter on port 3000
REM ============================================
echo [INFO] Checking dependency: Proxy Adapter on port 3000...
netstat -ano | findstr ":3000.*LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [WARN] Proxy Adapter is not running on port 3000.
    echo        AI E2E requires Proxy Adapter. Start it first.
    echo        Run: ..\start.bat or ..\proxy-adapter\start.bat
    echo.
    set /p "CONTINUE=Continue anyway? (y/N): "
    if /i not "!CONTINUE!"=="y" exit /b 1
    echo.
)
echo.

REM ============================================
REM Build
REM ============================================
if "%SKIP_BUILD%"=="0" (
    echo [INFO] Building ai-e2e...
    call pnpm build
    if errorlevel 1 (
        echo [ERROR] Build failed.
        exit /b 1
    )

    REM Verify artifact
    if not exist "dist\server.js" (
        echo [ERROR] Build artifact dist\server.js not found.
        exit /b 1
    )
    echo [OK] Build completed successfully.
    echo.
) else (
    echo [INFO] Skipping build ^(--skip-build flag detected^).

    REM Verify artifact exists
    if not exist "dist\server.js" (
        echo [ERROR] Build artifact dist\server.js not found. Cannot skip build.
        exit /b 1
    )
    echo.
)

REM ============================================
REM Start service
REM ============================================
echo [INFO] Starting AI E2E on port 3002...
start "AI E2E" cmd /c "set NODE_ENV=production&& node dist/server.js"

REM ============================================
REM Wait for service to be ready
REM ============================================
echo [INFO] Waiting for service to start...
set /a MAX_WAIT=15
set /a WAIT_COUNT=0

:wait_loop
set /a WAIT_COUNT+=1
if !WAIT_COUNT! gtr !MAX_WAIT! (
    echo [ERROR] Timeout - Service did not start within !MAX_WAIT! seconds.
    exit /b 1
)

netstat -ano | findstr ":3002.*LISTENING" >nul 2>&1
if errorlevel 1 (
    ping -n 2 127.0.0.1 >nul
    goto wait_loop
)

REM ============================================
REM Success
REM ============================================
echo.
echo ==========================================
echo   AI E2E is running on port 3002
echo ==========================================
echo   PID:
netstat -ano | findstr ":3002.*LISTENING"
echo.
echo   UI:  http://localhost:3002/ai-e2e/
echo   API: http://localhost:3002/api/health
echo.
echo   Press Ctrl+C in the AI E2E window to stop.
echo   Or run stop.bat from this directory.
echo.
