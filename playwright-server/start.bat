@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo ==========================================
echo   Playwright Server Startup
echo ==========================================
echo.

REM Skip build if --skip-build parameter provided
if "%~1"=="--skip-build" goto start_service

REM Check port 3001
echo [INFO] Checking port 3001...
netstat -ano | findstr ":3001.*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] Port 3001 is already in use.
    echo         Run stop.bat to stop the existing service.
    exit /b 1
)
echo [OK] Port 3001 is available.
echo.

REM Build project
echo [INFO] Building playwright-server...
call pnpm build
if errorlevel 1 (
    echo [ERROR] Build failed.
    exit /b 1
)
echo [OK] Build completed.
echo.

:start_service
REM Verify artifact exists
if not exist "dist\server.js" (
    echo [ERROR] dist\server.js not found.
    echo         Run without --skip-build to build the project.
    exit /b 1
)

REM Start service
echo [INFO] Starting Playwright Server on port 3001...
start "Playwright Server" cmd /c "node dist/server.js"

REM Wait for service to start
echo [INFO] Waiting for service to be ready...
set /a "max_wait=15"
set "wait_time=0"

:wait_loop
if !wait_time! geq !max_wait! (
    echo [ERROR] Timeout waiting for service to start.
    exit /b 1
)
netstat -ano | findstr ":3001.*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo ==========================================
    echo   Playwright Server is running on port 3001
    echo ==========================================
    echo.
    exit /b 0
)
ping -n 2 127.0.0.1 >nul
set /a "wait_time+=1"
goto wait_loop
