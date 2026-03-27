@echo off
setlocal EnableDelayedExpansion

:: Enable ANSI colors (Windows 10+)
for /f "tokens=3" %%a in ('reg query HKCU\Console /v VirtualTerminalLevel 2^>nul ^| findstr 0x') do set /a "VTL=%%a" >nul 2>&1
if not defined VTL (
    reg add HKCU\Console /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >nul 2>&1
)

:: Get ESC character for ANSI colors
for /f %%A in ('powershell -c "[char]27"') do set "ESC=%%A"

set "PID_DIR=%TEMP%\nebula-link-pids"
set "PW_PID_FILE=%PID_DIR%\playwright.pid"
set "PROXY_PID_FILE=%PID_DIR%\proxy.pid"

mkdir "%PID_DIR%" >nul 2>&1

call :print_header

:: Method 1: Kill by PID files
echo [1/2] Stopping by PID files...

if exist "%PW_PID_FILE%" (
    set /p PW_PID=<"%PW_PID_FILE%"
    call :print_success "  Stopping Playwright (PID: !PW_PID!)"
    taskkill /PID !PW_PID! /F >nul 2>&1
    del "%PW_PID_FILE%" >nul 2>&1
) else (
    echo   Playwright PID file not found
)

if exist "%PROXY_PID_FILE%" (
    set /p PROXY_PID=<"%PROXY_PID_FILE%"
    call :print_success "  Stopping Proxy (PID: !PROXY_PID!)"
    taskkill /PID !PROXY_PID! /F >nul 2>&1
    del "%PROXY_PID_FILE%" >nul 2>&1
) else (
    echo   Proxy PID file not found
)

:: Method 2: Fallback - kill by port
echo.
echo [2/2] Checking for orphaned processes...
for %%P in (3001 3000 5173) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%%P"') do (
        call :print_success "  Stopping process on port %%P (PID: %%a)"
        taskkill /PID %%a /F >nul 2>&1
    )
)

:: Verify
echo.
echo [Verify] Checking ports are free...
for %%P in (3001 3000 5173) do (
    netstat -ano | findstr "LISTENING" | findstr ":%%P" >nul
    if errorlevel 1 (
        call :print_success "  Port %%P is free"
    ) else (
        call :print_error "  Port %%P is still in use"
    )
)

echo.
call :print_footer
exit /b 0

:: Subroutines for colored output
:print_header
echo %ESC%[94m========================================%ESC%[0m
echo %ESC%[93m  Stopping Nebula-Link Evo Services%ESC%[0m
echo %ESC%[94m========================================%ESC%[0m
echo.
exit /b 0

:print_footer
echo %ESC%[94m========================================%ESC%[0m
echo %ESC%[92m  Stop complete!%ESC%[0m
echo %ESC%[94m========================================%ESC%[0m
exit /b 0

:print_success
echo %ESC%[92m%~1%ESC%[0m
exit /b 0

:print_error
echo %ESC%[91m%~1%ESC%[0m
exit /b 0
