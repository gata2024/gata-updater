# GATA - build ONE COMPANY'S hosted app, at c\<id>\.
#
# This is what the company's Android app opens. It is a complete, standalone
# copy of the updater:
#   - pinned to that company's channel and firmware list (cloudManifestUrl)
#   - carrying that company's license file
#   - carrying that company's OWN built-in firmware, so the phone can install
#     with no internet
#
# The shared app at the site root stays the General one; each company lives in
# its own folder, so their cloud firmware AND their local firmware differ.
#
#   .\build_customer_site.ps1 -Id ksp -Board rev5 `
#        -Controller ..\..\g_500\Debug\NPC20_mini.bin `
#        -System ..\..\USBupdaterCode_relbuild\Debug\Booster_phase.bin `
#        -EspDir ..\..\esp\.pio\build\esp32dev
#
# Then publish the site (git push in this folder) and build the APK:
#   .\build_android_app.ps1 -Id ksp -Name "KSP"
param(
    [Parameter(Mandatory = $true)] [string]$Id,
    [string]$Name,
    [ValidateSet("rev5", "rev6", "all")] [string]$Board = "rev5",
    [string]$Controller,
    [string]$System,
    [string]$EspDir,
    [switch]$NoEsp,
    [string]$SiteBase = "https://raw.githubusercontent.com/gata2024/gata-firmware/main"
)
$ErrorActionPreference = "Stop"

# $PSScriptRoot is empty while PARAMETER DEFAULTS are evaluated in a script
# that uses [Parameter()] - resolve it in the body, where it really exists.
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$app  = Split-Path -Parent $ScriptDir
$site = Join-Path $app "c\$Id"

if ($Id -notmatch '^[a-z0-9][a-z0-9-]{1,30}$') { throw "Company id must be lowercase letters, digits and dashes: '$Id'" }
if ($Id -eq "default") {
    # General already IS the site root - that is the app built_android_app.ps1
    # produces with no -Id. A c\default folder would also make the package name
    # com.gata.updater.default, which Android rejects ("default" is a Java
    # keyword). Refresh the root instead: Release Manager -> FIRMWARE INSIDE THE APP.
    throw "General is the site root, not a c\ folder. Use the FIRMWARE INSIDE THE APP button (or tools\refresh_builtin.ps1) for General, and this script for the other companies."
}

# ------------------------------------------------- who is this, and which list
$isDefault = $false
$chanManifest = Join-Path $app "firmware\customers\$Id\manifest.json"
if (-not (Test-Path $chanManifest)) {
    throw "Channel '$Id' does not exist yet. Create it with:  .\new_customer.ps1 -Id $Id -Name ""<company>"""
}
if (-not $Name) {
    try { $Name = (Get-Content $chanManifest -Raw -Encoding UTF8 | ConvertFrom-Json).customer } catch { }
    if (-not $Name) { $Name = $Id }
}
$manifestUrl = if ($isDefault) { "$SiteBase/manifest.json" } else { "$SiteBase/customers/$Id/manifest.json" }

Write-Host "== Company app: $Name  (channel $Id, $Board) ==" -ForegroundColor Cyan
Write-Host "   folder     : c\$Id"
Write-Host "   firmware   : $manifestUrl"

# ------------------------------------------------------------ the license file
function Find-License([string]$channel) {
    $dir = Join-Path $ScriptDir "licenses"
    if (-not (Test-Path $dir)) { return $null }
    foreach ($f in Get-ChildItem $dir -Filter *.license) {
        try {
            $parts = (Get-Content $f.FullName -Raw).Trim().Split('.')
            if ($parts.Length -ne 3) { continue }
            $s = $parts[1].Replace('-', '+').Replace('_', '/')
            switch ($s.Length % 4) { 2 { $s += "==" } 3 { $s += "=" } }
            $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s))
            if ($json.Replace(" ", "").Contains('"channel":"' + $channel + '"')) { return $f.FullName }
        } catch { }
    }
    return $null
}
$licFile = Find-License $Id
if (-not $licFile) { throw "No license file for channel '$Id' in tools\licenses. Mint one with make_license.ps1." }

