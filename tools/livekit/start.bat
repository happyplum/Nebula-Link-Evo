@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"
set "LK_BINARY=%~dp0livekit-server.exe"
set "LK_VERSION_FILE=%~dp0.version"

echo ==========================================
echo   LiveKit Server
echo ==========================================
echo.

REM Read current installed version
set "LK_CURRENT_VERSION="
if exist "%LK_VERSION_FILE%" (
    for /f "usebackq tokens=1 delims=" %%V in ("%LK_VERSION_FILE%") do set "LK_CURRENT_VERSION=%%V"
)

REM Check if curl is available
where curl >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] curl not found. Required for LiveKit auto-download.
    echo         Install curl or manually download livekit-server to tools/livekit/
    exit /b 1
)

REM Query latest version from GitHub API
echo [INFO] Querying latest LiveKit version...
set "LK_LATEST_VERSION="
powershell -NoProfile -Command "(Invoke-RestMethod -Uri 'https://api.github.com/repos/livekit/livekit/releases/latest' -Headers @{'User-Agent'='nebula-link'}).tag_name" > "%TEMP%\lk_ver.tmp"
for /f "usebackq tokens=1 delims=" %%V in ("%TEMP%\lk_ver.tmp") do set "LK_LATEST_VERSION=%%V"
del /f "%TEMP%\lk_ver.tmp" >nul 2>&1
if "!LK_LATEST_VERSION!"=="" (
    echo [ERROR] Failed to query LiveKit latest version. Check network.
    exit /b 1
)

REM Strip leading "v" for comparison
set "LK_LATEST_CLEAN=!LK_LATEST_VERSION:v=!"

REM Determine if update needed
set "NEED_UPDATE=1"
if exist "%LK_BINARY%" (
    if "!LK_CURRENT_VERSION!"=="!LK_LATEST_CLEAN!" (
        set "NEED_UPDATE=0"
        echo [OK] LiveKit Server !LK_LATEST_CLEAN! is up to date.
    )
)

REM Download if needed
if "!NEED_UPDATE!"=="1" (
    if exist "%LK_BINARY%" (
        echo [INFO] LiveKit Server outdated: !LK_CURRENT_VERSION! -^> !LK_LATEST_CLEAN!
    ) else (
        echo [INFO] LiveKit Server not found in tools/livekit/
    )

    set "LK_ZIP=livekit_!LK_LATEST_CLEAN!_windows_amd64.zip"
    set "LK_DOWNLOAD_URL=https://github.com/livekit/livekit/releases/download/!LK_LATEST_VERSION!/!LK_ZIP!"

    echo [INFO] Downloading LiveKit Server !LK_LATEST_CLEAN! ...
    curl -sL -o "%~dp0!LK_ZIP!" "!LK_DOWNLOAD_URL!"
    if errorlevel 1 (
        echo [ERROR] Failed to download LiveKit Server.
        exit /b 1
    )

    echo [INFO] Extracting...
    powershell -NoProfile -Command "Expand-Archive -Path '%~dp0!LK_ZIP!' -DestinationPath '%~dp0' -Force" >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Failed to extract LiveKit Server.
        del /f "%~dp0!LK_ZIP!" >nul 2>&1
        exit /b 1
    )
    del /f "%~dp0!LK_ZIP!" >nul 2>&1

    if not exist "%LK_BINARY%" (
        echo [ERROR] livekit-server.exe not found after extraction.
        exit /b 1
    )

    echo !LK_LATEST_CLEAN!> "%LK_VERSION_FILE%"
    echo [OK] LiveKit Server !LK_LATEST_CLEAN! installed.
)

REM Start LiveKit Server
echo.
echo [INFO] Starting LiveKit Server...
REM LiveKit 1.13+ removed the --log-level CLI flag; use env var instead
set "LIVEKIT_LOG_LEVEL=error"
REM Filter harmless "CPU monitoring unsupported" error on Windows
start "LiveKit Server" cmd /c ""%LK_BINARY%" --dev 2>&1 | findstr /v /c:"CPU monitoring unsupported""

REM Wait for port 7880
set /a lk_count=0
:wait_livekit
if !lk_count! geq 15 goto livekit_timeout
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr ":7880.*LISTENING" >nul 2>&1
if errorlevel 1 (
    set /a lk_count+=1
    goto wait_livekit
)
echo [OK] LiveKit Server started on port 7880.
exit /b 0

:livekit_timeout
echo [ERROR] LiveKit Server failed to start within 15 seconds.
echo         Make sure livekit-server is installed and port 7880 is available.
exit /b 1
