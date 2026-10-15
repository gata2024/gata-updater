@echo off
REM ==========================================================================
REM  GATA Firmware Updater - the only file to run on a PC.
REM
REM  1. First run only: sets up fully automatic USB connection in Chrome/Edge
REM     (a Windows admin prompt appears once - click Yes; if you click No the
REM     updater still works, the browser just asks to pick the device once).
REM  2. Starts the local server and opens the updater in your browser.
REM  Keep this window open while using the updater.
REM ==========================================================================
title GATA Firmware Updater
cd /d "%~dp0"

REM ---- one-time USB auto-connect setup (skipped when already installed) ----
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\check_auto_connect.ps1"
if errorlevel 1 (
    echo.
    echo First-time setup: enabling automatic USB connection...
    echo A Windows admin prompt will appear - click YES.
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "tools\enable_auto_connect.ps1"
    echo.
    echo NOTE: if the browser was open during this setup, close it completely
    echo once and reopen the updater so the change takes effect.
    echo.
)

REM ---- start the updater ----------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\serve.ps1"
pause