# ------------------------------------------------------------------ app copy
if (Test-Path $site) { Remove-Item $site -Recurse -Force }
New-Item -ItemType Directory -Force $site | Out-Null
foreach ($item in @("index.html", "sw.js", "app.webmanifest", "icon.svg", "icon-maskable.svg",
                    "icon-192.png", "icon-512.png", "icon-512-maskable.png", "icon-180.png",
                    "css", "js", "img")) {
    $src = Join-Path $app $item
    if (Test-Path $src) { Copy-Item $src (Join-Path $site $item) -Recurse -Force }
}
Copy-Item $licFile (Join-Path $site "gata.license") -Force
Write-Host "   license    : $(Split-Path -Leaf $licFile)  ->  gata.license"

# ---------------------------------------- config.js: pin channel + firmware list
$cfgPath = Join-Path $site "js\config.js"
$cfg = [IO.File]::ReadAllText($cfgPath)
$cfg = [regex]::Replace($cfg, 'cloudManifestUrl:\s*"[^"]*"', 'cloudManifestUrl: "' + $manifestUrl + '"')
$cfg = [regex]::Replace($cfg, 'channel:\s*"[^"]*"', 'channel: "' + $Id + '"')
if ($cfg -match 'customerName:\s*"') {
    $cfg = [regex]::Replace($cfg, 'customerName:\s*"[^"]*"', 'customerName: "' + ($Name -replace '"', '') + '"')
}
[IO.File]::WriteAllText($cfgPath, $cfg, (New-Object Text.UTF8Encoding $false))
$version = ([regex]::Match($cfg, 'version:\s*"([^"]+)"')).Groups[1].Value
Write-Host "   app version: $version   channel pinned to '$Id'"

# ------------------------------------------ its own identity when installed
$wmPath = Join-Path $site "app.webmanifest"
$wm = Get-Content $wmPath -Raw -Encoding UTF8 | ConvertFrom-Json
$wm.id = "gata-updater-$Id"
$wm.name = "GATA Updater - $Name"
$wm.short_name = "GATA Update"
$wm.start_url = "."
[IO.File]::WriteAllText($wmPath, ($wm | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))

$idxPath = Join-Path $site "index.html"
$idx = [IO.File]::ReadAllText($idxPath)
$idx = $idx -replace '<title>[^<]*</title>', ("<title>GATA Firmware Updater - " + ($Name -replace '[<>&"]', '') + "</title>")
[IO.File]::WriteAllText($idxPath, $idx, (New-Object Text.UTF8Encoding $false))

# ------------------------------------------- the firmware that ships INSIDE it
$mainDir  = Join-Path $site "main_firmware"
$cloudDir = Join-Path $site "cloud_firmware"
New-Item -ItemType Directory -Force $mainDir  | Out-Null
New-Item -ItemType Directory -Force $cloudDir | Out-Null

$tag = (Get-Date -Format "dd_MM_yy") + "_" + ($Name -replace '[^0-9A-Za-z]', '') + "_" + $Board
$receipt = [ordered]@{}
$builtAt = [ordered]@{}
function Put([string]$src, [string]$folder, [string]$destName) {
    if (-not $src -or -not (Test-Path $src)) { return $false }
    $dst = Join-Path (Join-Path $script:site $folder) $destName
    Copy-Item $src $dst -Force
    $a = (Get-FileHash $src -Algorithm SHA256).Hash.ToLower()
    $b = (Get-FileHash $dst -Algorithm SHA256).Hash.ToLower()
    if ($a -ne $b) { Write-Host "   !! COPY MISMATCH: $destName" -ForegroundColor Red; return $false }
    $script:receipt["$folder/$destName"] = $b
    $script:builtAt["$folder/$destName"] = (Get-Item $src).LastWriteTime.ToString("yyyy-MM-dd HH:mm")
    Write-Host ("      {0}\{1}   [{2}]   built {3}" -f $folder, $destName, $b.Substring(0, 12),
                (Get-Item $src).LastWriteTime.ToString("yyyy-MM-dd HH:mm"))
    return $true
}

