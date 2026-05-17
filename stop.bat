@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo ==========================================
echo   Stopping Nebula-Link Evo Services
echo ==========================================
echo.

cmd /c ai-e2e\stop.bat
cmd /c debug-ui\stop.bat
cmd /c proxy-adapter\stop.bat
cmd /c playwright-server\stop.bat
cmd /c tools\livekit\stop.bat

echo.
echo [INFO] Checking all ports are free...
for %%P in (7880 3001 3000 3002 5173) do (
    netstat -ano | findstr ":%%P.*LISTENING" >nul 2>&1
    if errorlevel 1 (
        echo [OK]   Port %%P is free.
    ) else (
        echo [WARN] Port %%P is still in use.
    )
)

echo.
echo ==========================================
echo   Stop complete!
echo ==========================================
exit /b 0
