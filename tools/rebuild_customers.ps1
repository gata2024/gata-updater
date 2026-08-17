# GATA - refresh EVERY customer's app copy from the current app files.
#
# Each company has its own copy of the app under c\<id>\ (that is what makes
# their install a separate app with their own firmware channel). After you
# change anything in the app - a fix, a new version - run this once so every
# company gets it. Firmware channels and their versions are untouched.
#
#   .\rebuild_customers.ps1              # rebuild all customer app copies + ZIPs
#   .\rebuild_customers.ps1 -Apk         # ...and rebuild each customer's .apk too
param([switch]$Apk)
$ErrorActionPreference = "Stop"

$app      = Split-Path -Parent $PSScriptRoot
$custRoot = Join-Path $app "firmware\customers"
if (-not (Test-Path $custRoot)) { Write-Host "No customers yet."; exit 0 }

$dirs = Get-ChildItem $custRoot -Directory
if (-not $dirs) { Write-Host "No customers yet."; exit 0 }

Write-Host "Refreshing $($dirs.Count) customer package(s) with the current app files..." -ForegroundColor Cyan
foreach ($d in $dirs) {
    $mf = Join-Path $d.FullName "manifest.json"
    if (-not (Test-Path $mf)) { Write-Host "  skip $($d.Name): no manifest"; continue }
    $m = Get-Content $mf -Raw -Encoding UTF8 | ConvertFrom-Json
    $name = if ($m.customer) { $m.customer } else { $d.Name }
    & (Join-Path $PSScriptRoot 'new_customer.ps1') -Id $d.Name -Name $name |
        Select-String -Pattern "app copy|hand-off|ERROR" | ForEach-Object { "  $_" }
    if ($Apk) {
        & (Join-Path $PSScriptRoot 'build_android_app.ps1') -Id $d.Name -Name $name |
            Select-String -Pattern "APK:|BUILD FAILED" | ForEach-Object { "  $_" }
    }
}
Write-Host ""
Write-Host "Done. Push the app repository so the hosted copies update:" -ForegroundColor Green
Write-Host "  git add -A; git commit -m ""refresh customer apps""; git push github main"
