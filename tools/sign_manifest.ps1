# GATA - sign one manifest file with the company key (tools\signing_key.json).
# Writes <path>.sig next to it. Every app refuses a list without a valid one.
#
#   .\sign_manifest.ps1 -Path ..\firmware\manifest.json
#   .\sign_manifest.ps1 -All          # re-sign every channel (default + customers)
param(
    [string]$Path,
    [switch]$All
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$keyPath = Join-Path $PSScriptRoot 'signing_key.json'
if (-not (Test-Path $keyPath)) {
    Write-Host "No signing key found - run tools\make_signing_key.ps1 once." -ForegroundColor Red
    exit 1
}
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

$targets = @()
if ($All) {
    $fw = Join-Path (Split-Path -Parent $PSScriptRoot) 'firmware'
    $targets += (Join-Path $fw 'manifest.json')
    $custRoot = Join-Path $fw 'customers'
    if (Test-Path $custRoot) {
        $targets += (Get-ChildItem $custRoot -Directory | ForEach-Object { Join-Path $_.FullName 'manifest.json' })
    }
} elseif ($Path) {
    $targets += $Path
} else {
    Write-Host "Give -Path <manifest.json> or -All." -ForegroundColor Yellow
    exit 1
}

foreach ($t in $targets) {
    if (-not (Test-Path $t)) { Write-Host "skip (missing): $t" -ForegroundColor Yellow; continue }
    $bytes = [IO.File]::ReadAllBytes($t)
    $sig = $ec.SignData($bytes, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
    [IO.File]::WriteAllText("$t.sig", [Convert]::ToBase64String($sig), (New-Object Text.UTF8Encoding $false))
    $chan = ""
    try { $chan = (Get-Content $t -Raw -Encoding UTF8 | ConvertFrom-Json).channel } catch {}
    Write-Host ("signed: {0}{1}" -f (Split-Path -Leaf (Split-Path -Parent $t)), $(if ($chan) { "  [channel: $chan]" } else { "" })) -ForegroundColor Green
}
exit 0
