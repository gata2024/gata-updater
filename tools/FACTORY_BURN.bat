@echo off
title GATA factory burn (ST-Link)
cd /d "%~dp0"
REM New board on the bench, ST-Link connected: one click burns bootloader +
REM application, verifies both, and confirms the app is running (green LED).
powershell -NoProfile -ExecutionPolicy Bypass -File "factory_burn.ps1"
pause
