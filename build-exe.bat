@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Smart Scanner - Build Windows installer (Tauri)

echo.
echo ============================================================
echo   Smart Scanner  -  Windows installer (Tauri, no Electron)
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Get the LTS version from https://nodejs.org
  pause
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where cargo >nul 2>nul
if errorlevel 1 (
  echo [INFO] Rust is required once to build the installer.
  echo        Needed: Rust + Visual Studio Build Tools ^(Desktop development with C++^).
  where winget >nul 2>nul
  if errorlevel 1 (
    echo   Install manually: https://rustup.rs  and  https://visualstudio.microsoft.com/visual-cpp-build-tools/
    pause
    exit /b 1
  )
  choice /m "Install them automatically now (internet required)"
  if errorlevel 2 exit /b 1
  winget install -e --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  winget install -e --id Rustlang.Rustup
  echo.
  echo [DONE] Close this window and run build-exe.bat again.
  pause
  exit /b 0
)

echo [1/3] Installing dependencies...
call npm install
if errorlevel 1 goto :error

echo.
echo [2/3] Building app + installer (first build takes several minutes)...
call npx tauri build
if errorlevel 1 goto :error

echo.
echo [3/3] Collecting the installer...
if not exist release mkdir release
copy /y "src-tauri\target\release\bundle\nsis\*.exe" "release\" >nul
if errorlevel 1 goto :error

echo.
echo ============================================================
echo   DONE!  Installer is in the "release" folder.
echo ============================================================
echo   - Run the setup, then open Smart Scanner once.
echo   - From then on it stays running in the background (tray) and
echo     starts silently with Windows, so it opens instantly.
echo.
start "" explorer release
pause
exit /b 0

:error
echo.
echo [ERROR] The build failed. Please read the messages above.
pause
exit /b 1