$n = 0
if (Put $Controller "main_firmware" ("controller_" + $tag + ".bin")) { $n++ }
if (Put $System     "main_firmware" ("system_"     + $tag + ".bin")) { $n++ }
if (-not $NoEsp -and $EspDir -and (Test-Path $EspDir)) {
    foreach ($part in @("bootloader.bin", "partitions.bin", "boot_app0.bin", "firmware.bin")) {
        if (Put (Join-Path $EspDir $part) "cloud_firmware" $part) { $n++ }
        else { Write-Host "      ! missing ESP file: $part" -ForegroundColor Yellow }
    }
}

# The receipt the app checks its own built-in firmware against.
$rec = [ordered]@{ company = $Name; board = $Board;
                   built = (Get-Date -Format "yyyy-MM-dd HH:mm");
                   files = $receipt; built_times = $builtAt }
[IO.File]::WriteAllText((Join-Path $site "firmware_receipt.json"),
                        ($rec | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))

# builtin.json: what the service worker stores on the phone. A hosted site has
# no directory listing, so this list is the ONLY way the app finds these files.
$bi = [ordered]@{
    note = "Firmware that ships with the app. The service worker stores these on the device at first run, so the updater also works with no internet."
    main_firmware  = @(Get-ChildItem $mainDir  -Filter *.bin | Sort-Object Name |
                       ForEach-Object { [ordered]@{ name = $_.Name; size = [int]$_.Length } })
    cloud_firmware = @(Get-ChildItem $cloudDir -Filter *.bin | Sort-Object Name |
                       ForEach-Object { [ordered]@{ name = $_.Name; size = [int]$_.Length } })
}
[IO.File]::WriteAllText((Join-Path $site "builtin.json"),
                        ($bi | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
Write-Host "   firmware   : $n file(s) inside the app  (+ builtin.json, firmware_receipt.json)"

# ------------------------------------------------------------------- self-check
$problems = @()
foreach ($need in @("index.html", "sw.js", "gata.license", "builtin.json", "firmware_receipt.json",
                    "js\config.js", "js\dfuse.js", "js\app.js")) {
    if (-not (Test-Path (Join-Path $site $need))) { $problems += "MISSING: $need" }
}
if ((Get-ChildItem $mainDir -Filter "system*.bin").Count -eq 0) { $problems += "MISSING: main_firmware\system*.bin" }
if ((Get-ChildItem $mainDir -Filter "controller*.bin").Count -eq 0) { $problems += "MISSING: main_firmware\controller*.bin" }
$cfgNow = [IO.File]::ReadAllText($cfgPath)
if ($cfgNow -notmatch [regex]::Escape($manifestUrl)) { $problems += "config.js does not point at $manifestUrl" }
if ($cfgNow -notmatch ('channel:\s*"' + [regex]::Escape($Id) + '"')) { $problems += "config.js channel is not '$Id'" }
# a company site must never carry your keys
foreach ($secret in @("tools\signing_key.json", "tools\license_key.json", "firmware")) {
    if (Test-Path (Join-Path $site $secret)) { $problems += "MUST NOT BE THERE: $secret" }
}

if ($problems.Count -gt 0) {
    foreach ($p in $problems) { Write-Host "   !! $p" -ForegroundColor Red }
    throw "$($problems.Count) problem(s) - the site was NOT built cleanly."
}
Write-Host "   check passed." -ForegroundColor Green
Write-Host ""
Write-Host "Publish it, then build the app:" -ForegroundColor Cyan
Write-Host "   git add c/$Id && git commit -m ""$Name app"" && git push"
Write-Host "   .\build_android_app.ps1 -Id $Id -Name ""$Name"""
exit 0
