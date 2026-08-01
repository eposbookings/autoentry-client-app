$ErrorActionPreference = "Stop"

$node = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$cli = Join-Path $PSScriptRoot "node_modules\vite\bin\vite.js"
$logPath = Join-Path $env:LOCALAPPDATA "Temp\epos-payroll-worker-local.log"

if (-not (Test-Path -LiteralPath $node)) {
    throw "The bundled Node.js runtime was not found at $node."
}
if (-not (Test-Path -LiteralPath $cli)) {
    throw "The Payroll 2 runtime is incomplete. Run pnpm install before starting the worker."
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

$env:PAYFLOW_NODE_PREVIEW = "1"
$env:PAYFLOW_LOCAL_DB = Join-Path $PSScriptRoot "data\payroll.sqlite"
$env:PORT = "3102"
Set-Location -LiteralPath $PSScriptRoot
$ErrorActionPreference = "Continue"
& $node $cli --host 127.0.0.1 --port 3102 --strictPort *> $logPath
