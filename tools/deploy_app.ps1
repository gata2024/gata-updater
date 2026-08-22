# GATA - publish the app itself (the web app + every company page).
#
# The firmware INSIDE an app lives on the website, not in the .apk. Writing it
# into c\<id> only changes this PC; until the app is pushed, phones keep
# serving the page they already have. That step used to be manual, and a
# forgotten push looked exactly like "the app has no firmware".
#
#   .\deploy_app.ps1 -Message "Danway app firmware"
#   .\deploy_app.ps1 -Message "KSP app" -WaitForUrl https://gata2024.github.io/gata-updater/c/ksp/builtin.json
#
# -WaitForUrl polls until the page is really being served (GitHub Pages needs
# up to a minute), which matters before building an .apk: the Android tooling
# reads the web manifest over the network and would otherwise package the
# previous version.
param(
    [string]$Message = "app update",
    [string]$WaitForUrl,
    [int]$WaitSeconds = 180
)
$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$app = Split-Path -Parent $ScriptDir

if (-not (Test-Path (Join-Path $app ".git"))) {
    Write-Host "This folder is not a git repository - nothing to publish from." -ForegroundColor Yellow
    exit 0
}

$ErrorActionPreference = "Continue"
Push-Location $app
try {
    [Environment]::CurrentDirectory = $app
    $dirty = & git status --porcelain
} finally { Pop-Location }

if (-not $dirty) {
    Write-Host "Nothing changed - the app on the server is already up to date." -ForegroundColor Green
} else {
    Write-Host "Publishing the app..." -ForegroundColor Cyan
    . (Join-Path $ScriptDir "git_publish.ps1")
    if (Publish-Repo -RepoDir $app -Message $Message) {
        Write-Host "PUBLISHED - phones pick it up on their next start with internet." -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "NOT PUBLISHED. The change is on this PC only - phones keep the page they have." -ForegroundColor Red
        Write-Host "Fix the login and push by hand:  cd $app ; git push" -ForegroundColor Red
        exit 1
    }
}

if ($WaitForUrl) {
    Write-Host "Waiting for the page to go live..." -ForegroundColor Cyan
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    $seen = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri ($WaitForUrl + "?t=" + [Guid]::NewGuid().ToString("N")) `
                                   -UseBasicParsing -TimeoutSec 15
            if ($r.StatusCode -eq 200) { $seen = $true; break }
        } catch { }
        Start-Sleep -Seconds 5
    }
    if ($seen) { Write-Host "The page is live." -ForegroundColor Green }
    else { Write-Host "Still not visible after $WaitSeconds s - it usually appears within a minute." -ForegroundColor Yellow }
}
exit 0
