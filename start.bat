@echo off
setlocal EnableDelayedExpansion

:: ============================================
:: Configuration
:: ============================================
:: Get ESC character for ANSI colors using for loop (more reliable)
for /f %%A in ('powershell -c "[char]27"') do set "ESC=%%A"
set "GREEN=%ESC%[92m"
set "YELLOW=%ESC%[93m"
set "RED=%ESC%[91m"
set "BLUE=%ESC%[94m"
set "NC=%ESC%[0m"
:: Pre-defined error messages (avoid expansion issues in if blocks)
set "ERR_TIMEOUT=%ESC%[91m  ERROR: Build timeout (60 seconds)%ESC%[0m"
set "ERR_SHARED_FAIL=%ESC%[91m  ERROR: Shared package build failed%ESC%[0m"
set "ERR_PW_FAIL=%ESC%[91m  ERROR: Playwright build failed%ESC%[0m"
set "ERR_PROXY_FAIL=%ESC%[91m  ERROR: Proxy build failed%ESC%[0m"
set "ERR_DEBUG_UI_FAIL=%ESC%[91m  ERROR: Debug UI build failed%ESC%[0m"
set "ERR_SHARED_ARTIFACT=%ESC%[91m  ERROR: Shared build artifact not found%ESC%[0m"
set "ERR_PW_ARTIFACT=%ESC%[91m  ERROR: Playwright build artifact not found%ESC%[0m"
set "ERR_PROXY_ARTIFACT=%ESC%[91m  ERROR: Proxy build artifact not found%ESC%[0m"
set "ERR_DEBUG_UI_ARTIFACT=%ESC%[91m  ERROR: Debug UI build artifact not found%ESC%[0m"
set "SUCCESS_BUILD=%ESC%[92m  Build completed successfully%ESC%[0m"

set "LK_DIR=%~dp0tools\livekit"
set "LK_BINARY=%LK_DIR%\livekit-server.exe"
set "LK_VERSION_FILE=%LK_DIR%\.version"
set "LK_API_URL=https://api.github.com/repos/livekit/livekit/releases/latest"
set "LK_ZIP_NAME="
set "LK_CURRENT_VERSION="

set "PID_DIR=%TEMP%\nebula-link-pids"
set "PW_PID_FILE=%PID_DIR%\playwright.pid"
set "PROXY_PID_FILE=%PID_DIR%\proxy.pid"
set "LK_PID_FILE=%PID_DIR%\livekit.pid"

:: Read current installed version
if exist "%LK_VERSION_FILE%" (
    set /p LK_CURRENT_VERSION=<"%LK_VERSION_FILE%"
)
set "BUILD_LOG=%TEMP%\nebula-build"
set "FAILED_FILE=%TEMP%\nebula-build-failed.tmp"
if not exist "%PID_DIR%" mkdir "%PID_DIR%"
cd /d "%~dp0"

echo %BLUE%========================================%NC%
echo %YELLOW%  Starting Nebula-Link Evo%NC%
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
:: Step 1.5: Ensure LiveKit Server
:: ============================================
echo.
echo [1.5/4] Checking LiveKit Server...

:: Check if curl is available
where curl >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%ERROR: curl not found. Required for LiveKit auto-download.%NC%
    echo %YELLOW%  Install curl or manually download livekit-server to tools/livekit/%NC%
    exit /b 1
)

:: Query latest version from GitHub API via PowerShell
for /f %%V in ('powershell -NoProfile -Command "(Invoke-RestMethod -Uri 'https://api.github.com/repos/livekit/livekit/releases/latest' -Headers @{'User-Agent'='nebula-link'}).tag_name"') do (
    set "LK_LATEST_VERSION=%%V"
)
if "!LK_LATEST_VERSION!"=="" (
    echo %RED%ERROR: Failed to query LiveKit latest version. Check network.%NC%
    exit /b 1
)

:: Strip leading "v" for comparison and display
set "LK_LATEST_CLEAN=!LK_LATEST_VERSION:v=!"

:: Check if binary exists and is up to date
if exist "%LK_BINARY%" (
    if "!LK_CURRENT_VERSION!"=="!LK_LATEST_CLEAN!" (
        echo %GREEN%  LiveKit Server !LK_LATEST_CLEAN! is up to date%NC%
        goto lk_ready
    )
    echo %YELLOW%  LiveKit Server outdated: !LK_CURRENT_VERSION! -^> !LK_LATEST_CLEAN!%NC%
) else (
    echo %YELLOW%  LiveKit Server not found in tools/livekit/%NC%
)

