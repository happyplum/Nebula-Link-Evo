@echo off
setlocal EnableDelayedExpansion

:: ============================================
:: Nebula-Link Evo - Development Mode Launcher
:: ============================================
:: This script starts all services in development mode:
::   - Playwright Server (port 3001)
::   - Proxy Adapter (port 3000)
::   - Vite Dev Server for Debug UI (port 5173)
::
:: Usage: start-dev.bat
:: ============================================

:: Get ESC character for ANSI colors
for /f %%A in ('powershell -c "[char]27"') do set "ESC=%%A"
set "GREEN=%ESC%[92m"
set "YELLOW=%ESC%[93m"
set "RED=%ESC%[91m"
set "BLUE=%ESC%[94m"
set "CYAN=%ESC%[96m"
set "NC=%ESC%[0m"

cd /d "%~dp0"

echo %BLUE%========================================%NC%
echo %CYAN%  Nebula-Link Evo - Dev Mode%NC%
echo %BLUE%========================================%NC%
echo.

:: ============================================
:: Step 1: Check dependencies
:: ============================================
echo [1/4] Checking dependencies...
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%ERROR: pnpm not found. Install with: npm install -g pnpm%NC%
    exit /b 1
)
echo %GREEN%  pnpm is available%NC%

:: ============================================
:: Step 2: Pre-flight checks
:: ============================================
echo.
echo [2/4] Pre-flight checks...
call :check_port 3001
if %errorlevel% neq 0 exit /b 1
call :check_port 3000
if %errorlevel% neq 0 exit /b 1
call :check_port 5173
if %errorlevel% neq 0 exit /b 1
echo %GREEN%  All ports available%NC%

:: ============================================
:: Step 3: Build shared package
:: ============================================
echo.
echo [3/4] Building shared package...
cd shared
call pnpm build >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%  ERROR: Failed to build shared package%NC%
    exit /b 1
)
echo %GREEN%  Shared package built%NC%
cd "%~dp0"

:: ============================================
:: Step 4: Start services in separate windows
:: ============================================
echo.
echo [4/4] Starting services in development mode...

:: Start Playwright Server
cd playwright-server
start "Playwright Server (Dev)" cmd /c "pnpm dev"
cd "%~dp0"

:: Wait a moment for Playwright to start
timeout /t 2 /nobreak >nul 2>&1

:: Start Proxy Adapter
cd proxy-adapter
start "Proxy Adapter (Dev)" cmd /c "pnpm dev"
cd "%~dp0"

:: Wait for proxy adapter to start
timeout /t 3 /nobreak >nul 2>&1

:: Start standalone Debug UI package
cd debug-ui
start "Debug UI (Dev)" cmd /c "pnpm dev"
cd "%~dp0"

:: Wait for services to be ready
echo   Waiting for services to start...
set /a ready_count=0
:wait_services
if %ready_count% geq 30 goto service_timeout
timeout /t 1 /nobreak >nul 2>&1
netstat -ano | findstr ":3001.*LISTENING" >nul
if errorlevel 1 goto wait_services
netstat -ano | findstr ":3000.*LISTENING" >nul
if errorlevel 1 goto wait_services
netstat -ano | findstr ":5173.*LISTENING" >nul
if errorlevel 1 goto wait_services
echo %GREEN%  All services started%NC%
goto summary

:service_timeout
echo %RED%  ERROR: Services failed to start within 30 seconds%NC%
echo   Check the service windows for error messages.
exit /b 1

:summary

:: ============================================
:: Summary
:: ============================================
echo.
echo %BLUE%========================================%NC%
echo %GREEN%  Development mode ready!%NC%
echo.
echo %YELLOW%  Services:%NC%
echo   %CYAN%Playwright Server:%NC%  http://localhost:3001
echo   %CYAN%Proxy Adapter:%NC%     http://localhost:3000
echo   %CYAN%Vite Dev Server:%NC%  http://localhost:5173
echo.
echo %YELLOW%  Debug UI (Development):%NC%
echo   %GREEN%http://localhost:5173/debug/%NC%
echo.
echo %YELLOW%  API Endpoints:%NC%
echo   %CYAN%Health:%NC%           http://localhost:3000/api/health
echo   %CYAN%Debug Health:%NC%     http://localhost:3000/debug/api/health
echo.
echo %YELLOW%  WebSocket Endpoints:%NC%
echo   %CYAN%Debug WS:%NC%         ws://localhost:5173/ws/debug
echo   %CYAN%Chat WS:%NC%          ws://localhost:5173/ws/chat
echo.
echo %BLUE%To stop:%NC% Close all service windows or run stop.bat
echo %BLUE%========================================%NC%
echo.

goto :eof

:: ============================================
:: Helper: Check if port is available
:: ============================================
:check_port
set "port=%1"
netstat -ano | findstr ":%port%" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo !RED!  Port %port% is already in use!NC!
    echo !YELLOW!  Run stop.bat to stop existing services!NC!
    exit /b 1
)
exit /b 0
