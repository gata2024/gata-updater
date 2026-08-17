# GATA Cloud Uploader - firmware release helper.
#
# Copies the new binaries into the firmware/ folder, computes sizes + SHA-256
# and prepends a version entry to firmware/manifest.json. After running it,
# upload/push the firmware/ folder to your host - every user then sees the
# new version.
#
# Examples:
#   .\publish_firmware.ps1 -Version 15.5.0 -Main C:\build\M_15_5_0.bin -Notes "Pump curve fixes"
#   .\publish_firmware.ps1 -Version 15.5.0 -Main M.bin -B1 B1.bin -B3 B3.bin -EspDir C:\esp\.pio\build\esp32dev
#
# If -B1/-B3 are omitted, the B1.bin/B3.bin already in firmware/ are reused.
# If -EspDir is omitted, the esp/ files already in firmware/ are reused
# (pass -NoEsp for a release without ESP32 files).

param(
    [Parameter(Mandatory = $true)]  [string]$Version,
    [Parameter(Mandatory = $true)]  [string]$Main,
    [string]$B1,
    [string]$B3,
    [string]$EspDir,
    [switch]$NoEsp,
    [string]$Notes = "",
    [string]$Date = (Get-Date -Format "yyyy-MM-dd"),
    # Which customer channel to publish into. "default" is the shared channel
    # at firmware\manifest.json; any other id publishes to
    # firmware\customers\<id>\manifest.json. Binaries always live once at the
    # root of firmware\ and are shared by every channel.
    [string]$Customer = "default",
    [string]$FirmwareDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "firmware")
)

$ErrorActionPreference = "Stop"

function Get-Sha256([string]$path) { (Get-FileHash $path -Algorithm SHA256).Hash.ToLower() }

function Read-Word([byte[]]$bytes, [int]$off) {
    # Int64 math avoids Int32 sign-wrap for bytes >= 0x80 in the top position.
    return [int64]$bytes[$off] + ([int64]$bytes[$off+1] * 0x100) +
           ([int64]$bytes[$off+2] * 0x10000) + ([int64]$bytes[$off+3] * 0x1000000)
}

function Test-Image([string]$path, [string]$kind) {
    # NOTE: 8-digit hex literals like 0xFF000000 parse as NEGATIVE Int32 in
    # PowerShell - the L suffix forces positive Int64, keeping the masks sane.
    $bytes = [IO.File]::ReadAllBytes($path)
    if ($kind -eq "app") {
        $sp = Read-Word $bytes 0; $rs = Read-Word $bytes 4
        if ((($sp -band 0xE0000000L) -ne 0x20000000L) -or (($rs -band 0xFF000000L) -ne 0x90000000L)) {
            throw "'$path' does not look like a controller application (M*.bin): SP=0x$('{0:X8}' -f $sp) Reset=0x$('{0:X8}' -f $rs)"
        }
    } elseif ($kind -eq "boot") {
        $sp = Read-Word $bytes 0; $rs = Read-Word $bytes 4
        if ($bytes.Length -gt 131072) { throw "'$path' is larger than the 128 KB internal flash." }
        if ((($sp -band 0xE0000000L) -ne 0x20000000L) -or (($rs -band 0xFF000000L) -ne 0x08000000L)) {
            throw "'$path' does not look like a system firmware (B*.bin): SP=0x$('{0:X8}' -f $sp) Reset=0x$('{0:X8}' -f $rs)"
        }
    } elseif ($kind -eq "esp") {
        if ($bytes[0] -ne 0xE9) { throw "'$path' does not start with the ESP32 image magic (0xE9)." }
    } elseif ($kind -eq "parts") {
        if ($bytes[0] -ne 0xAA -or $bytes[1] -ne 0x50) { throw "'$path' does not look like an ESP32 partition table." }
    }
}