:: Download latest Windows amd64 release
echo   Downloading LiveKit Server !LK_LATEST_CLEAN! ...
set "LK_ZIP=livekit_!LK_LATEST_CLEAN!_windows_amd64.zip"
set "LK_DOWNLOAD_URL=https://github.com/livekit/livekit/releases/download/!LK_LATEST_VERSION!/!LK_ZIP!"

if not exist "%LK_DIR%" mkdir "%LK_DIR%"
curl -sL -o "%LK_DIR%\!LK_ZIP!" "!LK_DOWNLOAD_URL!"
if errorlevel 1 (
    echo %RED%ERROR: Failed to download LiveKit Server%NC%
    exit /b 1
)

:: Extract using PowerShell (tar built-in on Windows 10+)
echo   Extracting...
powershell -NoProfile -Command "Expand-Archive -Path '%LK_DIR%\!LK_ZIP!' -DestinationPath '%LK_DIR%' -Force" >nul 2>&1
if errorlevel 1 (
    echo %RED%ERROR: Failed to extract LiveKit Server%NC%
    del /f "%LK_DIR%\!LK_ZIP!" >nul 2>&1
    exit /b 1
)

:: Cleanup zip
del /f "%LK_DIR%\!LK_ZIP!" >nul 2>&1

:: Verify binary exists after extraction
if not exist "%LK_BINARY%" (
    echo %RED%ERROR: livekit-server.exe not found after extraction%NC%
    exit /b 1
)

:: Save version
echo !LK_LATEST_CLEAN!> "%LK_VERSION_FILE%"
echo %GREEN%  LiveKit Server !LK_LATEST_CLEAN! installed%NC%

:lk_ready

:: ============================================
:: Step 2: Pre-flight checks
:: ============================================
echo.
echo [2/4] Pre-flight checks...
call :check_port 3001
if %errorlevel% neq 0 exit /b 1
call :check_port 3000
if %errorlevel% neq 0 exit /b 1
call :check_port 7880
if %errorlevel% neq 0 exit /b 1
echo %GREEN%  All ports available%NC%

:: ============================================
:: Step 3: Parallel build
:: ============================================
echo.
echo [3/4] Building shared package and production assets...
echo %YELLOW%  Building: shared -> Playwright Server + Proxy Adapter + Debug UI%NC%

:: Clean old PID files
del /f "%PW_PID_FILE%" "%PROXY_PID_FILE%" "%LK_PID_FILE%" "%FAILED_FILE%" >nul 2>&1

:: Build shared package first because other packages depend on it
cd /d "%~dp0shared"
call pnpm build > "%BUILD_LOG%.shared" 2>&1
if errorlevel 1 goto shared_failed
cd "%~dp0"

:: Build remaining packages in parallel using background jobs

:: Create build scripts for each package (avoids nested quote escaping)
echo @echo off > "%TEMP%\build_pw.bat"
echo cd /d "%~dp0playwright-server" >> "%TEMP%\build_pw.bat"
echo call pnpm build ^> "%BUILD_LOG%.pw" 2^>^&1 >> "%TEMP%\build_pw.bat"
echo if errorlevel 1 echo PLAYWRIGHT_BUILD_FAILED ^> "%FAILED_FILE%" >> "%TEMP%\build_pw.bat"

echo @echo off > "%TEMP%\build_proxy.bat"
echo cd /d "%~dp0proxy-adapter" >> "%TEMP%\build_proxy.bat"
echo call pnpm build ^> "%BUILD_LOG%.proxy" 2^>^&1 >> "%TEMP%\build_proxy.bat"
echo if errorlevel 1 echo PROXY_BUILD_FAILED ^> "%FAILED_FILE%" >> "%TEMP%\build_proxy.bat"

echo @echo off > "%TEMP%\build_debug_ui.bat"
echo cd /d "%~dp0debug-ui" >> "%TEMP%\build_debug_ui.bat"
echo call pnpm build ^> "%BUILD_LOG%.debug-ui" 2^>^&1 >> "%TEMP%\build_debug_ui.bat"
echo if errorlevel 1 echo DEBUG_UI_BUILD_FAILED ^> "%FAILED_FILE%" >> "%TEMP%\build_debug_ui.bat"


cd playwright-server
start /min "Playwright Build" cmd /c "%TEMP%\build_pw.bat"
cd "%~dp0"

cd proxy-adapter
start /min "Proxy Build" cmd /c "%TEMP%\build_proxy.bat"
cd "%~dp0"

cd debug-ui
start /min "Debug UI Build" cmd /c "%TEMP%\build_debug_ui.bat"
cd "%~dp0"

:: Wait for builds to complete
set /a wait_count=0
:build_wait_loop
if %wait_count% geq 60 goto build_timeout
timeout /t 1 /nobreak >nul 2>&1

