# GATA - issue a customer license.
#
# ONE universal app for every customer; the license decides the firmware
# channel. This script:
#   1. creates (once) an ECDSA P-256 LICENSE keypair:
#        PRIVATE -> tools\license_key.json   (KEEP OFFLINE - never commit; back it up!)
#        PUBLIC  -> pinned into js\config.js (ships inside the app)
#   2. prints a signed license token:  GATA1.<payload>.<signature>
#
# Usage:
#   .\make_license.ps1 -Customer "KSP"                      # channel "ksp", perpetual
#   .\make_license.ps1 -Customer "General" -Channel default # the shared channel
#   .\make_license.ps1 -Customer "Danway" -Expires 2027-12-31
#
# The channel must exist on the firmware server (publish_firmware.ps1
# -Customer <id> / new_customer.ps1 create it). "default" = the shared list.
param(
    [Parameter(Mandatory = $true)] [string]$Customer,
    [string]$Channel,
    [string]$Expires,                 # optional yyyy-MM-dd; omitted = perpetual
    [string]$Id
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$root    = Split-Path $PSScriptRoot -Parent
$keyPath = Join-Path $PSScriptRoot 'license_key.json'
$cfgPath = Join-Path $root 'js\config.js'

function B64Url([byte[]]$b) { [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_') }
function FromB64Url([string]$s) {
    $t = $s.Replace('-','+').Replace('_','/')
    switch ($t.Length % 4) { 2 { $t += '==' } 3 { $t += '=' } }
    [Convert]::FromBase64String($t)
}

if (-not $Channel) {
    $Channel = ($Customer -replace '[^0-9A-Za-z]', '').ToLowerInvariant()
    if ($Channel -eq 'general') { $Channel = 'default' }
}
if ($Expires) {
    $null = [datetime]::ParseExact($Expires, 'yyyy-MM-dd', $null)   # validate early
}
if (-not $Id) { $Id = 'L-' + (Get-Date -Format 'yyMMdd') + '-' + (-join ((48..57)+(65..90) | Get-Random -Count 4 | ForEach-Object {[char]$_})) }

# ---- license keypair (create once, reuse forever) --------------------------
$curve = [System.Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256')
if (Test-Path $keyPath) {
    $jwk = Get-Content $keyPath -Raw | ConvertFrom-Json
    $p = New-Object System.Security.Cryptography.ECParameters
    $p.Curve = $curve
    $p.D = FromB64Url $jwk.d
    $q = $p.Q; $q.X = FromB64Url $jwk.x; $q.Y = FromB64Url $jwk.y; $p.Q = $q
    $ec = [System.Security.Cryptography.ECDsa]::Create()
    $ec.ImportParameters($p)
} else {
    Write-Host "Generating new ECDSA P-256 LICENSE key (one time)..." -ForegroundColor Yellow
    $ec = [System.Security.Cryptography.ECDsa]::Create($curve)
    $p  = $ec.ExportParameters($true)
    $jwk = [ordered]@{
        kty = 'EC'; crv = 'P-256'
        d = B64Url $p.D; x = B64Url $p.Q.X; y = B64Url $p.Q.Y
        note = 'GATA license-minting PRIVATE key - keep offline, never commit/upload. Anyone with this file can issue licenses.'
    }
    [IO.File]::WriteAllText($keyPath, ($jwk | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    Write-Host "PRIVATE license key saved: $keyPath  (BACK IT UP together with signing_key.json)" -ForegroundColor Yellow
}

# ---- pin the PUBLIC key into js/config.js (single line) --------------------
$pub = $ec.ExportParameters($false)
$pubLine = 'licensePublicKey: {"kty":"EC","crv":"P-256","x":"' + (B64Url $pub.Q.X) + '","y":"' + (B64Url $pub.Q.Y) + '"},'
$cfg = [IO.File]::ReadAllText($cfgPath)
$new = [regex]::Replace($cfg, 'licensePublicKey:\s*(?:null|\{[^\r\n]*\}),', $pubLine)
if ($new -eq $cfg -and $cfg -notmatch [regex]::Escape($pubLine)) { throw "Could not find the licensePublicKey line in js/config.js" }
if ($new -ne $cfg) {
    [IO.File]::WriteAllText($cfgPath, $new, (New-Object Text.UTF8Encoding $false))
    Write-Host "PUBLIC license key pinned into js\config.js - deploy the app for it to take effect." -ForegroundColor Green
}

# ---- build + sign the token -------------------------------------------------
$payload = [ordered]@{
    customer = $Customer
    channel  = $Channel
    issued   = (Get-Date -Format 'yyyy-MM-dd')
    exp      = $(if ($Expires) { $Expires } else { $null })
    id       = $Id
}
$json  = ($payload | ConvertTo-Json -Compress)
$bytes = [Text.Encoding]::UTF8.GetBytes($json)
$sig   = $ec.SignData($bytes, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
$token = 'GATA1.' + (B64Url $bytes) + '.' + (B64Url $sig)

Write-Host ""
Write-Host "== License for $Customer  (channel: $Channel, $(if ($Expires) { "expires $Expires" } else { 'perpetual' }), id: $Id) ==" -ForegroundColor Cyan
Write-Host ""
Write-Host $token
Write-Host ""
# keep a record next to the key so issued licenses are never lost
$ledger = Join-Path $PSScriptRoot 'licenses_issued.txt'
Add-Content -Path $ledger -Value ("{0}  {1,-12} {2,-10} {3}  {4}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $Customer, $Channel, $Id, $token) -Encoding utf8
Write-Host "Recorded in tools\licenses_issued.txt (kept out of git, like the key)."
Write-Host "Send the token above to the customer - they paste it once into the app."
