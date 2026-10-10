@echo off
setlocal

cd /d "%~dp0"

echo [INFO] Building shared package...
call pnpm build

if errorlevel 1 (
    echo [ERROR] Build failed: pnpm build returned error code.
    exit /b 1
)

if not exist "dist\index.js" (
    echo [ERROR] Build failed: dist\index.js not found.
    exit /b 1
)

echo [OK] Shared package built successfully.
exit /b 0
