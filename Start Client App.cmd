@echo off
setlocal
cd /d "%~dp0Client App"

for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "$dir=Join-Path $env:LOCALAPPDATA 'EPOS Accountancy'; $path=Join-Path $dir 'payroll-integration-secret.txt'; $secret=if(Test-Path -LiteralPath $path){(Get-Content -Raw -LiteralPath $path).Trim()}else{''}; if($secret.Length -lt 32){New-Item -ItemType Directory -Force -Path $dir ^| Out-Null; $bytes=New-Object byte[] 32; $rng=[Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose(); $secret=-join ($bytes ^| ForEach-Object {$_.ToString('x2')}); [IO.File]::WriteAllText($path,$secret)}; $secret"`) do set "PAYROLL_INTEGRATION_SECRET=%%S"

start "EPOS Payroll Worker" /min powershell -NoProfile -Command "$env:PAYFLOW_NODE_PREVIEW='1'; $env:PAYFLOW_LOCAL_DB='%~dp0Payroll 2\data\payroll.sqlite'; $env:PAYROLL_INTEGRATION_SECRET='%PAYROLL_INTEGRATION_SECRET%'; $env:Path=$env:USERPROFILE+'\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;'+$env:Path; Set-Location -LiteralPath '%~dp0Payroll 2'; & node '.\node_modules\vite\bin\vite.js' --host 127.0.0.1 --port 3102 --strictPort"
start "EPOS Accountancy API" /min powershell -NoProfile -Command "$env:PAYROLL_WORKER_URL='http://127.0.0.1:3102'; $env:PAYROLL_INTEGRATION_SECRET='%PAYROLL_INTEGRATION_SECRET%'; Set-Location -LiteralPath '%~dp0Client App\backend'; & '.\.venv\Scripts\python.exe' -m uvicorn server:app --host 0.0.0.0 --port 8000"
start "EPOS Accountancy Frontend" /min powershell -NoProfile -Command "Set-Location -LiteralPath '%~dp0Client App\frontend'; $env:BROWSER='none'; $env:PORT='3000'; & '.\node_modules\.bin\craco.cmd' start"

echo Client App services are starting:
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:8000
echo   Payroll:  private worker on http://localhost:3102
endlocal
