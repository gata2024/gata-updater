# GATA - put firmware INSIDE the shared (General) app at the site root.
#
# The companion of build_customer_site.ps1, which does the same for ONE
# company's app at c\<id>\. This one is for General, because General's app IS
# the site root - there is no c\default folder (and "default" is not a legal
# Android package name either).
#
#   .\refresh_builtin.ps1 -Controller ..\..\g_500\Debug\NPC20_mini.bin `
#                         -System ..\..\USBupdaterCode_relbuild\Debug\Booster_phase.bin `
#                         -EspDir ..\..\esp\.pio\build\esp32dev
#
# Deploy afterwards (git push) - and the app version must change too, or an
# installed phone keeps serving the copy it already stored.
param(
    [string]$Controller,
    [string]$System,
    [string]$EspDir,
    [switch]$NoEsp,
    # No firmware inside the app at all: customers download from the cloud
    # every time. Anything already inside is removed, so what the app offers
    # is never something nobody chose.
    [switch]$NoFirmware,
    [ValidateSet("rev5", "rev6", "all")] [string]$Board = "rev6",
    [string]$Company = "General"
)
$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$app = Split-Path -Parent $ScriptDir

$mainDir  = Join-Path $app "main_firmware"
$cloudDir = Join-Path $app "cloud_firmware"
New-Item -ItemType Directory -Force $mainDir  | Out-Null
New-Item -ItemType Directory -Force $cloudDir | Out-Null

Write-Host "== Firmware inside the $Company app (site root) ==" -ForegroundColor Cyan

# Never leave a stale mix: what is listed must be what is there.
Get-ChildItem $mainDir  -Filter *.bin | Remove-Item -Force
Get-ChildItem $cloudDir -Filter *.bin | Remove-Item -Force

$tag = (Get-Date -Format "dd_MM_yy") + "_" + ($Company -replace '[^0-9A-Za-z]', '') + "_" + $Board
$receipt = [ordered]@{}
$builtAt = [ordered]@{}
function Put([string]$src, [string]$folder, [string]$destName) {
    if (-not $src -or -not (Test-Path $src)) { return $false }
    $dst = Join-Path (Join-Path $script:app $folder) $destName
    Copy-Item $src $dst -Force
    $a = (Get-FileHash $src -Algorithm SHA256).Hash.ToLower()
    $b = (Get-FileHash $dst -Algorithm SHA256).Hash.ToLower()
    if ($a -ne $b) { Write-Host "   !! COPY MISMATCH: $destName" -ForegroundColor Red; return $false }
    $script:receipt["$folder/$destName"] = $b
    $script:builtAt["$folder/$destName"] = (Get-Item $src).LastWriteTime.ToString("yyyy-MM-dd HH:mm")
    Write-Host ("      {0}\{1}   [{2}]   built {3}" -f $folder, $destName, $b.Substring(0, 12),
                (Get-Item $src).LastWriteTime.ToString("yyyy-MM-dd HH:mm"))
    return $true
}

$n = 0
if (-not $NoFirmware) {
  if (Put $Controller "main_firmware" ("controller_" + $tag + ".bin")) { $n++ }
  if (Put $System     "main_firmware" ("system_"     + $tag + ".bin")) { $n++ }
}
if (-not $NoFirmware -and -not $NoEsp -and $EspDir -and (Test-Path $EspDir)) {
    foreach ($part in @("bootloader.bin", "partitions.bin", "boot_app0.bin", "firmware.bin")) {
        if (Put (Join-Path $EspDir $part) "cloud_firmware" $part) { $n++ }
        else { Write-Host "      ! missing ESP file: $part" -ForegroundColor Yellow }
    }
}

$rec = [ordered]@{ company = $Company; board = $Board;
                   built = (Get-Date -Format "yyyy-MM-dd HH:mm");
                   files = $receipt; built_times = $builtAt }
if ($NoFirmware) {
    Remove-Item (Join-Path $app "firmware_receipt.json") -Force -ErrorAction SilentlyContinue
} else {
    [IO.File]::WriteAllText((Join-Path $app "firmware_receipt.json"),
                            ($rec | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
}

$bi = [ordered]@{
    note = "Firmware that ships with the app. The service worker stores these on the device at first run, so the updater also works with no internet."
    main_firmware  = @(Get-ChildItem $mainDir  -Filter *.bin | Sort-Object Name |
                       ForEach-Object { [ordered]@{ name = $_.Name; size = [int]$_.Length } })
    cloud_firmware = @(Get-ChildItem $cloudDir -Filter *.bin | Sort-Object Name |
                       ForEach-Object { [ordered]@{ name = $_.Name; size = [int]$_.Length } })
}
[IO.File]::WriteAllText((Join-Path $app "builtin.json"),
                        ($bi | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))

if ($NoFirmware) {
    if ((Get-ChildItem $mainDir  -Filter *.bin).Count -ne 0 -or
        (Get-ChildItem $cloudDir -Filter *.bin).Count -ne 0) {
        throw "firmware is still inside the app - it was NOT emptied."
    }
    Write-Host "   firmware   : NONE - this app downloads from the cloud every time." -ForegroundColor Yellow
} else {
    Write-Host "   $n file(s) inside the app  (+ builtin.json, firmware_receipt.json)"
}
Write-Host ""
Write-Host "Now bump APP_CONFIG.version and deploy, or installed phones keep the copy they already stored." -ForegroundColor Yellow
exit 0
