# GATA factory provisioning - one command per new board (via ST-Link).
# Burns the resident bootloader + the current application, verifies both,
# resets, and confirms the application is actually running (green LED).
# After this, the board never needs BOOT mode or ST-Link again - customers
# update it over USB with one click in the web updater.
#
#   .\factory_burn.ps1                    # uses the files in main_firmware\
#   .\factory_burn.ps1 -App path\M_x.bin  # specific application build
param(
    [string]$B   = (Join-Path (Split-Path -Parent $PSScriptRoot) 'main_firmware\B1.bin'),
    [string]$App = '',
    [string]$CLI = 'C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe',
    [string]$Loader = 'C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin\ExternalLoader\new_external_loader26.stldr'
)
$ErrorActionPreference = 'Stop'
function Log($m) { "{0}  {1}" -f (Get-Date -Format HH:mm:ss), $m }

if (-not $App) {
    $mainDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'main_firmware'
    $m = Get-ChildItem $mainDir -Filter 'M*.bin' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $m) { throw "No M*.bin found in $mainDir" }
    $App = $m.FullName
}
Log "Bootloader : $B"
Log "Application: $App"

Log "1/3 Flashing resident bootloader (internal flash)..."
& $CLI -c port=SWD mode=UR reset=HWrst -w "$B" 0x08000000 -v -q | Out-Null
if ($LASTEXITCODE -ne 0) { throw "bootloader flash failed - check ST-Link connection" }
Log "    OK (verified)."

Log "2/3 Flashing application (external flash, ~30 s)..."
& $CLI -c port=SWD mode=UR reset=HWrst -el "$Loader" -w "$App" 0x90000000 -v -hardRst -q | Out-Null
if ($LASTEXITCODE -ne 0) { throw "application flash failed" }
Log "    OK (verified). Board resetting..."

Log "3/3 Waiting for the application to boot (~15 s first-boot check)..."
$deadline = (Get-Date).AddSeconds(75)
$com = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $d = Get-WmiObject Win32_PnPEntity | Where-Object { $_.DeviceID -match 'VID_0483&PID_5740' -and $_.Name -match '\(COM(\d+)\)' }
    if ($d -and $d.Name -match '\(COM(\d+)\)') { $com = "COM$($Matches[1])"; break }
}
if ($com) {
    Start-Sleep -Seconds 3
    try {
        $sp = New-Object System.IO.Ports.SerialPort $com,115200,'None',8,'One'
        $sp.ReadTimeout = 300; $sp.DtrEnable = $true; $sp.Open(); Start-Sleep -Seconds 3
        $stream = $sp.ReadExisting(); $sp.Close()
        if ($stream.Contains('*?')) {
            Log '=============================================='
            Log ' BOARD PROVISIONED - application RUNNING.'
            Log ' Check the GREEN status LED. Ship it.'
            Log ' (ESP32 cloud module: flash once via the web'
            Log '  updater''s "Update cloud module" button.)'
            Log '=============================================='
            exit 0
        }
    } catch { }
    Log "Port $com present but app stream not confirmed - check the LED manually."
    exit 0
}
Log "No USB port seen (USB cable not connected to this PC?) - check the LED on the board."
exit 0
