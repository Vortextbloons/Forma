











$ErrorActionPreference = "Stop"
$DesktopDir = Split-Path -Parent $PSScriptRoot
$ProjectDir = Split-Path -Parent $DesktopDir

function Invoke-App-Build {
    Push-Location (Join-Path $ProjectDir "app")
    try {
        npm install
        npm run build
    }
    finally {
        Pop-Location
    }


    $EmbedTarget = Join-Path $DesktopDir "app\dist"
    if (Test-Path $EmbedTarget) {
        Remove-Item -Recurse -Force $EmbedTarget
    }
    Copy-Item -Recurse (Join-Path $ProjectDir "app\dist") $EmbedTarget
}

function Invoke-Go-Build {
    Push-Location $DesktopDir
    try {
        if (Get-Command wails3 -ErrorAction SilentlyContinue) {
            wails3 build
        }
        else {
            Write-Warning "wails3 CLI not found; falling back to a plain go build (no app packaging)"
            go build -o bin\rigdesktop.exe .
        }
    }
    finally {
        Pop-Location
    }
}

Invoke-App-Build
Invoke-Go-Build
Write-Host "Build complete. Binary in desktop\bin\."
