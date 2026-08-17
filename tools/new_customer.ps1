# GATA - create (or rebuild) a CUSTOMER app + firmware channel.
#
# Each customer gets:
#   * their own signed firmware list  firmware\customers\<id>\manifest.json
#     (the .bin files stay shared at the root of firmware\ - no duplication),
#   * their own installable app copy  c\<id>\  -> published on the website,
#   * a ZIP to hand over for offline PCs      dist\gata-updater-<id>.zip
#
#   .\new_customer.ps1 -Id acme -Name "ACME Water Systems"
#   .\new_customer.ps1 -Id acme -Name "ACME Water Systems" -FromChannel default
#   .\new_customer.ps1 -Id acme -Name "ACME" -Empty       # start with no versions
#
# Re-running is safe: an existing channel keeps its versions, the app copy and
# ZIP are rebuilt from the current app files.
param(
    [Parameter(Mandatory = $true)] [string]$Id,
    [Parameter(Mandatory = $true)] [string]$Name,
    [string]$FromChannel = "default",
    [switch]$Empty,
    [string]$SiteBase = "https://gata2024.github.io/gata-updater",
    [string]$FirmwareBase = "https://raw.githubusercontent.com/gata2024/gata-firmware/main"
)
$ErrorActionPreference = "Stop"

if ($Id -notmatch '^[a-z0-9][a-z0-9-]{1,30}$') {
    throw "Customer id must be lowercase letters, digits and dashes (e.g. 'acme-water'): '$Id'"
}

$app        = Split-Path -Parent $PSScriptRoot
$firmware   = Join-Path $app "firmware"
$chanDir    = Join-Path $firmware "customers\$Id"
$appCopy    = Join-Path $app "c\$Id"
$distDir    = Join-Path $app "dist"
$manifestUrl = "$FirmwareBase/customers/$Id/manifest.json"
$appUrl      = "$SiteBase/c/$Id/"

Write-Host "== GATA customer package: $Name ($Id) ==" -ForegroundColor Cyan

# ---------------------------------------------------------------- 1. channel
if (-not (Test-Path $chanDir)) { New-Item -ItemType Directory -Force $chanDir | Out-Null }
$chanManifest = Join-Path $chanDir "manifest.json"