function New-FileEntry([string]$srcPath, [string]$relUrl) {
    # $relUrl is the path under firmware\ (shared by all channels); the URL
    # written into a customer manifest gets $script:UrlPrefix prepended so it
    # still resolves from customers\<id>\.
    $dest = Join-Path $FirmwareDir ($relUrl -replace "/", "\")
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force $destDir | Out-Null }
    # Canonicalise both sides (8.3 short names, case) before the self-copy check.
    $srcFull = (Get-Item $srcPath).FullName.ToLowerInvariant()
    $destFull = [IO.Path]::GetFullPath($dest).ToLowerInvariant()
    if ($srcFull -ne $destFull) {
        try { Copy-Item $srcPath $dest -Force }
        catch [System.IO.IOException] {
            if ($_.Exception.Message -notmatch "itself") { throw }
        }
    }
    $f = Get-Item $dest
    return [ordered]@{ url = ($script:UrlPrefix + $relUrl); size = [int]$f.Length; sha256 = (Get-Sha256 $dest) }
}

# ---------------------------------------------------------------- validate
Write-Host "== GATA firmware release: $Version  (channel: $Customer) ==" -ForegroundColor Cyan
if (-not (Test-Path $Main)) { throw "Main application not found: $Main" }
Test-Image $Main "app"

if ($Customer -and $Customer -ne "default") {
    if ($Customer -notmatch '^[a-z0-9][a-z0-9-]{1,30}$') {
        throw "Customer id must be lowercase letters, digits and dashes: '$Customer'"
    }
    $manifestPath = Join-Path $FirmwareDir "customers\$Customer\manifest.json"
    $script:UrlPrefix = "../../"          # customers\<id>\ -> firmware\ root
    if (-not (Test-Path $manifestPath)) {
        throw "Channel '$Customer' does not exist yet. Create it first:`n" +
              "    .\new_customer.ps1 -Id $Customer -Name ""<company name>"""
    }
} else {
    $manifestPath = Join-Path $FirmwareDir "manifest.json"
    $script:UrlPrefix = ""
}
if (-not (Test-Path $manifestPath)) { throw "manifest.json not found: $manifestPath" }
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.versions | Where-Object { $_.version -eq $Version }) {
    throw "Version $Version already exists in the manifest."
}

# ---------------------------------------------------------------- main app
$mainName = Split-Path -Leaf $Main
$entryMain = New-FileEntry $Main $mainName
Write-Host "  main       : $mainName ($($entryMain.size) B)"

# ---------------------------------------------------------------- B1 / B3
if ($B1) { Test-Image $B1 "boot"; $entryB1 = New-FileEntry $B1 "B1.bin" }
else {
    $p = Join-Path $FirmwareDir "B1.bin"
    if (-not (Test-Path $p)) { throw "No -B1 given and firmware\B1.bin does not exist." }
    $entryB1 = New-FileEntry $p "B1.bin"
}
if ($B3) { Test-Image $B3 "boot"; $entryB3 = New-FileEntry $B3 "B3.bin" }
else {
    $p = Join-Path $FirmwareDir "B3.bin"
    if (-not (Test-Path $p)) { throw "No -B3 given and firmware\B3.bin does not exist." }
    $entryB3 = New-FileEntry $p "B3.bin"
}
Write-Host "  bootloaders: B1.bin / B3.bin"