if exist "%FAILED_FILE%" (
    type "%FAILED_FILE%" | findstr "DEBUG_UI" >nul
    if not errorlevel 1 goto debug_ui_failed
    type "%FAILED_FILE%" | findstr "PLAYWRIGHT" >nul
    if not errorlevel 1 goto playwright_failed
    type "%FAILED_FILE%" | findstr "PROXY" >nul
    if not errorlevel 1 goto proxy_failed
)

:: Check if builds still running
tasklist /FI "WINDOWTITLE eq Playwright Build" 2>nul | findstr "cmd.exe" >nul
if %errorlevel% equ 0 (
    set /a wait_count+=1
    goto build_wait_loop
)
tasklist /FI "WINDOWTITLE eq Proxy Build" 2>nul | findstr "cmd.exe" >nul
if %errorlevel% equ 0 (
    set /a wait_count+=1
    goto build_wait_loop
)
tasklist /FI "WINDOWTITLE eq Debug UI Build" 2>nul | findstr "cmd.exe" >nul
if %errorlevel% equ 0 (
    set /a wait_count+=1
    goto build_wait_loop
)

goto build_check_artifacts

:build_timeout
echo %RED%  ERROR: Build timeout (60 seconds)%NC%
exit /b 1

:shared_failed
echo %RED%  ERROR: Shared package build failed%NC%
type "%BUILD_LOG%.shared"
exit /b 1

:playwright_failed
echo %RED%  ERROR: Playwright build failed%NC%
type "%BUILD_LOG%.pw"
exit /b 1

:proxy_failed
echo %RED%  ERROR: Proxy build failed%NC%
type "%BUILD_LOG%.proxy"
exit /b 1

:debug_ui_failed
echo %RED%  ERROR: Debug UI build failed%NC%
type "%BUILD_LOG%.debug-ui"
exit /b 1

:build_check_artifacts
if not exist "shared\dist\index.js" goto shared_artifact_missing
if not exist "playwright-server\dist\server.js" goto playwright_artifact_missing
if not exist "proxy-adapter\dist\server.js" goto proxy_artifact_missing
if not exist "debug-ui\dist\index.html" goto debug_ui_artifact_missing
echo %GREEN%  Build completed successfully%NC%
goto build_done

:shared_artifact_missing
echo %RED%  ERROR: Shared build artifact not found%NC%
exit /b 1

:playwright_artifact_missing
echo %RED%  ERROR: Playwright build artifact not found%NC%
exit /b 1

:proxy_artifact_missing
echo %RED%  ERROR: Proxy build artifact not found%NC%
exit /b 1

:debug_ui_artifact_missing
echo %RED%  ERROR: Debug UI build artifact not found%NC%
exit /b 1

:build_done




:: ============================================
:: Step 4: Start services
:: ============================================
echo.
echo [4/4] Starting services...

:: Start LiveKit Server (dev mode) from project tools/
echo   Starting LiveKit Server...
start "LiveKit Server" cmd /c ""%LK_BINARY%" --dev 2>&1"

:: Wait for LiveKit to be ready
set /a lk_count=0
:wait_livekit
if %lk_count% geq 15 goto livekit_timeout
timeout /t 1 /nobreak >nul 2>&1
netstat -ano | findstr ":7880.*LISTENING" >nul
if errorlevel 1 (
    set /a lk_count+=1
    goto wait_livekit
)
echo %GREEN%  LiveKit Server started on port 7880%NC%
goto start_app_services

:livekit_timeout
echo %RED%  ERROR: LiveKit Server failed to start within 15 seconds%NC%
echo %YELLOW%  Make sure livekit-server is installed and port 7880 is available%NC%
exit /b 1

:start_app_services

:: Start Playwright Server
cd playwright-server
start "Playwright Server" cmd /c "node dist/server.js"
cd "%~dp0"

:: Start Proxy Adapter
cd proxy-adapter
start "Proxy Adapter" cmd /c "set NODE_ENV=production && set DEBUG_UI_DIST_DIR=../debug-ui/dist && node dist/server.js"
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
echo %GREEN%  Services started%NC%
goto summary

:service_timeout
echo %RED%  ERROR: Services failed to start within 30 seconds%NC%
exit /b 1

:summary


:: ============================================
:: Summary
:: ============================================
echo %BLUE%========================================%NC%
echo %GREEN%  All services running%NC%
echo.
echo %YELLOW%  Playwright Server:%NC% http://localhost:3001
echo %YELLOW%  Proxy Adapter:   %NC% http://localhost:3000
echo %YELLOW%  LiveKit Server:  %NC% ws://localhost:7880 (dev mode)
echo %YELLOW%  Debug UI:        %NC% http://localhost:3000/debug/
echo.
echo %BLUE%To stop:%NC% run stop.bat
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
