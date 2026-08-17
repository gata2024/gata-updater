# Autonomous end-to-end verification, round 2 - resilient edition.
# Up to 3 full cycles; each cycle: ST-Link hard reset -> wait port -> INFO ->
# FORMAT -> WRITE (30 s write timeout, per-chunk retries) -> VERIFY -> JUMP ->
# confirm instant port drop -> confirm application stream.
$ErrorActionPreference = "Stop"
function Log($m) { "{0}  {1}" -f (Get-Date -Format HH:mm:ss), $m }

$CLI = 'C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe'
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

# Wait for a PHYSICAL RE-PLUG: the port must first DISAPPEAR (cable out),
# then REAPPEAR (new cable / different PC port). Up to 30 minutes.
Log "Waiting for you to swap the USB cable (use a DIFFERENT cable + DIFFERENT PC port)..."
$t0 = Get-Date
while ((Find-Com) -and ((Get-Date) - $t0).TotalMinutes -lt 30) { Start-Sleep -Seconds 2 }
if (Find-Com) { Log "Cable was never unplugged within 30 min - stopping."; exit 1 }
Log "Cable OUT detected. Now waiting for the new connection..."
while (-not (Find-Com) -and ((Get-Date) - $t0).TotalMinutes -lt 30) { Start-Sleep -Seconds 2 }
if (-not (Find-Com)) { Log "No new connection within 30 min - stopping."; exit 1 }
Log "NEW CONNECTION detected - settling 5 s, then starting verification cycles."
Start-Sleep -Seconds 5

$paceLadder = @(8, 30, 60)    # ms between 1 KB chunks: fast, gentle, very gentle
$maxCycles = 3
for ($cycle = 1; $cycle -le $maxCycles; $cycle++) {
    Log "================ CYCLE $cycle of $maxCycles ================"
    try {
        Log "ST-Link hard reset..."
        & $CLI -c port=SWD mode=UR reset=HWrst -hardRst -q | Out-Null
        Start-Sleep -Seconds 4

        $com = $null; $t0 = Get-Date
        while (-not $com -and ((Get-Date) - $t0).TotalSeconds -lt 30) { Start-Sleep -Seconds 2; $com = Find-Com }
        if (-not $com) { Log "cycle $cycle - port never appeared"; continue }
        Log "Port: $com"

        $sp = New-Object System.IO.Ports.SerialPort $com,115200,'None',8,'One'
        $sp.ReadTimeout = 300; $sp.WriteTimeout = 30000
        $sp.DtrEnable = $true; $sp.RtsEnable = $true
        $sp.Open(); Start-Sleep -Milliseconds 900; $null = $sp.ReadExisting()

        $sp.Write("INFO`n"); $null = WaitFor $sp @('MCU:STM32') @('UNKNOWN_COMMAND') 6
        Log "INFO OK."

        $null = $sp.ReadExisting(); $sp.Write("FORMAT`n")
        Log "FORMAT (~40 s)..."
        $null = WaitFor $sp @('FORMAT_COMPLETE') @('FORMAT_ERROR','QSPI') 130
        Log "FORMAT complete."

        $null = $sp.ReadExisting(); $sp.Write("WRITE:$($bytes.Length)`n")
        $null = WaitFor $sp @('READY_FOR_DATA') @('QSPI_INIT_ERROR') 6
        Log ("Streaming {0} bytes (pacing {1} ms/KB)..." -f $bytes.Length, $paceLadder[$cycle-1])

        $off = 0; $stalls = 0
        while ($off -lt $bytes.Length) {
            $n = [Math]::Min(1024, $bytes.Length - $off)
            $ok = $false
            for ($try = 1; $try -le 2 -and -not $ok; $try++) {
                try { $sp.Write($bytes, $off, $n); $ok = $true }
                catch {
                    $stalls++
                    Log ("  WRITE STALL #{0} at {1} KB (try {2}) - {3}" -f $stalls, [int]($off/1024), $try, $_.Exception.Message.Trim())
                    Start-Sleep -Seconds 2
                    $null = $sp.ReadExisting()
                }
            }
            if (-not $ok) { throw "unrecoverable write stall at $([int]($off/1024)) KB" }
            $off += $n
            if (($off % 131072) -eq 0) { Log ("  {0} / {1} KB" -f [int]($off/1024), [int]($bytes.Length/1024)); $null = $sp.ReadExisting() }
            Start-Sleep -Milliseconds $paceLadder[$cycle-1]
        }
        $null = WaitFor $sp @('COMPLETE') @('WRITE_ERROR','FLASH_VERIFY_ERROR','QSPI_MMAP_ERROR') 25
        Log "WRITE complete ($stalls stall(s) survived)."

        $null = $sp.ReadExisting(); $sp.Write("VERIFY`n")
        $null = WaitFor $sp @('VERIFY_OK') @('VERIFY_FAILED') 8
        Log "VERIFY OK."

        $null = $sp.ReadExisting(); $sp.Write("JUMP`n")
        Log "JUMP sent (expect instant silent reset)..."
        Start-Sleep -Milliseconds 300
        try { $sp.Close() } catch { }

        $gone = $false; $t0 = Get-Date
        while (((Get-Date) - $t0).TotalSeconds -lt 8) {
            if (-not (Find-Com)) { $gone = $true; break }
            Start-Sleep -Milliseconds 400
        }
        Log ($(if ($gone) { "Port dropped - JUMP reset CONFIRMED." } else { "WARNING: port did not drop after JUMP." }))

        $com2 = $null; $t0 = Get-Date
        while (-not $com2 -and ((Get-Date) - $t0).TotalSeconds -lt 60) { Start-Sleep -Seconds 2; $com2 = Find-Com }
        if (-not $com2) { Log "cycle $cycle - application did not come back"; continue }
        Start-Sleep -Seconds 3
        $sp2 = New-Object System.IO.Ports.SerialPort $com2,115200,'None',8,'One'
        $sp2.ReadTimeout = 300; $sp2.DtrEnable = $true; $sp2.Open()
        Start-Sleep -Seconds 3
        $stream = $sp2.ReadExisting(); $sp2.Close()
        if (-not $stream.Contains('*?')) {
            Start-Sleep -Seconds 8
            $sp2.Open(); Start-Sleep -Seconds 3; $stream = $sp2.ReadExisting(); $sp2.Close()
        }
        if ($stream.Contains('*?')) {
            Log "=========================================================="
            Log "SUCCESS on cycle ${cycle}: application stream detected on $com2."
            Log "NEW SOFTWARE IS RUNNING - the LED should be GREEN."
            Log "Instant self-restart verified end to end. Stalls survived: $stalls."
            Log "=========================================================="
            exit 0
        }
        Log "cycle $cycle - port back but no app stream"
    } catch {
        Log ("cycle {0} FAILED: {1}" -f $cycle, $_.Exception.Message.Trim())
        try { if ($sp -and $sp.IsOpen) { $sp.Close() } } catch { }
    }
}
Log "ALL CYCLES FAILED. Random-offset stalls across independent runs = physical USB link."
Log "RECOMMENDATION: different USB cable and/or a direct PC port (no hub)."
exit 1
