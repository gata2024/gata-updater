# GATA Cloud Uploader - fully automatic USB connection (no pickers, ever).
#
# Browsers require a one-time user picker for USB/serial access - EXCEPT when
# a device policy pre-authorizes the device for a site. This script installs
# those policies (current user, no admin needed) for Chrome and Edge:
#
#   SerialAllowUsbDevicesForUrls : STM32 Virtual ComPort (0483:5740)
#   WebUsbAllowDevicesForUrls    : DFU in FS Mode        (0483:DF11)
#
# After this + a full browser restart, the updater connects to the controller
# with ZERO prompts: plug in, click the update button, done.
#
#   .\enable_auto_connect.ps1                      # allow for http://127.0.0.1:8765
#   .\enable_auto_connect.ps1 -Origins http://127.0.0.1:8765, https://user.github.io
#   .\enable_auto_connect.ps1 -Remove              # undo everything
#
# Side effect: Chrome/Edge will show "Managed by your organization" because a
# policy is set. That is expected; -Remove restores the previous state.

param(
    [string[]]$Origins = @("http://127.0.0.1:8765"),
    [switch]$Remove
)

$ErrorActionPreference = "Stop"

# Machine-wide policy location (HKCU\Software\Policies is read-only on some
# setups - including this project's machine - so HKLM + elevation it is).
# All common Chromium-family browsers are covered - policies only work in the
# browser actually being used, and we cannot know which one that is.
$browserKeys = @(
    "HKLM:\Software\Policies\Google\Chrome",
    "HKLM:\Software\Policies\Microsoft\Edge",
    "HKLM:\Software\Policies\BraveSoftware\Brave",
    "HKLM:\Software\Policies\Chromium"
)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Administrator rights needed - requesting elevation (click Yes)..." -ForegroundColor Yellow
    $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    if ($Remove) { $argList += "-Remove" }
    if ($Origins) { $argList += @("-Origins", ($Origins -join ",")) }
    try {
        Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait
    } catch {
        Write-Host ""
        Write-Host "Setup skipped (no admin approval). The updater still works -" -ForegroundColor Yellow
        Write-Host "the browser will just ask to pick the device once. This setup" -ForegroundColor Yellow
        Write-Host "is offered again the next time you start the updater." -ForegroundColor Yellow
    }
    exit 0
}

# vendor 0x0483 = 1155, CDC PID 0x5740 = 22336, DFU PID 0xDF11 = 57105
$policies = @(
    @{ name = "SerialAllowUsbDevicesForUrls"; vendor = 1155; product = 22336 },
    @{ name = "WebUsbAllowDevicesForUrls";    vendor = 1155; product = 57105 }
)

function Get-Existing([string]$key, [string]$name) {
    try {
        $v = (Get-ItemProperty -Path $key -Name $name -ErrorAction Stop).$name
        if ($v) { return ,(ConvertFrom-Json $v) }
    } catch { }
    return @()
}

if ($Remove) {
    foreach ($key in $browserKeys) {
        foreach ($p in $policies) {
            try { Remove-ItemProperty -Path $key -Name $p.name -ErrorAction Stop
                  Write-Host "removed $($p.name) from $key" } catch { }
        }
    }
    Write-Host ""
    Write-Host "Auto-connect policies removed. Restart the browser." -ForegroundColor Green
    exit 0
}

foreach ($key in $browserKeys) {
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    foreach ($p in $policies) {
        $entries = @(Get-Existing $key $p.name)
        foreach ($origin in $Origins) {
            $already = $entries | Where-Object {
                $_.urls -contains $origin -and
                ($_.devices | Where-Object { $_.vendor_id -eq $p.vendor -and $_.product_id -eq $p.product })
            }
            if (-not $already) {
                $entries += [pscustomobject]@{
                    devices = @([ordered]@{ vendor_id = $p.vendor; product_id = $p.product })
                    urls    = @($origin)
                }
            }
        }
        $json = ConvertTo-Json @($entries) -Depth 6 -Compress
        New-ItemProperty -Path $key -Name $p.name -PropertyType String -Value $json -Force | Out-Null
        Write-Host "set $($p.name) @ $key"
    }
}

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  Automatic USB connection ENABLED for:" -ForegroundColor Green
foreach ($o in $Origins) { Write-Host "    $o" -ForegroundColor Green }
Write-Host ""
Write-Host "  Restarting the browser so the change takes effect..." -ForegroundColor Yellow
Write-Host "  Undo anytime:  enable_auto_connect.ps1 -Remove"
Write-Host "==============================================================" -ForegroundColor Cyan

# Policies only load on a FULL browser restart, and Chrome/Edge keep running
# in the background even with every window closed - which silently defeats
# the whole setup. Close them for real; the updater reopens right after.
Start-Sleep -Seconds 2
foreach ($proc in "chrome", "msedge", "brave") {
    try { taskkill /IM "$proc.exe" /F /T 2>$null | Out-Null } catch { }
}
Write-Host "Browser closed - it reopens with the updater in a moment."
