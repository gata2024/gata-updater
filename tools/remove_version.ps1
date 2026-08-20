# GATA - remove a published version from a channel.
#
# The mirror image of publish_firmware.ps1: drops the entry from the channel's
# manifest, deletes the files that ONLY that entry used, re-signs the manifest
# and pushes. Files still referenced by another entry are left alone (older
# releases share the plain esp\*.bin set, for example).
#
#   .\remove_version.ps1 -Version 20_08_26_KSP_rev5 -Customer ksp
#   .\remove_version.ps1 -Version 19_08_26_General_rev6            # shared channel
param(
    [Parameter(Mandatory = $true)] [string]$Version,
    [string]$Customer = "default",
    [switch]$KeepFiles,
    [string]$FirmwareDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "firmware")
)
$ErrorActionPreference = "Stop"

$manifestPath = if ($Customer -and $Customer -ne "default") {
    Join-Path $FirmwareDir "customers\$Customer\manifest.json"
} else {
    Join-Path $FirmwareDir "manifest.json"
}
if (-not (Test-Path $manifestPath)) { throw "No manifest for channel '$Customer': $manifestPath" }

$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$target = $manifest.versions | Where-Object { $_.version -eq $Version }
if (-not $target) { throw "Version '$Version' is not in the '$Customer' channel." }

$remaining = @($manifest.versions | Where-Object { $_.version -ne $Version })
if ($remaining.Count -eq 0) { throw "Refusing to remove the LAST version of a channel - publish a replacement first." }

Write-Host "== Removing $Version from channel '$Customer' ==" -ForegroundColor Cyan

# ---- which files did only this entry use? ---------------------------------
function Urls-Of($v) {
    $u = @()
    foreach ($k in @("controller", "main", "system", "license")) {
        if ($v.PSObject.Properties[$k] -and $v.$k -and $v.$k.url) { $u += $v.$k.url }
    }
    if ($v.PSObject.Properties["bootloaders"] -and $v.bootloaders) {
        foreach ($b in @("b1", "b3")) { if ($v.bootloaders.$b -and $v.bootloaders.$b.url) { $u += $v.bootloaders.$b.url } }
    }
    if ($v.PSObject.Properties["esp"] -and $v.esp) {
        foreach ($p in @("bootloader", "partitions", "boot_app0", "firmware")) {
            if ($v.esp.$p -and $v.esp.$p.url) { $u += $v.esp.$p.url }
        }
    }
    return $u
}

$mine = Urls-Of $target
$stillUsed = @()
foreach ($v in $remaining) { $stillUsed += (Urls-Of $v) }

$deleted = 0
if (-not $KeepFiles) {
    foreach ($u in ($mine | Sort-Object -Unique)) {
        if ($stillUsed -contains $u) {
            Write-Host ("  kept (used by another version): " + $u) -ForegroundColor DarkGray
            continue
        }
        # manifests of customer channels point back with ../../
        $rel = ($u -replace '^(\.\./)+', '') -replace '/', '\'
        $path = Join-Path $FirmwareDir $rel
        if (Test-Path $path) {
            Remove-Item $path -Force
            Write-Host ("  deleted: " + $rel)
            $deleted++
            $dir = Split-Path -Parent $path
            if ((Test-Path $dir) -and -not (Get-ChildItem $dir -Force)) { Remove-Item $dir -Force }
        }
    }
}

# ---- the newest remaining entry becomes "latest" ---------------------------
foreach ($v in $remaining) { if ($v.PSObject.Properties["latest"]) { $v.latest = $false } }
if ($remaining[0].PSObject.Properties["latest"]) { $remaining[0].latest = $true }
else { $remaining[0] | Add-Member -NotePropertyName latest -NotePropertyValue $true }

$out = [ordered]@{
    product  = $manifest.product
    channel  = $(if ($manifest.PSObject.Properties["channel"]) { $manifest.channel } else { $Customer })
    customer = $(if ($manifest.PSObject.Properties["customer"]) { $manifest.customer } else { "" })
    updated  = (Get-Date -Format "yyyy-MM-dd")
    versions = $remaining
}
$json = $out | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding $false))

# ---- re-sign (an unsigned list is refused by every app) --------------------
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
}

Write-Host ("Removed. {0} file(s) deleted; {1} version(s) left; latest is now {2}." -f `
            $deleted, $remaining.Count, $remaining[0].version) -ForegroundColor Green

# ---- publish the change ----------------------------------------------------
if (Test-Path (Join-Path $FirmwareDir ".git")) {
    Push-Location $FirmwareDir
    try {
        & git add -A
        & git -c core.safecrlf=false commit -q -m "Remove $Version from $Customer"
        & git push -q origin main
        if ($LASTEXITCODE -eq 0) {
            Write-Host "PUBLISHED - the version is gone from every updater on its next start." -ForegroundColor Green
        } else {
            Write-Host "git push failed - run it manually from $FirmwareDir" -ForegroundColor Yellow
        }
    } catch {
        Write-Host ("git step failed: " + $_.Exception.Message) -ForegroundColor Yellow
    } finally { Pop-Location }
}
