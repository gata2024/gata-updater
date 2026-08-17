# Catch the ~80 s bootloader assassin in the act: stream until the first
# write stall, then IMMEDIATELY read uptime + backtrace via ST-Link/GDB
# before anything reboots or recovers.
$ErrorActionPreference = "Stop"
function Log($m) { "{0}  {1}" -f (Get-Date -Format HH:mm:ss.fff), $m }

$CLI = 'C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe'
$GDBSRV = 'C:\ST\STM32CubeIDE_1.15.1\STM32CubeIDE\plugins\com.st.stm32cube.ide.mcu.externaltools.stlink-gdb-server.win32_2.2.500.202604010938\tools\bin\ST-LINK_gdbserver.exe'
$GDB = 'C:\ST\STM32CubeIDE_1.15.1\STM32CubeIDE\plugins\com.st.stm32cube.ide.mcu.externaltools.gnu-tools-for-stm32.14.3.rel1.win32_1.0.100.202602081740\tools\bin\arm-none-eabi-gdb.exe'
$ELF = 'd:\emirates\saudi\makeLogicwork\gc22SramToflash\USBupdaterCode_relbuild\Debug\Booster_phase.elf'
$appBin = 'D:\emirates\saudi\makeLogicwork\gc22SramToflash\GATA_Cloud_Uploader\main_firmware\M_16_8_26_3.bin'
$bytes = [IO.File]::ReadAllBytes($appBin)

function Find-Com {
    $d = Get-WmiObject Win32_PnPEntity | Where-Object { $_.DeviceID -match 'VID_0483&PID_5740' -and $_.Name -match '\(COM(\d+)\)' }
    if ($d -and $d.Name -match '\(COM(\d+)\)') { return "COM$($Matches[1])" }
    return $null
}
function WaitFor($sp, [string[]]$good, [string[]]$bad, [int]$timeoutS) {
    $acc = ''; $t0 = Get-Date
    while (((Get-Date) - $t0).TotalSeconds -lt $timeoutS) {
        Start-Sleep -Milliseconds 120
        $acc += $sp.ReadExisting()
        foreach ($g in $good) { if ($acc.Contains($g)) { return $g } }
        foreach ($b in $bad) { if ($acc.Contains($b)) { throw "device error: $b" } }
    }
    throw ("timeout waiting {0}" -f ($good -join '/'))
}
function Read-Uptime {
    $out = & $CLI -c port=SWD mode=HOTPLUG -r32 0x24002860 1 2>&1 | Out-String
    if ($out -match '0x24002860\s*:\s*([0-9A-Fa-f]+)') { return [Convert]::ToInt64($Matches[1], 16) }
    return -1
}

Log "ST-Link hard reset..."
& $CLI -c port=SWD mode=UR reset=HWrst -hardRst -q | Out-Null
$bootWall = Get-Date
Start-Sleep -Seconds 4

$com = $null; $t0 = Get-Date
while (-not $com -and ((Get-Date) - $t0).TotalSeconds -lt 30) { Start-Sleep -Seconds 2; $com = Find-Com }
if (-not $com) { Log "no port"; exit 1 }
Log "Port: $com (board booted ~$($bootWall.ToString('HH:mm:ss')))"

$sp = New-Object System.IO.Ports.SerialPort $com,115200,'None',8,'One'
$sp.ReadTimeout = 300; $sp.WriteTimeout = 3000
$sp.DtrEnable = $true; $sp.RtsEnable = $true
$sp.Open(); Start-Sleep -Milliseconds 900; $null = $sp.ReadExisting()

$sp.Write("INFO`n"); $null = WaitFor $sp @('MCU:STM32') @('UNKNOWN_COMMAND') 6
Log "INFO OK. Device uptime now: $(Read-Uptime) ms"

$null = $sp.ReadExisting(); $sp.Write("FORMAT`n")
Log "FORMAT..."
$null = WaitFor $sp @('FORMAT_COMPLETE') @('FORMAT_ERROR','QSPI') 130
Log ("FORMAT complete. Wall since boot: {0:n0} s. Device uptime: {1} ms" -f ((Get-Date) - $bootWall).TotalSeconds, (Read-Uptime))

$null = $sp.ReadExisting(); $sp.Write("WRITE:$($bytes.Length)`n")
$null = WaitFor $sp @('READY_FOR_DATA') @('QSPI_INIT_ERROR') 6
Log "Streaming (3 s write timeout = fast trip-wire)..."

$off = 0
try {
    while ($off -lt $bytes.Length) {
        $n = [Math]::Min(1024, $bytes.Length - $off)
        $sp.Write($bytes, $off, $n)
        $off += $n
        if (($off % 131072) -eq 0) {
            Log ("  {0} KB  wall+{1:n0}s  uptime={2}ms" -f [int]($off/1024), ((Get-Date) - $bootWall).TotalSeconds, (Read-Uptime))
            $null = $sp.ReadExisting()
        }
    }
    Log "COMPLETE?! Full stream went through - waiting for COMPLETE..."
    $null = WaitFor $sp @('COMPLETE') @('WRITE_ERROR') 25
    Log "WRITE COMPLETE - no assassin this run. VERIFY+JUMP:"
    $null = $sp.ReadExisting(); $sp.Write("VERIFY`n"); $null = WaitFor $sp @('VERIFY_OK') @('VERIFY_FAILED') 8
    $null = $sp.ReadExisting(); $sp.Write("JUMP`n"); Start-Sleep -Milliseconds 300
    try { $sp.Close() } catch {}
    Log "JUMP sent. Watching for app..."
    $t0 = Get-Date; $com2 = $null
    while (-not $com2 -and ((Get-Date) - $t0).TotalSeconds -lt 60) { Start-Sleep -Seconds 2; $com2 = Find-Com }
    if ($com2) {
        Start-Sleep -Seconds 3
        $sp2 = New-Object System.IO.Ports.SerialPort $com2,115200,'None',8,'One'
        $sp2.ReadTimeout = 300; $sp2.DtrEnable = $true; $sp2.Open(); Start-Sleep -Seconds 3
        $stream = $sp2.ReadExisting(); $sp2.Close()
        if ($stream.Contains('*?')) { Log "SUCCESS - APPLICATION RUNNING (GREEN LED)."; exit 0 }
    }
    Log "app did not confirm"; exit 1
} catch {
    $stallWall = ((Get-Date) - $bootWall).TotalSeconds
    Log ("*** STALL at {0} KB, wall since boot = {1:n0} s ***" -f [int]($off/1024), $stallWall)
    try { $sp.Close() } catch {}

    $up = Read-Uptime
    Log "Device uptime register: $up ms  (>= 70000 = no reboot happened; small = it REBOOTED)"

    Log "--- live backtrace ---"
    Start-Process -FilePath $GDBSRV -ArgumentList '-p','61234','-l','1','-d','-g','-cp','C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin' -WindowStyle Hidden
    Start-Sleep -Seconds 4
    & $GDB -batch -ex "target extended-remote localhost:61234" -ex "bt" -ex "info registers pc lr" -ex "p uwTick" -ex "detach" $ELF 2>&1 | Select-Object -First 18
    taskkill /IM ST-LINK_gdbserver.exe /F 2>$null | Out-Null
    exit 2
}
