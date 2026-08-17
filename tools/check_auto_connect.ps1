# Exit 0 when the browser auto-connect policies are installed for ALL covered
# Chromium-family browsers, exit 1 otherwise. Used by CLICK_ME_START_ON_PC.bat
# to decide whether the one-time admin setup still needs to run.
$keys = @(
    "HKLM:\Software\Policies\Google\Chrome",
    "HKLM:\Software\Policies\Microsoft\Edge",
    "HKLM:\Software\Policies\BraveSoftware\Brave",
    "HKLM:\Software\Policies\Chromium"
)
foreach ($k in $keys) {
    $p = Get-ItemProperty $k -ErrorAction SilentlyContinue
    if (-not ($p -and $p.SerialAllowUsbDevicesForUrls -and $p.WebUsbAllowDevicesForUrls)) { exit 1 }
}
exit 0
