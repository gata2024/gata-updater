# GATA - build GATA_Updater.exe (the Windows program handed to customers).
#
# Uses the C# compiler that ships inside Windows (.NET Framework) - nothing to
# install, no SDK, no internet. The result runs on any Windows 7/10/11 PC.
#
#   .\build_exe.ps1
$ErrorActionPreference = "Stop"

$app = Split-Path -Parent $PSScriptRoot
$src = Join-Path $PSScriptRoot "GataUpdater.cs"
$out = Join-Path $app "GATA_Updater.exe"
$icon = Join-Path $app "icon.ico"

$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { throw "No C# compiler found (expected $csc)" }
if (-not (Test-Path $src)) { throw "Source not found: $src" }

$args = @("/nologo", "/target:exe", "/optimize+", "/platform:anycpu",
          "/out:`"$out`"", "`"$src`"")
if (Test-Path $icon) { $args = @("/win32icon:`"$icon`"") + $args }

Write-Host "Compiling GATA_Updater.exe ..." -ForegroundColor Cyan
& $csc @args
if ($LASTEXITCODE -ne 0) { throw "Compilation failed." }

$size = (Get-Item $out).Length
Write-Host ("Built: {0} ({1:N0} bytes)" -f $out, $size) -ForegroundColor Green
Write-Host "Give customers the whole folder - they double-click GATA_Updater.exe."
