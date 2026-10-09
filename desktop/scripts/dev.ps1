






$ErrorActionPreference = "Stop"
$DesktopDir = Split-Path -Parent $PSScriptRoot
$DefaultProjectDir = Split-Path -Parent $DesktopDir
$ProjectDir = if ($env:RIG_PROJECT_DIR) { $env:RIG_PROJECT_DIR } else { $DefaultProjectDir }

& (Join-Path $PSScriptRoot "build.ps1")

Push-Location $DesktopDir
try {

    $env:RIG_PROJECT_DIR = $ProjectDir
    if (-not $env:RIG_WORKER_ENTRY) {
        $formaWorker = Join-Path $ProjectDir "src\worker\index.ts"
        if (Test-Path $formaWorker) {
            $env:RIG_WORKER_ENTRY = $formaWorker
        }
        else {
            $entry = Join-Path $ProjectDir "node_modules\rig\dist\worker\index.js"
            if (Test-Path $entry) {
                $env:RIG_WORKER_ENTRY = $entry
            }
        }
    }
    go run .
}
finally {
    Pop-Location
}
