@echo off
setlocal EnableDelayedExpansion

set NODE_ENV=development
set LOG_LEVEL=info

cd /d "%~dp0"

echo ==========================================
echo   Nebula-Link Evo - Dev Mode
echo ==========================================
echo.

REM Step 1: Build and start backend services
echo [1/2] Starting backend services...
cmd /c start.bat
if %errorlevel% neq 0 (
    echo [ERROR] Backend services failed to start.
    exit /b 1
)

REM Step 2: Start Debug UI dev server
echo.
echo [2/2] Starting Debug UI dev server...
cmd /c apps\debug-ui\start.bat
if %errorlevel% neq 0 (
    echo [ERROR] Debug UI failed to start.
    exit /b 1
)

echo.
echo ==========================================
echo   Development mode ready!
echo.
echo   Services:
echo     Proxy Adapter:     http://localhost:3000
echo     AI Chat Service:   http://localhost:3001
echo     AI E2E:            http://localhost:3002/ai-e2e/
echo     LiveKit Server:    ws://localhost:7880
echo     Debug UI:          http://localhost:5173/debug/
echo.
echo   API Endpoints:
echo     Proxy Health:      http://localhost:3000/api/v1/health
echo     AI Chat Health:    http://localhost:3001/health
echo     Debug Health:      http://localhost:3000/debug/api/health
echo.
echo   SSE Endpoints:
echo     Debug SSE:         http://localhost:3000/debug/api/stream
echo     Chat SSE:          http://localhost:3001/api/v1/chat/sessions/{sessionId}/stream
echo.
echo To stop: run stop.bat
echo ==========================================
echo.

exit /b 0
