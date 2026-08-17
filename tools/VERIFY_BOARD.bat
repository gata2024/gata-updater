@echo off
title GATA board rescue / verification
cd /d "%~dp0"
REM Plug the board in ANY state (running, blank, BOOT switch high - anything).
REM This detects the state and drives the board to a running green-LED app
REM completely by itself. Watches for up to 20 minutes.
powershell -NoProfile -ExecutionPolicy Bypass -File "any_state_update.ps1"
pause
