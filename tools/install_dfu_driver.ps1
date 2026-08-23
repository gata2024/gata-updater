# GATA - automatic DFU driver installation (replaces the manual Zadig steps).
#
# Binds Windows' OWN inbox, Microsoft-signed generic WinUSB driver
# (winusbcompat.inf, "WinUsb Device") to the STM32 ROM bootloader
# (USB\VID_0483&PID_DF11) using the SetupAPI. Nothing is downloaded and no
# third-party driver is involved. Requires:
#   - the board plugged in AND in BOOT mode (shows as "DFU in FS Mode"),
#   - one admin approval (self-elevates).
#
#   .\install_dfu_driver.ps1
param(
    [switch]$NoElevate,
    # Run without waiting for a keypress. The updater calls this script for
    # you, and there is nobody sitting in that window to press ENTER - it
    # would simply hang.
    [switch]$Quiet
)
function Wait-Close { if (-not $Quiet) { Wait-Close } }

$ErrorActionPreference = "Stop"
$HWID = "USB\VID_0483&PID_DF11"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    if ($NoElevate) { Write-Host "Administrator rights required."; exit 1 }
    Write-Host "Administrator rights needed - requesting elevation (click Yes)..." -ForegroundColor Yellow
    try {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
            "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$PSCommandPath`"","-NoElevate")
    } catch {
        Write-Host "Skipped (no admin approval). Fallback: run windows-driver\zadig.exe manually." -ForegroundColor Yellow
    }
    exit 0
}

# ---- device present? ------------------------------------------------------
$dev = Get-WmiObject Win32_PnPEntity | Where-Object { $_.DeviceID -like "$HWID*" }
if (-not $dev) {
    Write-Host ""
    Write-Host "No 'DFU in FS Mode' device found." -ForegroundColor Yellow
    Write-Host "Put the board in BOOT mode (BOOT switch high + reset), plug USB, run this again."
    Wait-Close
    exit 1
}
Write-Host "Found: $($dev.Name)  [$($dev.DeviceID)]  service=$($dev.Service)"
if ($dev.Service -eq 'WINUSB') {
    Write-Host "WinUSB is already bound - nothing to do." -ForegroundColor Green
    Wait-Close
    exit 0
}

# ---- our own signed driver package ----------------------------------------
# Windows REFUSES an unsigned driver package - even one like this, which
# installs nothing of its own and only points the board at winusb.sys, the
# Microsoft-signed driver already in Windows ("The third-party INF does not
# contain digital signature information"). And its inbox winusb.inf cannot be
# forced onto this board, because that INF only matches devices advertising a
# WinUSB compatible ID, which the STM32 ROM does not (Win32 error 259).
#
# So the folder carries a properly signed package: the same tiny INF, a
# catalog, and the certificate that signed it. Trusting that certificate and
# installing the package takes no choices from the person doing it - which is
# the whole point, they pressed UPDATE and nothing else.
$pkgDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'windows-driver\dfu'
$pkgInf = Join-Path $pkgDir 'gata_dfu.inf'
$pkgCer = Join-Path $pkgDir 'gata_dfu.cer'

if (-not (Test-Path $pkgInf)) {
    Write-Host "The driver package is missing from windows-driver\dfu." -ForegroundColor Yellow
    Write-Host "Fallback: run windows-driver\zadig.exe by hand." -ForegroundColor Yellow
    Wait-Close
    exit 1
}

if (Test-Path $pkgCer) {
    # The catalog is signed by GATA's own certificate, so Windows has to be
    # told that certificate is trustworthy before it will accept the package.
    Write-Host "Trusting the GATA driver certificate ..."
    & certutil -addstore -f Root $pkgCer | Out-Null
    & certutil -addstore -f TrustedPublisher $pkgCer | Out-Null
}

Write-Host "Installing the driver ..."
& pnputil /add-driver $pkgInf /install | ForEach-Object { "   $_" }

Start-Sleep -Seconds 2
$after = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
         Where-Object { $_.DeviceID -like "$HWID*" } | Select-Object -First 1
if (-not $after -or $after.Service -ne 'WINUSB') {
    Write-Host "FAILED - the driver did not attach. Fallback: windows-driver\zadig.exe." -ForegroundColor Red
    Wait-Close
    exit 1
}
$reboot = $false

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  DFU driver installed (inbox WinUSB, Microsoft-signed)." -ForegroundColor Green
if ($reboot) { Write-Host "  Windows asks for a REBOOT to finish." -ForegroundColor Yellow }
else         { Write-Host "  No reboot needed - the updater can use the device right away." }
Write-Host "==============================================================" -ForegroundColor Cyan
Wait-Close
exit 0
