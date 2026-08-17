@echo off
title GATA - install DFU driver (no Zadig needed)
cd /d "%~dp0"
REM Board in BOOT mode + plugged in, then run this once per PC.
REM Uses Windows' own Microsoft-signed WinUSB driver - nothing downloaded.
powershell -NoProfile -ExecutionPolicy Bypass -File "install_dfu_driver.ps1"
