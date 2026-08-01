$ErrorActionPreference = "Stop"

$frontendDirectory = Join-Path $PSScriptRoot "frontend"
$bundledNodeDirectory = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$logPath = Join-Path $env:LOCALAPPDATA "Temp\epos-frontend-local.log"

if (Test-Path (Join-Path $bundledNodeDirectory "node.exe")) {
    $env:Path = "$bundledNodeDirectory;$env:Path"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js could not be found. Install Node.js or restore the bundled Codex Node runtime."
}

$env:BROWSER = "none"
$env:PORT = "3000"
Set-Location -LiteralPath $frontendDirectory
$ErrorActionPreference = "Continue"
& ".\node_modules\.bin\craco.cmd" start *> $logPath
