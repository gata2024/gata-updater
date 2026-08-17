@echo off
title GATA - freeze autopsy (run while frozen, do NOT unplug)
cd /d "%~dp0"
REM Board frozen mid-update? Leave it powered, connect the ST-Link, run this.
REM It captures WHERE the bootloader is stuck, then the board may be power-cycled.
powershell -NoProfile -ExecutionPolicy Bypass -File "autopsy_freeze.ps1"
