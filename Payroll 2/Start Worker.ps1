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
    throw "PAYROLL_INTEGRATION_SECRET must be shared with the EPOS backend."
}

$env:PAYFLOW_NODE_PREVIEW = "1"
$env:PAYFLOW_LOCAL_DB = Join-Path $PSScriptRoot "data\payroll.sqlite"
$env:PORT = "3102"
Set-Location -LiteralPath $PSScriptRoot
$ErrorActionPreference = "Continue"
& $node $cli --host 127.0.0.1 --port 3102 --strictPort *> $logPath