# ---------------------------------------------------------------- ESP32
$espEntry = $null
if (-not $NoEsp) {
    $espSrc = $null
    if ($EspDir) { $espSrc = $EspDir }
    elseif (Test-Path (Join-Path $FirmwareDir "esp\firmware.bin")) { $espSrc = Join-Path $FirmwareDir "esp" }

    if ($espSrc) {
        $needed = @{ bootloader = "bootloader.bin"; partitions = "partitions.bin";
                     boot_app0 = "boot_app0.bin"; firmware = "firmware.bin" }
        $espEntry = [ordered]@{}
        foreach ($key in @("bootloader", "partitions", "boot_app0", "firmware")) {
            $src = Join-Path $espSrc $needed[$key]
            if (-not (Test-Path $src)) { throw "ESP32 file missing: $src (use -NoEsp for a release without ESP32)" }
            if ($key -eq "partitions") { Test-Image $src "parts" }
            elseif ($key -ne "boot_app0") { Test-Image $src "esp" }
            $espEntry[$key] = New-FileEntry $src ("esp/" + $needed[$key])
        }
        Write-Host "  esp32      : 4 files"
    } else {
        Write-Host "  esp32      : none (no -EspDir and no existing esp\ files)" -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------- manifest
$newVersion = [ordered]@{
    version = $Version
    date    = $Date
    latest  = $true
    notes   = $Notes
    main    = $entryMain
    bootloaders = [ordered]@{ b1 = $entryB1; b3 = $entryB3 }
}
if ($espEntry) { $newVersion["esp"] = $espEntry }

foreach ($old in $manifest.versions) {
    if ($old.PSObject.Properties["latest"]) { $old.latest = $false }
}

$out = [ordered]@{
    product  = $manifest.product
    channel  = $Customer                       # signed: an app only accepts ITS channel
    customer = $(if ($manifest.PSObject.Properties["customer"]) { $manifest.customer } else { "" })
    updated  = $Date
    versions = @($newVersion) + @($manifest.versions)
}

$json = $out | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding $false))

# ---- sign the manifest (anti-tamper; the app refuses unsigned lists) -------
$keyPath = Join-Path $PSScriptRoot 'signing_key.json'
if (Test-Path $keyPath) {
    Add-Type -AssemblyName System.Security
    function FromB64Url([string]$s) {
        $t = $s.Replace('-','+').Replace('_','/')
        switch ($t.Length % 4) { 2 { $t += '==' } 3 { $t += '=' } }
        [Convert]::FromBase64String($t)
    }
    $jwk = Get-Content $keyPath -Raw | ConvertFrom-Json
    $p = New-Object System.Security.Cryptography.ECParameters
    $p.Curve = [System.Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256')
    $p.D = FromB64Url $jwk.d
    $q = $p.Q; $q.X = FromB64Url $jwk.x; $q.Y = FromB64Url $jwk.y; $p.Q = $q
    $ec = [System.Security.Cryptography.ECDsa]::Create()
    $ec.ImportParameters($p)
    $sig = $ec.SignData([IO.File]::ReadAllBytes($manifestPath),
                        [System.Security.Cryptography.HashAlgorithmName]::SHA256)
    [IO.File]::WriteAllText("$manifestPath.sig", [Convert]::ToBase64String($sig),
                            (New-Object System.Text.UTF8Encoding $false))
    Write-Host "manifest.json.sig updated (signed)." -ForegroundColor Green
} else {
    Write-Host "WARNING: tools\signing_key.json not found - manifest NOT signed." -ForegroundColor Yellow
    Write-Host "         The app will REFUSE this list. Run tools\make_signing_key.ps1 once." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "manifest.json updated - $Version is now the latest of $($out.versions.Count) version(s)." -ForegroundColor Green

# ---- publish to the firmware repository (Software/gata-firmware) ----------
if (Test-Path (Join-Path $FirmwareDir ".git")) {
    Write-Host ""
    Write-Host "Publishing to the firmware server..." -ForegroundColor Cyan
    Push-Location $FirmwareDir
    try {
        & git add -A
        & git -c core.safecrlf=false commit -q -m "Firmware $Version"
        & git push -q origin main
        if ($LASTEXITCODE -eq 0) {
            Write-Host "PUBLISHED - every updater sees $Version on its next start." -ForegroundColor Green
        } else {
            Write-Host "git push failed - run it manually from $FirmwareDir" -ForegroundColor Yellow
        }
    } catch {
        Write-Host ("git step failed: " + $_.Exception.Message) -ForegroundColor Yellow
    } finally { Pop-Location }
} else {
    Write-Host "Next: upload the 'firmware' folder to your web host." -ForegroundColor Green
}
