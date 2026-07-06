@echo off
setlocal EnableDelayedExpansion

if "%NODE_ENV%"=="" set NODE_ENV=production

cd /d "%~dp0"

echo ==========================================
echo   Nebula-Link Evo Production Startup
echo ==========================================
echo.

REM Check if pnpm is available
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] pnpm not found. Please install pnpm.
    echo         Run: npm install -g pnpm
    exit /b 1
)
echo [OK] pnpm found.
echo.

REM ============================================
REM Step 1: Build shared package
REM ============================================
echo [INFO] Building shared package...
cmd /c shared\build.bat
if %errorlevel% neq 0 (
    echo [ERROR] Shared package build failed.
    exit /b 1
)
echo [OK] Shared package built successfully.
echo.

REM ============================================
REM Step 2: Start LiveKit Server
REM ============================================
echo [INFO] Starting LiveKit Server...
cmd /c tools\livekit\start.bat
if %errorlevel% neq 0 (
    echo [ERROR] LiveKit Server failed to start.
    exit /b 1
)
echo [OK] LiveKit Server started.
echo.

REM ============================================
REM Step 3: Check ports before building
REM ============================================
echo [INFO] Checking ports...
call :check_port 3000
if %errorlevel% neq 0 (
    echo [ERROR] Port 3000 is already in use.
    echo         Run stop.bat to stop the existing service.
    exit /b 1
)
call :check_port 3002
if %errorlevel% neq 0 (
    echo [ERROR] Port 3002 is already in use.
    echo         Run stop.bat to stop the existing service.
    exit /b 1
)
echo [OK] Ports 3000 and 3002 are available.
echo.

REM ============================================
REM Step 4: Build packages sequentially
REM ============================================
echo [INFO] Building proxy-adapter...
cmd /c "cd /d ""%~dp0proxy-adapter"" && pnpm build"
if %errorlevel% neq 0 (
    echo [ERROR] proxy-adapter build failed.
    exit /b 1
)

echo [INFO] Building ai-e2e...
cmd /c "cd /d ""%~dp0ai-e2e"" && pnpm build"
if %errorlevel% neq 0 (
    echo [ERROR] ai-e2e build failed.
    exit /b 1
)

echo [OK] All packages built successfully.
echo.

REM ============================================
REM Step 5: Verify build artifacts
REM ============================================
echo [INFO] Verifying build artifacts...
if not exist "shared\dist\index.js" (
    echo [ERROR] shared\dist\index.js not found.
    exit /b 1
)
if not exist "proxy-adapter\dist\server.js" (
    echo [ERROR] proxy-adapter\dist\server.js not found.
    exit /b 1
)
if not exist "ai-e2e\dist\server.js" (
    echo [ERROR] ai-e2e\dist\server.js not found.
    exit /b 1
)
echo [OK] All build artifacts verified.
echo.

REM ============================================
REM Step 6: Start services
REM ============================================
echo [INFO] Starting services...
echo.

cmd /c proxy-adapter\start.bat --skip-build
if %errorlevel% neq 0 (
    echo [ERROR] Proxy Adapter failed to start.
    exit /b 1
)

cmd /c ai-e2e\start.bat --skip-build
if %errorlevel% neq 0 (
    echo [ERROR] AI E2E failed to start.
    exit /b 1
)

echo.
echo ==========================================
echo   All services started successfully!
echo ==========================================
echo.
echo   Services:
echo     - Proxy Adapter:    http://localhost:3000
echo     - AI E2E:           http://localhost:3002/ai-e2e/
echo     - LiveKit Server:   http://localhost:7880
echo.
echo   Debug UI is a standalone package.
echo   Run start-dev.bat for development, or deploy debug-ui separately.
echo.
echo   Run stop.bat to stop all services.
echo.

goto :eof

REM ============================================
REM Helper: Check if port is listening
REM ============================================
:check_port
netstat -ano | findstr ":%1.*LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    exit /b 1
) else (
    exit /b 0
)