if (-not (Test-Path $chanManifest)) {
    $versions = @()
    if (-not $Empty) {
        $srcPath = if ($FromChannel -eq "default") { Join-Path $firmware "manifest.json" }
                   else { Join-Path $firmware "customers\$FromChannel\manifest.json" }
        if (-not (Test-Path $srcPath)) { throw "Source channel not found: $srcPath" }
        $src = Get-Content $srcPath -Raw -Encoding UTF8 | ConvertFrom-Json
        # Copy the version list, re-pointing every URL at the shared root.
        $json = $src.versions | ConvertTo-Json -Depth 10
        $json = $json -replace '"url":\s*"(?!\.\./)', '"url":  "../../'
        $versions = @($json | ConvertFrom-Json)
        Write-Host "  seeded from channel '$FromChannel' ($($versions.Count) version(s))"
    } else {
        Write-Host "  created empty (publish a version with publish_firmware.ps1 -Customer $Id)"
    }
    $out = [ordered]@{
        product  = "GATA Controller"
        channel  = $Id
        customer = $Name
        updated  = (Get-Date -Format "yyyy-MM-dd")
        versions = @($versions)
    }
    [IO.File]::WriteAllText($chanManifest, ($out | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
} else {
    Write-Host "  channel already exists - keeping its versions"
    $cur = Get-Content $chanManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cur.customer -ne $Name -or $cur.channel -ne $Id) {
        $cur | Add-Member -NotePropertyName customer -NotePropertyValue $Name -Force
        $cur | Add-Member -NotePropertyName channel  -NotePropertyValue $Id   -Force
        [IO.File]::WriteAllText($chanManifest, ($cur | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
    }
}

# sign it (an unsigned channel is refused by every app)
& (Join-Path $PSScriptRoot 'sign_manifest.ps1') -Path $chanManifest
if ($LASTEXITCODE -ne 0) { throw "Signing failed for $chanManifest" }

# ---------------------------------------------------------------- 2. app copy
if (Test-Path $appCopy) { Remove-Item $appCopy -Recurse -Force }
New-Item -ItemType Directory -Force $appCopy | Out-Null
foreach ($item in @("index.html", "sw.js", "app.webmanifest", "icon.svg", "icon-maskable.svg",
                    "icon-192.png", "icon-512.png", "icon-512-maskable.png", "icon-180.png",
                    "css", "js")) {
    $src = Join-Path $app $item
    if (Test-Path $src) { Copy-Item $src (Join-Path $appCopy $item) -Recurse -Force }
}

# config.js: pin the channel + this customer's firmware list
$cfgPath = Join-Path $appCopy "js\config.js"
$cfg = [IO.File]::ReadAllText($cfgPath)
$cfg = [regex]::Replace($cfg, 'cloudManifestUrl:\s*"[^"]*"', 'cloudManifestUrl: "' + $manifestUrl + '"')
$cfg = [regex]::Replace($cfg, 'channel:\s*"[^"]*"', 'channel: "' + $Id + '"')
if ($cfg -notmatch 'channel:\s*"') {
    $cfg = $cfg -replace '(\s*)productName:', ('$1channel: "' + $Id + '",$1customerName: "' + $Name + '",$1productName:')
} else {
    $cfg = [regex]::Replace($cfg, 'customerName:\s*"[^"]*"', 'customerName: "' + ($Name -replace '"','') + '"')
}
[IO.File]::WriteAllText($cfgPath, $cfg, (New-Object Text.UTF8Encoding $false))

# web manifest: own identity so it installs as a separate app
$wmPath = Join-Path $appCopy "app.webmanifest"
$wm = Get-Content $wmPath -Raw -Encoding UTF8 | ConvertFrom-Json
$wm.id = "gata-updater-$Id"
$wm.name = "GATA Updater - $Name"
$wm.short_name = "GATA Update"
$wm.start_url = "."
[IO.File]::WriteAllText($wmPath, ($wm | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))

# page title carries the customer name
$idxPath = Join-Path $appCopy "index.html"
$idx = [IO.File]::ReadAllText($idxPath)
$safeName = $Name -replace '[<>&"]', ''
$idx = $idx -replace '<title>[^<]*</title>', ("<title>GATA Firmware Updater - " + $safeName + "</title>")
[IO.File]::WriteAllText($idxPath, $idx, (New-Object Text.UTF8Encoding $false))
Write-Host "  app copy   : c\$Id"

# ---------------------------------------------------------------- 3. hand-off ZIP
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Force $distDir | Out-Null }
$stage = Join-Path $env:TEMP "gata-pkg-$Id"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item (Join-Path $appCopy "*") $stage -Recurse -Force
Copy-Item (Join-Path $app "CLICK_ME_START_ON_PC.bat") $stage -Force
New-Item -ItemType Directory -Force (Join-Path $stage "tools") | Out-Null
foreach ($t in @("serve.ps1", "enable_auto_connect.ps1", "check_auto_connect.ps1",
                 "install_dfu_driver.ps1", "INSTALL_DFU_DRIVER.bat", "set_firmware_source.ps1")) {
    $src = Join-Path $PSScriptRoot $t
    if (Test-Path $src) { Copy-Item $src (Join-Path $stage "tools\$t") -Force }
}
# the offline proxy fallback points at this customer's channel too
$fs = [ordered]@{ baseUrl = "$FirmwareBase/customers/$Id/"; token = ""
                  note = "Firmware source for $Name. Managed by tools\set_firmware_source.ps1." }
[IO.File]::WriteAllText((Join-Path $stage "tools\firmware_source.example.json"),
                        ($fs | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
$readme = @"
GATA Firmware Updater - $Name
=============================

Install on a PC
  1. Unzip this folder anywhere (e.g. Desktop).
  2. Double-click CLICK_ME_START_ON_PC.bat  (say Yes to the one-time
     Windows prompt - it makes the USB connection automatic).
  3. Connect the controller with a USB cable and press the update button.

Install on an Android phone
  Open $appUrl in Chrome,
  then menu (three dots) -> Install app. Connect the controller with a
  USB-OTG adapter.

New firmware appears automatically - there is nothing to reinstall.
Support: send the "Technical log" (Save button) if an update ever stops.
"@
[IO.File]::WriteAllText((Join-Path $stage "READ ME FIRST.txt"), $readme, (New-Object Text.UTF8Encoding $false))

$zip = Join-Path $distDir "gata-updater-$Id.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
Remove-Item $stage -Recurse -Force
Write-Host ("  hand-off   : dist\gata-updater-{0}.zip ({1:N0} KB)" -f $Id, ((Get-Item $zip).Length / 1KB))

# ---------------------------------------------------------------- 4. summary
Write-Host ""
Write-Host "DONE." -ForegroundColor Green
Write-Host "  Customer app URL : $appUrl"
Write-Host "  Firmware channel : $manifestUrl"
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. publish firmware for this customer:"
Write-Host "     .\publish_firmware.ps1 -Version <v> -Main <M.bin> -Customer $Id"
Write-Host "  2. push both repositories (app + firmware) so the URLs go live."
