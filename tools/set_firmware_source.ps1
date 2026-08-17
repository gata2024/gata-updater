# GATA - point this installation at the company firmware server.
#
# Writes tools\firmware_source.json, which the local server uses to fetch
# firmware on behalf of the app (see the /__fw/ proxy in serve.ps1).
# The token - if the server needs one - stays in this file on this PC and is
# never sent to the browser.
#
#   .\set_firmware_source.ps1                      # show current setting / test it
#   .\set_firmware_source.ps1 -Token abc123        # add or replace the token
#   .\set_firmware_source.ps1 -BaseUrl https://... # different server/branch
#   .\set_firmware_source.ps1 -Test                # just try a download
param(
    [string]$BaseUrl,
    [string]$Token,
    [switch]$Test
)
$ErrorActionPreference = "Stop"
$cfgPath = Join-Path $PSScriptRoot 'firmware_source.json'
$DEFAULT_BASE = 'https://git.gatasys.com/Software/gata-firmware/raw/branch/main/'

$cfg = if (Test-Path $cfgPath) { Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$base  = if ($BaseUrl) { $BaseUrl } elseif ($cfg -and $cfg.baseUrl) { [string]$cfg.baseUrl } else { $DEFAULT_BASE }
$token = if ($PSBoundParameters.ContainsKey('Token')) { $Token } elseif ($cfg -and $cfg.token) { [string]$cfg.token } else { '' }
if (-not $base.EndsWith('/')) { $base = $base + '/' }

if (-not $Test) {
    $out = [ordered]@{
        baseUrl = $base
        token   = $token
        note    = 'Firmware download source for this installation. The token (if any) is a READ-ONLY account for the firmware repository - never a personal account token.'
    }
    [IO.File]::WriteAllText($cfgPath, ($out | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    Write-Host "Saved: $cfgPath" -ForegroundColor Green
}
Write-Host ("Firmware source : {0}" -f $base)
Write-Host ("Token           : {0}" -f $(if ($token) { "set (" + $token.Substring(0, [Math]::Min(4, $token.Length)) + "...)" } else { "none (server must allow anonymous download)" }))

# ---- live test -------------------------------------------------------------
Write-Host ""
Write-Host "Testing manifest download..." -ForegroundColor Cyan
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $req = [System.Net.HttpWebRequest]::Create($base + 'manifest.json')
    $req.Timeout = 30000
    $req.UserAgent = 'GATA-Uploader'
    if ($token) { $req.Headers.Add('Authorization', 'token ' + $token) }
    $resp = $req.GetResponse()
    $ms = New-Object System.IO.MemoryStream
    $resp.GetResponseStream().CopyTo($ms)
    $resp.Close()
    $bytes = $ms.ToArray()
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    $ver = ([regex]::Match($text, '"version"\s*:\s*"([^"]+)"')).Groups[1].Value
    Write-Host ("OK - {0:N0} bytes, newest version: {1}" -f $bytes.Length, $ver) -ForegroundColor Green

    $req2 = [System.Net.HttpWebRequest]::Create($base + 'manifest.json.sig')
    $req2.Timeout = 30000
    $req2.UserAgent = 'GATA-Uploader'
    if ($token) { $req2.Headers.Add('Authorization', 'token ' + $token) }
    $resp2 = $req2.GetResponse(); $resp2.Close()
    Write-Host "OK - signature file present." -ForegroundColor Green
    Write-Host ""
    Write-Host "This PC can receive firmware updates." -ForegroundColor Green
} catch {
    Write-Host ("FAILED: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host ""
    Write-Host "If the message mentions 401/403 or a login page, the firmware server" -ForegroundColor Yellow
    Write-Host "requires sign-in. Ask the Gitea administrator for either:" -ForegroundColor Yellow
    Write-Host "  a) anonymous read for the public repo (best - no tokens anywhere), or" -ForegroundColor Yellow
    Write-Host "  b) a READ-ONLY account for Software/gata-firmware; then run:" -ForegroundColor Yellow
    Write-Host "     .\set_firmware_source.ps1 -Token <that account's token>" -ForegroundColor Yellow
}
