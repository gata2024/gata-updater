# Catch-all updater: whatever state the board appears in, drive it to a
# running green-LED application with no human action.
#  - ROM DFU (BOOT switch high): dfu-util flash B1 + :leave (jump, no reset)
#  - running application: send enterBootloader over the HMI protocol
#  - parked/update-mode bootloader: run FORMAT -> WRITE -> VERIFY -> JUMP
$ErrorActionPreference = "Continue"
function Log($m) { "{0}  {1}" -f (Get-Date -Format HH:mm:ss), $m }

$DFUUTIL = 'D:\emirates\saudi\makeLogicwork\gc22SramToflash\USB_Uploder\dfu-util.exe'
$B1 = 'D:\emirates\saudi\makeLogicwork\gc22SramToflash\GATA_Cloud_Uploader\main_firmware\B1.bin'
$APP = 'D:\emirates\saudi\makeLogicwork\gc22SramToflash\GATA_Cloud_Uploader\main_firmware\M_16_8_26_3.bin'
$bytes = [IO.File]::ReadAllBytes($APP)

function Find-Dfu { [bool](Get-WmiObject Win32_PnPEntity | Where-Object { $_.DeviceID -match 'VID_0483&PID_DF11' }) }
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

Log "Watching for the board in ANY state (up to 20 min). Plug it in however it is."
$deadline = (Get-Date).AddMinutes(20)
$stallStrikes = 0

while ((Get-Date) -lt $deadline) {
    try {
        if (Find-Dfu) {
            Log "ROM DFU detected (BOOT switch high or bare chip) - flashing B1 + jump (:leave)..."
            & $DFUUTIL -d 0483:df11 -a 0 -s 0x08000000:leave -D $B1 2>&1 | Select-String -Pattern "Download|error" | ForEach-Object { Log ("  dfu-util: " + $_.Line.Trim()) }
            Start-Sleep -Seconds 4
            continue
        }
        $com = Find-Com
        if (-not $com) { Start-Sleep -Seconds 3; continue }

        Log "Serial port $com detected - probing who answers..."
        $sp = New-Object System.IO.Ports.SerialPort $com,115200,'None',8,'One'
        $sp.ReadTimeout = 300; $sp.WriteTimeout = 8000
        $sp.DtrEnable = $true; $sp.RtsEnable = $true
        $sp.Open(); Start-Sleep -Milliseconds 1200
        $probe = $sp.ReadExisting()

        if ($probe.Contains('*?')) {
            Log "APPLICATION is running - commanding it into update mode (enterBootloader)..."
            $sp.Write("8321*?enterBootloader*?19*8*e*`r`n")
            Start-Sleep -Milliseconds 1500
            try { $sp.Close() } catch { }
            Start-Sleep -Seconds 3
            continue
        }

        $null = $sp.ReadExisting(); $sp.Write("INFO`n")
        try { $null = WaitFor $sp @('MCU:STM32') @() 5 } catch {
            Log "Port silent - retrying shortly..."; try { $sp.Close() } catch { }; Start-Sleep -Seconds 3; continue
        }
        Log "UPDATE FIRMWARE answered - running the full update."

        $null = $sp.ReadExisting(); $sp.Write("FORMAT`n")
        Log "FORMAT (~40 s)..."
        $null = WaitFor $sp @('FORMAT_COMPLETE') @('FORMAT_ERROR','QSPI') 130
        Log "FORMAT complete."

        $null = $sp.ReadExisting(); $sp.Write("WRITE:$($bytes.Length)`n")
        $null = WaitFor $sp @('READY_FOR_DATA') @('QSPI_INIT_ERROR') 6
        Log "Streaming $($bytes.Length) bytes..."
        $off = 0; $t0 = Get-Date
        while ($off -lt $bytes.Length) {
            $n = [Math]::Min(1024, $bytes.Length - $off)
            $sp.Write($bytes, $off, $n)
            $off += $n
            if (($off % 131072) -eq 0) { Log ("  {0}/{1} KB ({2:n0}s)" -f [int]($off/1024), [int]($bytes.Length/1024), ((Get-Date)-$t0).TotalSeconds); $null = $sp.ReadExisting() }
            Start-Sleep -Milliseconds 5
        }
        $null = WaitFor $sp @('COMPLETE') @('WRITE_ERROR','FLASH_VERIFY_ERROR','QSPI_MMAP_ERROR') 25
        Log ("WRITE complete in {0:n0} s." -f ((Get-Date)-$t0).TotalSeconds)

        $null = $sp.ReadExisting(); $sp.Write("VERIFY`n")
        $null = WaitFor $sp @('VERIFY_OK') @('VERIFY_FAILED') 8
        Log "VERIFY OK."

        $null = $sp.ReadExisting(); $sp.Write("JUMP`n")
        Log "JUMP (instant silent reset)..."
        Start-Sleep -Milliseconds 300
        try { $sp.Close() } catch { }

        $t0 = Get-Date; $gone = $false
        while (((Get-Date) - $t0).TotalSeconds -lt 8) { if (-not (Find-Com)) { $gone = $true; break }; Start-Sleep -Milliseconds 400 }
        Log ($(if ($gone) { "Port dropped - JUMP reset confirmed." } else { "Port did not drop (old bootloader?) - continuing to watch." }))

        $t0 = Get-Date; $com2 = $null
        while (-not $com2 -and ((Get-Date) - $t0).TotalSeconds -lt 60) {
            if (Find-Dfu) {
                Log "Board came back in ROM DFU (BOOT switch high) - jumping past it (:leave, no flash needed but harmless)..."
                & $DFUUTIL -d 0483:df11 -a 0 -s 0x08000000:leave -D $B1 2>&1 | Out-Null
                Start-Sleep -Seconds 3
            }
            Start-Sleep -Seconds 2; $com2 = Find-Com
        }
        if (-not $com2) { Log "Application did not come back within 60 s."; continue }
        Start-Sleep -Seconds 3
        $sp2 = New-Object System.IO.Ports.SerialPort $com2,115200,'None',8,'One'
        $sp2.ReadTimeout = 300; $sp2.DtrEnable = $true; $sp2.Open(); Start-Sleep -Seconds 3
        $stream = $sp2.ReadExisting(); $sp2.Close()
        if (-not $stream.Contains('*?')) {
            Start-Sleep -Seconds 10
            $sp2.Open(); Start-Sleep -Seconds 3; $stream = $sp2.ReadExisting(); $sp2.Close()
        }
        if ($stream.Contains('*?')) {
            Log "============================================================"
            Log "SUCCESS: APPLICATION IS RUNNING on $com2 - LED should be GREEN."
            Log "Full hands-free chain verified from whatever state the board was in."
            Log "REMINDER: put the BOOT switch back to normal before power-off."
            Log "============================================================"
            exit 0
        }
        Log "Port back but no application stream - continuing to watch."
    } catch {
        $stallStrikes++
        Log ("Attempt failed: {0}  (strike {1})" -f $_.Exception.Message.Trim(), $stallStrikes)
        try { if ($sp -and $sp.IsOpen) { $sp.Close() } } catch { }
        if ($stallStrikes -ge 4) {
            Log "4 strikes - stopping. If stalls persist on this cable too, the board's USB hardware needs a look."
            exit 1
        }
        Start-Sleep -Seconds 4
    }
}
Log "No success within 20 min - stopping."
exit 1
