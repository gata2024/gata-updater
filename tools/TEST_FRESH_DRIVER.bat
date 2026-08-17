@echo off
title GATA - fresh-PC driver test
cd /d "%~dp0"
REM Simulates a brand-new PC: uninstalls the DFU driver + deletes its package,
REM then reinstalls it automatically and verifies. Board must be in BOOT mode
REM and plugged in BEFORE you run this. One admin approval.
powershell -NoProfile -ExecutionPolicy Bypass -File "test_fresh_driver.ps1"
pause
