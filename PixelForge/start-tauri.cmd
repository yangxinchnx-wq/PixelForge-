@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "MINGW=%LOCALAPPDATA%\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
set "PATH=%MINGW%;%USERPROFILE%\.rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin\self-contained;%USERPROFILE%\.cargo\bin;%LOCALAPPDATA%\nodejs22;%PATH%"
echo ============================================
echo   PixelForge Tauri Dev  ^(Node 22 + Rust GNU^)
echo ============================================
node -v
call npm -v
cargo --version
echo --------------------------------------------
echo [hint] first build compiles all Rust deps, please wait...
call npm run tauri dev > "%~dp0tauri-run.log" 2>&1
echo.
echo [tauri dev exited] press any key to close this window
pause >nul
