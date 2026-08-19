# GATA - build GATA_Release_Manager.exe (YOUR release tool, never given to customers).
#
# Uses the C# compiler that ships inside Windows - nothing to install.
#
#   .\build_release_manager.ps1
$ErrorActionPreference = "Stop"

$app  = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $PSScriptRoot "ReleaseManager.cs"
$out  = Join-Path $app "GATA_Release_Manager.exe"
$icon = Join-Path $app "icon.ico"

$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { throw "No C# compiler found (expected $csc)" }
if (-not (Test-Path $src)) { throw "Source not found: $src" }

$refs = @("/r:System.dll", "/r:System.Drawing.dll", "/r:System.Windows.Forms.dll", "/r:System.Core.dll")
$args = @("/nologo", "/target:winexe", "/optimize+", "/platform:anycpu") + $refs +
        @("/out:`"$out`"", "`"$src`"")
if (Test-Path $icon) { $args = @("/win32icon:`"$icon`"") + $args }

Write-Host "Compiling GATA_Release_Manager.exe ..." -ForegroundColor Cyan
& $csc @args
if ($LASTEXITCODE -ne 0) { throw "Compilation failed." }

$size = (Get-Item $out).Length
Write-Host ("Built: {0} ({1:N0} bytes)" -f $out, $size) -ForegroundColor Green
Write-Host "Double-click GATA_Release_Manager.exe in the uploader folder to release firmware."
Write-Host "This tool is for YOU only - it reads tools\ (your keys). Never send it to a customer." -ForegroundColor Yellow
