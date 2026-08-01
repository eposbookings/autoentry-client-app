$ErrorActionPreference = "Stop"

$backendDirectory = Join-Path $PSScriptRoot "backend"
$python = Join-Path $backendDirectory ".venv\Scripts\python.exe"
$logPath = Join-Path $env:LOCALAPPDATA "Temp\epos-backend-local.log"

if (-not (Test-Path $python)) {
    throw "The backend Python virtual environment was not found at $python."
}

Set-Location -LiteralPath $backendDirectory
$ErrorActionPreference = "Continue"
& $python -m uvicorn server:app --host 127.0.0.1 --port 8000 *> $logPath
