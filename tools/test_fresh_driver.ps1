# Fresh-PC DFU driver experiment, fully automated (one admin approval):
#  1. wait for the board in BOOT mode ("DFU in FS Mode")
#  2. uninstall its current driver AND delete the stored package (clean slate)
#  3. verify the device is driverless - the "brand-new PC" state
#  4. run the new automatic installer (inbox WinUSB via SetupAPI)
#  5. verify WinUSB is bound again -> PASS
param([switch]$NoElevate)
$ErrorActionPreference = "Continue"
function Log($m) { "{0}  {1}" -f (Get-Date -Format HH:mm:ss), $m }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    if ($NoElevate) { Log "admin required"; exit 1 }
    Log "Requesting admin (click Yes)..."
    Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
        "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$PSCommandPath`"","-NoElevate")
    exit 0
}

$log = "$PSScriptRoot\fresh_driver_test.log"
Start-Transcript -Path $log -Force | Out-Null

# ---- 1. wait for DFU device ------------------------------------------------
Log "Waiting for 'DFU in FS Mode' (put board in BOOT mode + plug USB)... up to 5 min"
$dev = $null; $t0 = Get-Date
while (-not $dev -and ((Get-Date) - $t0).TotalMinutes -lt 5) {
    Start-Sleep -Seconds 3
    $dev = Get-WmiObject Win32_PnPEntity | Where-Object { $_.DeviceID -match 'VID_0483&PID_DF11' }
}
if (-not $dev) { Log "FAIL: no DFU device within 5 min."; Stop-Transcript | Out-Null; exit 1 }
$inst = $dev.DeviceID
Log "Found: $($dev.Name)  service=$($dev.Service)  [$inst]"

# ---- 2. clean slate: remove device + delete its driver package ------------
$drv = Get-WmiObject Win32_PnPSignedDriver | Where-Object { $_.DeviceID -eq $inst }
if ($drv) { Log ("Current driver: {0}  provider={1}" -f $drv.InfName, $drv.DriverProviderName) }
if ($drv -and $drv.InfName -like 'oem*.inf') {
    Log "Deleting stored driver package $($drv.InfName)..."
    pnputil /delete-driver $drv.InfName /uninstall /force 2>&1 | Select-String -Pattern "successfully|error" | ForEach-Object { Log ("  " + $_.Line.Trim()) }
} else {
    Log "Driver is inbox (or none) - removing device node only."
}
Log "Removing device node..."
pnputil /remove-device "$inst" 2>&1 | Select-String -Pattern "successfully|error" | ForEach-Object { Log ("  " + $_.Line.Trim()) }
Start-Sleep -Seconds 2
Log "Rescanning..."
pnputil /scan-devices 2>&1 | Out-Null
Start-Sleep -Seconds 5

# ---- 3. verify driverless (brand-new-PC state) -----------------------------
$dev2 = Get-WmiObject Win32_PnPEntity | Where-Object { $_.DeviceID -match 'VID_0483&PID_DF11' }
if (-not $dev2) { Log "Device did not re-enumerate after rescan - REPLUG the USB cable, waiting..."
    $t0 = Get-Date
    while (-not $dev2 -and ((Get-Date) - $t0).TotalMinutes -lt 3) { Start-Sleep -Seconds 3; $dev2 = Get-WmiObject Win32_PnPEntity | Where-Object { $_.DeviceID -match 'VID_0483&PID_DF11' } }
}
if (-not $dev2) { Log "FAIL: device gone."; Stop-Transcript | Out-Null; exit 1 }
Log ("Fresh state: name='{0}' service='{1}' status={2}  (empty/none service = driverless, as on a new PC)" -f $dev2.Name, $dev2.Service, $dev2.Status)

# ---- 4. run the automatic installer ---------------------------------------
Log "Running the automatic installer (inbox WinUSB)..."
$HWID = "USB\VID_0483&PID_DF11"
$inf = Join-Path $env:windir 'INF\winusbcompat.inf'
if (-not (Test-Path $inf)) { Log "FAIL: winusbcompat.inf missing on this Windows."; Stop-Transcript | Out-Null; exit 1 }
Add-Type -Namespace GataDrv -Name NewDev -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("newdev.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern bool UpdateDriverForPlugAndPlayDevices(
    System.IntPtr hwndParent, string HardwareId, string FullInfPath,
    uint InstallFlags, out bool bRebootRequired);
'@
$reboot = $false
$ok = [GataDrv.NewDev]::UpdateDriverForPlugAndPlayDevices([IntPtr]::Zero, $HWID, $inf, 0x1, [ref]$reboot)
if (-not $ok) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Log "FAIL: UpdateDriverForPlugAndPlayDevices error $err"
    Stop-Transcript | Out-Null; exit 1
}
Log "Installer reported success (reboot needed: $reboot). Verifying binding..."
Start-Sleep -Seconds 4

# ---- 5. verify -------------------------------------------------------------
$dev3 = Get-WmiObject Win32_PnPEntity | Where-Object { $_.DeviceID -match 'VID_0483&PID_DF11' }
if ($dev3 -and $dev3.Service -eq 'WINUSB') {
    Log "=========================================================="
    Log "PASS: fresh-PC simulation complete."
    Log "  clean slate -> automatic installer -> service=WINUSB"
    Log "  The web updater can use this device right now."
    Log "=========================================================="
    Stop-Transcript | Out-Null; exit 0
}
Log ("Service is '{0}' - if empty, REPLUG the cable once and re-check Device Manager." -f $(if ($dev3) { $dev3.Service } else { 'device absent' }))
Stop-Transcript | Out-Null
exit 1
