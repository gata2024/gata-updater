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
param([switch]$NoElevate)

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
    Read-Host "Press ENTER to close"
    exit 1
}
Write-Host "Found: $($dev.Name)  [$($dev.DeviceID)]  service=$($dev.Service)"
if ($dev.Service -eq 'WINUSB') {
    Write-Host "WinUSB is already bound - nothing to do." -ForegroundColor Green
    Read-Host "Press ENTER to close"
    exit 0
}

# ---- inbox generic WinUSB INF --------------------------------------------
$inf = Join-Path $env:windir 'INF\winusbcompat.inf'
if (-not (Test-Path $inf)) {
    Write-Host "This Windows build lacks winusbcompat.inf - use windows-driver\zadig.exe instead." -ForegroundColor Yellow
    Read-Host "Press ENTER to close"
    exit 1
}

# ---- bind it via SetupAPI -------------------------------------------------
Add-Type -Namespace GataDrv -Name NewDev -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("newdev.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern bool UpdateDriverForPlugAndPlayDevices(
    System.IntPtr hwndParent, string HardwareId, string FullInfPath,
    uint InstallFlags, out bool bRebootRequired);
'@

$INSTALLFLAG_FORCE = 0x1
$reboot = $false
Write-Host "Binding inbox WinUSB driver to $HWID ..."
$ok = [GataDrv.NewDev]::UpdateDriverForPlugAndPlayDevices(
        [IntPtr]::Zero, $HWID, $inf, $INSTALLFLAG_FORCE, [ref]$reboot)
if (-not $ok) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Host "FAILED (Win32 error $err). Fallback: run windows-driver\zadig.exe." -ForegroundColor Red
    Read-Host "Press ENTER to close"
    exit 1
}

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  DFU driver installed (inbox WinUSB, Microsoft-signed)." -ForegroundColor Green
if ($reboot) { Write-Host "  Windows asks for a REBOOT to finish." -ForegroundColor Yellow }
else         { Write-Host "  No reboot needed - the updater can use the device right away." }
Write-Host "==============================================================" -ForegroundColor Cyan
Read-Host "Press ENTER to close"
exit 0
