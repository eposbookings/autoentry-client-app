$ErrorActionPreference = "Stop"

$backendDirectory = Join-Path $PSScriptRoot "backend"
$python = Join-Path $backendDirectory ".venv\Scripts\python.exe"
$logPath = Join-Path $env:LOCALAPPDATA "Temp\epos-backend-local.log"

if (-not (Test-Path $python)) {
    throw "The backend Python virtual environment was not found at $python."
}

if ([string]::IsNullOrWhiteSpace($env:PAYROLL_WORKER_URL)) {
    $env:PAYROLL_WORKER_URL = "http://127.0.0.1:3102"
}
if ([string]::IsNullOrWhiteSpace($env:PAYROLL_INTEGRATION_SECRET) -or $env:PAYROLL_INTEGRATION_SECRET.Length -lt 32) {
    $secretDirectory = Join-Path $env:LOCALAPPDATA "EPOS Accountancy"
    $secretPath = Join-Path $secretDirectory "payroll-integration-secret.txt"
    $secret = if (Test-Path -LiteralPath $secretPath) { (Get-Content -Raw -LiteralPath $secretPath).Trim() } else { "" }
    if ($secret.Length -lt 32) {
        New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes)
        $rng.Dispose()
        $secret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
        [IO.File]::WriteAllText($secretPath, $secret)
    }
    $env:PAYROLL_INTEGRATION_SECRET = $secret
}

Set-Location -LiteralPath $backendDirectory
$ErrorActionPreference = "Continue"
& $python -m uvicorn server:app --host 127.0.0.1 --port 8000 *> $logPath
