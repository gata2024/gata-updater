# GATA - firmware signing key setup (one time per company).
#
# Creates an ECDSA P-256 keypair:
#   - PRIVATE key -> tools\signing_key.json   (KEEP OFFLINE - never upload/commit)
#   - PUBLIC  key -> pinned into js\config.js (ships inside the app)
# and signs the current firmware\manifest.json -> firmware\manifest.json.sig.
#
# From then on publish_firmware.ps1 signs automatically on every release.
# Re-running this script REUSES the existing key (it never overwrites one).
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$root     = Split-Path $PSScriptRoot -Parent
$keyPath  = Join-Path $PSScriptRoot 'signing_key.json'
$cfgPath  = Join-Path $root 'js\config.js'
$manPath  = Join-Path $root 'firmware\manifest.json'

function B64Url([byte[]]$b) { [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_') }
function FromB64Url([string]$s) {
    $t = $s.Replace('-','+').Replace('_','/')
    switch ($t.Length % 4) { 2 { $t += '==' } 3 { $t += '=' } }
    [Convert]::FromBase64String($t)
}

$curve = [System.Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256')

if (Test-Path $keyPath) {
    Write-Host "Reusing existing signing key: $keyPath"
    $jwk = Get-Content $keyPath -Raw | ConvertFrom-Json
    $p = New-Object System.Security.Cryptography.ECParameters
    $p.Curve = $curve
    $p.D = FromB64Url $jwk.d
    $q = $p.Q; $q.X = FromB64Url $jwk.x; $q.Y = FromB64Url $jwk.y; $p.Q = $q
    $ec = [System.Security.Cryptography.ECDsa]::Create()
    $ec.ImportParameters($p)
} else {
    Write-Host "Generating new ECDSA P-256 signing key..."
    $ec = [System.Security.Cryptography.ECDsa]::Create($curve)
    $p  = $ec.ExportParameters($true)
    $jwk = [ordered]@{
        kty = 'EC'; crv = 'P-256'
        d = B64Url $p.D; x = B64Url $p.Q.X; y = B64Url $p.Q.Y
        note = 'GATA firmware signing PRIVATE key - keep offline, never commit/upload.'
    }
    [IO.File]::WriteAllText($keyPath, ($jwk | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    Write-Host "PRIVATE key saved: $keyPath  (back it up; without it you cannot release)" -ForegroundColor Yellow
    $p = $ec.ExportParameters($false)
}

# ---- pin the PUBLIC key into js/config.js (single line) -------------------
$pub = $ec.ExportParameters($false)
$pubLine = 'signingPublicKey: {"kty":"EC","crv":"P-256","x":"' + (B64Url $pub.Q.X) + '","y":"' + (B64Url $pub.Q.Y) + '"},'
$cfg = [IO.File]::ReadAllText($cfgPath)
$new = [regex]::Replace($cfg, 'signingPublicKey:\s*(?:null|\{[^\r\n]*\}),', $pubLine)
if ($new -eq $cfg -and $cfg -notmatch [regex]::Escape($pubLine)) { throw "Could not find the signingPublicKey line in js/config.js" }
[IO.File]::WriteAllText($cfgPath, $new, (New-Object Text.UTF8Encoding $false))
Write-Host "PUBLIC key pinned into js\config.js" -ForegroundColor Green

# ---- sign the current manifest --------------------------------------------
$bytes = [IO.File]::ReadAllBytes($manPath)
$sig = $ec.SignData($bytes, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
[IO.File]::WriteAllText("$manPath.sig", [Convert]::ToBase64String($sig), (New-Object Text.UTF8Encoding $false))
Write-Host ("firmware\manifest.json.sig written ({0}-byte signature)." -f $sig.Length) -ForegroundColor Green
Write-Host ""
Write-Host "Done. Publish flow: publish_firmware.ps1 signs automatically from now on."
Write-Host "If you ever edit manifest.json BY HAND, re-run this script to re-sign."
