@echo off
rem PackBox Studio launcher (Windows).
rem
rem Double-clicking this file REBUILDS the renderer from the current source and
rem then starts Electron - so after Claude (or anyone) updates the code, the
rem very next launch runs the latest version. Nothing is installed; this script
rem just lives in the project folder.

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo PackBox needs Node.js ^(which includes npm^) to run.
  echo Install it once from https://nodejs.org , then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing dependencies, this takes about a minute...
  call npm install
  if errorlevel 1 (
    echo npm install failed - see the messages above.
    pause
    exit /b 1
  )
)

echo Building the latest version...
call npx vite build --logLevel error
if errorlevel 1 (
  echo Build failed - see the messages above.
  pause
  exit /b 1
)

set PACKBOX_DIST=1
start "" /b cmd /c "npx electron ."
exit /b 0
