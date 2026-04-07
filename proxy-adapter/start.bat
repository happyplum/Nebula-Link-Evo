@echo off
setlocal EnableDelayedExpansion

REM ============================================
REM Configuration
REM ============================================
cd /d "%~dp0"

echo ==========================================
echo   Proxy Adapter Startup
echo ==========================================
echo.

REM ============================================
REM Parse arguments
REM ============================================
set "SKIP_BUILD=0"
if "%~1"=="--skip-build" set "SKIP_BUILD=1"

REM ============================================
REM Check if port 3000 is already in use
REM ============================================
echo [INFO] Checking port 3000...
netstat -ano | findstr ":3000.*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] Port 3000 is already in use.
    echo         Run stop.bat to terminate the existing service.
    exit /b 1
)
echo [OK] Port 3000 is available.
echo.

REM ============================================
REM Build
REM ============================================
if "%SKIP_BUILD%"=="0" (
    echo [INFO] Building proxy-adapter...
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
echo [INFO] Starting Proxy Adapter on port 3000...
start "Proxy Adapter" cmd /c "set NODE_ENV=production&& node dist/server.js"

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

netstat -ano | findstr ":3000.*LISTENING" >nul 2>&1
if errorlevel 1 (
    ping -n 2 127.0.0.1 >nul
    goto wait_loop
)

REM ============================================
REM Success
REM ============================================
echo.
echo ==========================================
echo   Proxy Adapter is running on port 3000
echo ==========================================
echo   PID:
netstat -ano | findstr ":3000.*LISTENING"
echo.
echo   Press Ctrl+C in the Proxy Adapter window to stop.
echo   Or run stop.bat from this directory.
echo.
