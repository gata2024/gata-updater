# GATA - freeze autopsy. Run while the board is FROZEN (do NOT unplug/reset!).
# Attaches to the wedged bootloader over ST-Link SWD without resetting it and
# captures a full backtrace = the exact line it is stuck on.
# Requires: ST-Link plugged into the board's SWD header.
$ErrorActionPreference = "Continue"

$ide     = 'C:\ST\STM32CubeIDE_1.15.1\STM32CubeIDE\plugins'
$gdbsrv  = "$ide\com.st.stm32cube.ide.mcu.externaltools.stlink-gdb-server.win32_2.2.500.202604010938\tools\bin\ST-LINK_gdbserver.exe"
$cubecli = "$ide\com.st.stm32cube.ide.mcu.externaltools.cubeprogrammer.win32_2.2.500.202603051304\tools\bin"
$gdb     = "$ide\com.st.stm32cube.ide.mcu.externaltools.gnu-tools-for-stm32.14.3.rel1.win32_1.0.100.202602081740\tools\bin\arm-none-eabi-gdb.exe"
$elf     = 'D:\emirates\saudi\makeLogicwork\gc22SramToflash\USBupdaterCode_relbuild\Debug\Booster_phase.elf'
$out     = Join-Path $PSScriptRoot ("autopsy_" + (Get-Date -Format yyyyMMdd_HHmmss) + ".log")

Write-Host "=== GATA freeze autopsy ===" -ForegroundColor Cyan
Write-Host "Board must still be FROZEN and powered. ST-Link connected."
foreach ($p in @($gdbsrv, $gdb, $elf)) {
    if (-not (Test-Path $p)) { Write-Host "MISSING: $p" -ForegroundColor Red; Read-Host "ENTER to close"; exit 1 }
}

# 1. gdb server, attach without reset (proven one-shot recipe)
Write-Host "Starting ST-LINK gdbserver (attach, no reset)..."
$srv = Start-Process -FilePath $gdbsrv -ArgumentList @('-p','61234','-l','1','-d','-g','-cp',"`"$cubecli`"") `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot\gdbsrv_out.txt" -RedirectStandardError "$PSScriptRoot\gdbsrv_err.txt"
Start-Sleep -Seconds 4
if ($srv.HasExited) {
    Write-Host "gdbserver exited immediately - is the ST-Link plugged in?" -ForegroundColor Red
    Get-Content "$PSScriptRoot\gdbsrv_err.txt" -ErrorAction SilentlyContinue | Select-Object -Last 10
    Read-Host "ENTER to close"; exit 1
}

# 2. one-shot gdb: where is it stuck?
Write-Host "Attaching gdb and taking the backtrace..."
& $gdb -batch `
    -ex "set pagination off" `
    -ex "file `"$elf`"" `
    -ex "target extended-remote localhost:61234" `
    -ex "echo \n=== BACKTRACE (the stuck line) ===\n" `
    -ex "bt full" `
    -ex "echo \n=== REGISTERS ===\n" `
    -ex "info registers" `
    -ex "echo \n=== QUADSPI CR/DCR/SR/FCR @0x52005000 ===\n" `
    -ex "x/4wx 0x52005000" `
    -ex "detach" 2>&1 | Tee-Object -FilePath $out

# 3. cleanup
try { Stop-Process -Id $srv.Id -Force -ErrorAction Stop } catch {}
Remove-Item "$PSScriptRoot\gdbsrv_out.txt","$PSScriptRoot\gdbsrv_err.txt" -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Autopsy saved: $out" -ForegroundColor Green
Write-Host "Send this file - it names the guilty line. The board can be power-cycled now."
Read-Host "ENTER to close"
