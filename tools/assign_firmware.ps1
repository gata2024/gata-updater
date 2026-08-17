# GATA - decide WHICH firmware version each company gets.
#
# Every company has its own channel (created by new_customer.ps1). This script
# assigns an already-published version to a company - no rebuilding, no
# re-uploading: the .bin files are shared, only the company's list changes.
#
#   .\assign_firmware.ps1 -List
#       show every company and the version it is currently offered
#
#   .\assign_firmware.ps1 -Customer acme-water -Version 16.8.26.5
#       give ACME that version (kept as the newest entry in their list)
#
#   .\assign_firmware.ps1 -Customer acme-water -Version 16.8.26.5 -Only
#       ...and hide every other version from them
#
#   .\assign_firmware.ps1 -Customer acme-water -Version 15.9.0 -FromChannel default
#       take a version that is not in their list yet from another channel
#
# Publishing a NEW build for one company stays:
#   .\publish_firmware.ps1 -Version <v> -Main <M.bin> -Customer acme-water
param(
    [string]$Customer,
    [string]$Version,
    [string]$FromChannel = "default",
    [switch]$Only,
    [switch]$List
)
$ErrorActionPreference = "Stop"

$app      = Split-Path -Parent $PSScriptRoot
$firmware = Join-Path $app "firmware"
$custRoot = Join-Path $firmware "customers"

function Get-ManifestPath([string]$channel) {
    if (-not $channel -or $channel -eq "default") { return (Join-Path $firmware "manifest.json") }
    return (Join-Path $custRoot "$channel\manifest.json")
}
function Read-Manifest([string]$path) {
    if (-not (Test-Path $path)) { throw "Channel manifest not found: $path" }
    return Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
}
# Customer manifests live one level deeper, so their file URLs are ../../<file>
function Set-UrlPrefix($versionEntry, [bool]$isCustomerChannel) {
    $json = $versionEntry | ConvertTo-Json -Depth 10
    $json = $json -replace '"url":\s*"(\.\./\.\./)?', '"url":  "'          # strip
    if ($isCustomerChannel) { $json = $json -replace '"url":\s*"', '"url":  "../../' }
    return ($json | ConvertFrom-Json)
}

# ------------------------------------------------------------------- list
if ($List -or (-not $Customer)) {
    $rows = @()
    $rows += [pscustomobject]@{ Path = (Get-ManifestPath "default"); Channel = "default" }
    if (Test-Path $custRoot) {
        Get-ChildItem $custRoot -Directory | ForEach-Object {
            $rows += [pscustomobject]@{ Path = (Join-Path $_.FullName "manifest.json"); Channel = $_.Name }
        }
    }
    Write-Host ""
    Write-Host ("{0,-18} {1,-28} {2,-12} {3}" -f "CHANNEL", "COMPANY", "OFFERED", "VERSIONS") -ForegroundColor Cyan
    Write-Host ("-" * 78)
    foreach ($r in $rows) {
        if (-not (Test-Path $r.Path)) { continue }
        $m = Read-Manifest $r.Path
        $latest = ($m.versions | Where-Object { $_.latest } | Select-Object -First 1)
        if (-not $latest) { $latest = $m.versions | Select-Object -First 1 }
        $signed = if (Test-Path ($r.Path + ".sig")) { "" } else { "  (UNSIGNED!)" }
        Write-Host ("{0,-18} {1,-28} {2,-12} {3}{4}" -f $r.Channel,
            $(if ($m.customer) { $m.customer } else { "-" }),
            $(if ($latest) { $latest.version } else { "none" }),
            @($m.versions).Count, $signed)
    }
    Write-Host ""
    Write-Host "Assign: .\assign_firmware.ps1 -Customer <channel> -Version <version> [-Only]"
    exit 0
}

# ----------------------------------------------------------------- assign
if (-not $Version) { throw "Give -Version (or use -List to see what each company has)." }

$targetPath = Get-ManifestPath $Customer
$target = Read-Manifest $targetPath
$isCustomer = ($Customer -and $Customer -ne "default")

$entry = $target.versions | Where-Object { $_.version -eq $Version } | Select-Object -First 1
if (-not $entry) {
    Write-Host "Version $Version is not in this company's list - copying it from channel '$FromChannel'..."
    $src = Read-Manifest (Get-ManifestPath $FromChannel)
    $srcEntry = $src.versions | Where-Object { $_.version -eq $Version } | Select-Object -First 1
    if (-not $srcEntry) {
        $have = ($src.versions | ForEach-Object { $_.version }) -join ", "
        throw "Channel '$FromChannel' has no version $Version. It has: $have"
    }
    $entry = Set-UrlPrefix $srcEntry $isCustomer
    $target.versions = @($entry) + @($target.versions)
}

# the assigned version becomes the offered one, and moves to the top
foreach ($v in $target.versions) {
    if ($v.PSObject.Properties["latest"]) { $v.latest = ($v.version -eq $Version) }
    else { $v | Add-Member -NotePropertyName latest -NotePropertyValue ($v.version -eq $Version) -Force }
}
$ordered = @($target.versions | Where-Object { $_.version -eq $Version }) +
           @($target.versions | Where-Object { $_.version -ne $Version })
if ($Only) { $ordered = @($ordered | Select-Object -First 1) }

$out = [ordered]@{
    product  = $target.product
    channel  = $(if ($isCustomer) { $Customer } else { "default" })
    customer = $target.customer
    updated  = (Get-Date -Format "yyyy-MM-dd")
    versions = @($ordered)
}
[IO.File]::WriteAllText($targetPath, ($out | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))

& (Join-Path $PSScriptRoot 'sign_manifest.ps1') -Path $targetPath | Out-Null
Write-Host ""
Write-Host ("{0} now gets version {1}{2}" -f
    $(if ($target.customer) { $target.customer } else { $Customer }), $Version,
    $(if ($Only) { " (and nothing else)" } else { "" })) -ForegroundColor Green
Write-Host "Push the firmware repository to make it live:  git -C ..\firmware push"
