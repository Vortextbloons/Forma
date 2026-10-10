param([string]$Repository = 'Vortextbloons/Forma')

$ErrorActionPreference = 'Stop'
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DesktopDir = Join-Path $ProjectDir 'desktop'
$ReleaseDir = Join-Path $DesktopDir 'bin\release'
$PayloadDir = Join-Path $ReleaseDir 'payload'
$RuntimeDir = Join-Path $PayloadDir 'runtime'
$Version = (Get-Content (Join-Path $ProjectDir 'package.json') -Raw | ConvertFrom-Json).version
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Release version must use major.minor.patch.' }
if ((node -p 'process.arch') -ne 'x64') { throw 'Windows releases require x64 Node.' }

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

if (Test-Path -LiteralPath $ReleaseDir) {
    $Resolved = (Resolve-Path -LiteralPath $ReleaseDir).Path
    if (-not $Resolved.StartsWith($DesktopDir + '\bin\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid release output path.' }
    Remove-Item -LiteralPath $Resolved -Recurse -Force
}
New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

Push-Location $ProjectDir
try {
    $env:PUPPETEER_SKIP_DOWNLOAD = 'true'
    Invoke-Checked 'npm.cmd' @('run', 'build', '--workspace', 'app')
    $EmbedDir = Join-Path $DesktopDir 'app\dist'
    if (Test-Path -LiteralPath $EmbedDir) {
        $Resolved = (Resolve-Path -LiteralPath $EmbedDir).Path
        if (-not $Resolved.StartsWith($DesktopDir + '\app\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid embedded asset path.' }
        Remove-Item -LiteralPath $Resolved -Recurse -Force
    }
    Copy-Item -LiteralPath (Join-Path $ProjectDir 'app\dist') -Destination $EmbedDir -Recurse
    Copy-Item -LiteralPath (Join-Path $ProjectDir 'src') -Destination $RuntimeDir -Recurse
    Copy-Item -LiteralPath (Join-Path $ProjectDir 'Prompts') -Destination $RuntimeDir -Recurse
    Copy-Item -LiteralPath (Join-Path $ProjectDir 'vendor') -Destination $RuntimeDir -Recurse
    Copy-Item -LiteralPath (Join-Path $ProjectDir 'package.json'), (Join-Path $ProjectDir 'package-lock.json') -Destination $RuntimeDir
    New-Item -ItemType Directory (Join-Path $RuntimeDir 'app') | Out-Null
    Copy-Item -LiteralPath (Join-Path $ProjectDir 'app\package.json') -Destination (Join-Path $RuntimeDir 'app')
    Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $RuntimeDir 'node.exe')
    $env:PUPPETEER_CACHE_DIR = Join-Path $ReleaseDir 'browser-cache'
    Invoke-Checked 'npx.cmd' @('puppeteer', 'browsers', 'install', 'chrome')
    $Chrome = node --input-type=module -e "import puppeteer from 'puppeteer'; console.log(await puppeteer.executablePath());"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Chrome)) { throw 'Bundled Chrome was not found.' }
    Copy-Item -LiteralPath (Split-Path -Parent $Chrome) -Destination (Join-Path $RuntimeDir 'chrome') -Recurse
} finally { Pop-Location }

Push-Location $RuntimeDir
try { Invoke-Checked 'npm.cmd' @('ci', '--omit=dev') } finally { Pop-Location }

Push-Location $DesktopDir
try {
    $Info = Get-Content 'build\windows\info.json' -Raw | ConvertFrom-Json
    $Info.fixed.file_version = $Version
    $Info.info.'0000'.ProductVersion = $Version
    $Info | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $ReleaseDir 'info.json')
    Invoke-Checked 'wails3' @('generate', 'syso', '-arch', 'amd64', '-icon', 'build/windows/icon.ico', '-manifest', 'build/windows/wails.exe.manifest', '-info', "$ReleaseDir/info.json", '-out', 'release_windows_amd64.syso')
    Invoke-Checked 'wails3' @('generate', 'webview2bootstrapper', '-dir', $ReleaseDir)
    Invoke-Checked 'go' @('build', '-tags', 'production', '-trimpath', '-ldflags', "-s -w -H windowsgui -X rigdesktop/services.Version=$Version -X rigdesktop/services.ReleaseRepository=$Repository", '-o', "$PayloadDir/Forma.exe", '.')
} finally {
    Remove-Item -LiteralPath (Join-Path $DesktopDir 'release_windows_amd64.syso') -ErrorAction SilentlyContinue
    Pop-Location
}

$Makensis = (Get-Command makensis.exe -ErrorAction SilentlyContinue).Source
if (-not $Makensis) { $Makensis = "${env:ProgramFiles(x86)}\NSIS\makensis.exe" }
$Installer = Join-Path $ReleaseDir "Forma-$Version-windows-amd64-setup.exe"
Invoke-Checked $Makensis @("/DVERSION=$Version", "/DPAYLOAD=$PayloadDir", "/DOUTPUT=$Installer", (Join-Path $DesktopDir 'build\windows\release.nsi'))
Write-Host "Release installer: $Installer"
