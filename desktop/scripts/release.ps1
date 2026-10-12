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

function Add-DdgsRuntime {
    $PythonVersion = '3.13.16'
    $PythonSha256 = '589dc1e9d02549ca5f680710307ff9b77f6e3ffc4aa3efccd7fa54eeeafac94b'
    $PipVersion = '26.2.1'
    $PipSha256 = '71138adf1f4ca900cdb7d289c21b7494329f2332b6d85f0e1c42108c0384ed3e'
    $Downloads = Join-Path $DesktopDir 'bin\downloads'
    New-Item -ItemType Directory -Force $Downloads | Out-Null
    $PythonZip = Join-Path $Downloads "python-$PythonVersion-embeddable-amd64.zip"
    $PipWheel = Join-Path $Downloads "pip-$PipVersion-py3-none-any.whl"
    if (-not (Test-Path -LiteralPath $PythonZip)) {
        Invoke-WebRequest -UseBasicParsing -Uri "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embeddable-amd64.zip" -OutFile $PythonZip
    }
    if (-not (Test-Path -LiteralPath $PipWheel)) {
        Invoke-WebRequest -UseBasicParsing -Uri "https://files.pythonhosted.org/packages/f3/6e/1736e5b4ae2b778ef2f81c47d797de9f891d4d8acb047a24ca37a60294dd/pip-$PipVersion-py3-none-any.whl" -OutFile $PipWheel
    }
    if ((Get-FileHash -LiteralPath $PythonZip -Algorithm SHA256).Hash -ne $PythonSha256.ToUpperInvariant()) {
        throw 'Python embeddable checksum mismatch.'
    }
    if ((Get-FileHash -LiteralPath $PipWheel -Algorithm SHA256).Hash -ne $PipSha256.ToUpperInvariant()) {
        throw 'pip wheel checksum mismatch.'
    }

    $DdgsDir = Join-Path $RuntimeDir 'ddgs'
    Expand-Archive -LiteralPath $PythonZip -DestinationPath $DdgsDir -Force
    $SitePackages = Join-Path $DdgsDir 'Lib\site-packages'
    New-Item -ItemType Directory -Force $SitePackages | Out-Null
    $Pth = Join-Path $DdgsDir 'python313._pth'
    $Lines = Get-Content -LiteralPath $Pth | ForEach-Object { $_ -replace '^#\s*import site$', 'import site' }
    if ($Lines -notcontains 'Lib\site-packages') { $Lines += 'Lib\site-packages' }
    Set-Content -LiteralPath $Pth -Value $Lines -Encoding ascii

    $PythonExe = Join-Path $DdgsDir 'python.exe'
    Invoke-Checked $PythonExe @(
        (Join-Path $DesktopDir 'build\install-ddgs.py'),
        $PipWheel,
        'install',
        '--no-warn-script-location',
        '--no-compile',
        '--only-binary=:all:',
        '--target', $SitePackages,
        '-r', (Join-Path $DesktopDir 'build\ddgs-requirements.txt')
    )
    Invoke-Checked $PythonExe @('-c', 'import ddgs.ddgs, click, lxml, primp')

    $Licenses = Join-Path $DdgsDir 'licenses'
    New-Item -ItemType Directory -Force $Licenses | Out-Null
    Copy-Item -LiteralPath (Join-Path $DdgsDir 'LICENSE.txt') -Destination (Join-Path $Licenses 'PYTHON-LICENSE.txt')
    Get-ChildItem -LiteralPath $SitePackages -Directory -Filter '*.dist-info' | ForEach-Object {
        $DistInfo = $_
        $LicenseDir = Join-Path $DistInfo.FullName 'licenses'
        if (Test-Path -LiteralPath $LicenseDir) {
            Get-ChildItem -LiteralPath $LicenseDir -File | ForEach-Object {
                Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Licenses "$($DistInfo.Name -replace '\.dist-info$', '')-$($_.Name)")
            }
        }
    }
    Copy-Item -LiteralPath (Join-Path $DesktopDir 'build\licenses\primp-LICENSE.txt') -Destination (Join-Path $Licenses 'primp-2.0.1-LICENSE.txt')
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

Add-DdgsRuntime

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
