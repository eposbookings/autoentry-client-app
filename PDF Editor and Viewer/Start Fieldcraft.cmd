@echo off
setlocal
cd /d "%~dp0"

set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON_EXE%" (
  echo.
  echo Fieldcraft's desktop runtime is not installed.
  echo Open this project in Codex and ask it to install the dependencies.
  echo.
  pause
  exit /b 1
)

start "Fieldcraft PDF" "%ELECTRON_EXE%" "%~dp0src\main.cjs"
exit /b 0
