@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\nodejs22;%PATH%"
echo ============================================
echo   PixelForge Dev Server  ^(Node 22^)
echo ============================================
node -v
call npm -v
echo --------------------------------------------
call npm run dev
echo.
echo [dev server exited] press any key to close this window
pause >nul
