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

Push-Location $app
try {
    [Environment]::CurrentDirectory = $app

    # git writes ordinary notices to stderr ("LF will be replaced by CRLF").
    # In PowerShell 5.1 a native command's stderr becomes an ErrorRecord, and
    # with ErrorActionPreference = Stop that ABORTS the script even though git
    # succeeded. Judge git by its exit code, never by its stderr.
    $ErrorActionPreference = "Continue"

    $dirty = & git status --porcelain
    if (-not $dirty) {
        Write-Host "Nothing changed - the app on the server is already up to date." -ForegroundColor Green
    } else {
        Write-Host "Publishing the app..." -ForegroundColor Cyan
        & git -c core.safecrlf=false add -A
        if ($LASTEXITCODE -ne 0) { throw "git add failed" }
        & git -c core.safecrlf=false commit -q -m $Message
        if ($LASTEXITCODE -ne 0) { throw "git commit failed" }
        # 'github' is the remote the live site is served from; some clones only
        # have 'origin'.
        $pushed = $false
        foreach ($remote in @("github", "origin")) {
            $known = & git remote
            if ($known -notcontains $remote) { continue }
            & git push -q $remote main
            if ($LASTEXITCODE -eq 0) { $pushed = $true; break }
            Write-Host "  push to '$remote' did not go through - trying the next remote." -ForegroundColor Yellow
        }
        if (-not $pushed) { throw "git push failed - push it by hand from $app" }
        Write-Host "PUBLISHED - phones pick it up on their next start with internet." -ForegroundColor Green
    }
} finally { Pop-Location }

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
