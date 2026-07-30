@echo off
setlocal
cd /d "%~dp0Client App"

start "EPOS Accountancy API" /min powershell -NoProfile -Command "Set-Location -LiteralPath '%~dp0Client App\backend'; & '.\.venv\Scripts\python.exe' -m uvicorn server:app --host 0.0.0.0 --port 8000"
start "EPOS Accountancy Frontend" /min powershell -NoProfile -Command "Set-Location -LiteralPath '%~dp0Client App\frontend'; $env:BROWSER='none'; $env:PORT='3000'; & '.\node_modules\.bin\craco.cmd' start"

echo Client App services are starting:
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:8000
endlocal
