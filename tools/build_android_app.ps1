# GATA - build an installable Android app (.apk) from the hosted updater.
#
# The app is a Trusted Web Activity: it runs the real Chrome engine, so WebUSB
# (the USB link to the controller) keeps working. A WebView wrapper such as
# Capacitor/Cordova CANNOT do this - see README.
#
#   .\build_android_app.ps1                                  # the shared app
#   .\build_android_app.ps1 -Id acme-water -Name "ACME Water" # one customer
#
# Output: dist\gata-updater[-<id>].apk  (signed, ready to install/side-load)
#
# Requirements (already present on the release PC): Android Studio's JDK 17,
# the Android SDK, and Node (npx). The signing keystore android\gata-release
# .keystore is created once by this script and MUST be backed up - Android
# only accepts updates signed with the same key.
param(
    [string]$Id,
    [string]$Name = "GATA Firmware Updater",
    [string]$SiteBase = "https://gata2024.github.io/gata-updater",
    [string]$KeystorePassword = "gata2026",
    [switch]$Bundle          # also build the .aab for Google Play
)
$ErrorActionPreference = "Stop"

$app     = Split-Path -Parent $PSScriptRoot
$android = Join-Path $app "android"
$dist    = Join-Path $app "dist"
$jdk     = "C:\Program Files\Android\Android Studio\jbr"
$sdk     = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$ks      = Join-Path $android "gata-release.keystore"

foreach ($p in @($jdk, $sdk)) { if (-not (Test-Path $p)) { throw "Not found: $p (install Android Studio + SDK)" } }
$buildTools = Get-ChildItem (Join-Path $sdk "build-tools") -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (-not $buildTools) { throw "No build-tools in $sdk" }

# ---- identity ------------------------------------------------------------
if ($Id) {
    if ($Id -notmatch '^[a-z0-9][a-z0-9-]{1,30}$') { throw "Customer id must be lowercase letters/digits/dashes." }
    $pkgSuffix = "." + ($Id -replace '-', '_')      # dashes are illegal in package names
    $startUrl  = "/gata-updater/c/$Id/"
    $appName   = "GATA Updater - $Name"
    $outName   = "gata-updater-$Id.apk"
    $manifestUrl = "$SiteBase/c/$Id/app.webmanifest"
} else {
    $pkgSuffix = ""
    $startUrl  = "/gata-updater/"
    $appName   = $Name
    $outName   = "gata-updater.apk"
    $manifestUrl = "$SiteBase/app.webmanifest"
}
$packageId = "com.gata.updater$pkgSuffix"
Write-Host "== Android app: $appName ==" -ForegroundColor Cyan
Write-Host "   package : $packageId"
Write-Host "   opens   : $startUrl"

# ---- keystore (created once, then reused) --------------------------------
if (-not (Test-Path $ks)) {
    Write-Host "   creating signing keystore (BACK THIS FILE UP)..." -ForegroundColor Yellow
    & "$jdk\bin\keytool" -genkeypair -v -keystore $ks -alias gata -keyalg RSA -keysize 2048 `
        -validity 10000 -storepass $KeystorePassword -keypass $KeystorePassword `
        -dname "CN=GATA Systems, OU=Software, O=GATA, C=SA" | Out-Null
}

# ---- twa-manifest --------------------------------------------------------
$twaPath = Join-Path $android "twa-manifest.json"
$twa = Get-Content $twaPath -Raw -Encoding UTF8 | ConvertFrom-Json
$twa.packageId    = $packageId
$twa.name         = $appName
$twa.launcherName = "GATA Update"
$twa.startUrl     = $startUrl
$twa.webManifestUrl = $manifestUrl
$twa.fullScopeUrl = ($SiteBase + $(if ($Id) { "/c/$Id/" } else { "/" })) -replace '(?<!:)//', '/'
[IO.File]::WriteAllText($twaPath, ($twa | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))

# ---- generate + build ----------------------------------------------------
Push-Location $android
try {
    $env:BUBBLEWRAP_KEYSTORE_PASSWORD = $KeystorePassword
    $env:BUBBLEWRAP_KEY_PASSWORD = $KeystorePassword
    $env:JAVA_HOME = $jdk
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk

    Write-Host "   generating Android project..."
    & npx --yes @bubblewrap/cli@latest update --skipVersionUpgrade 2>&1 | Select-String -Pattern "successfully|ERROR" | ForEach-Object { "     $_" }

    Write-Host "   compiling (first run downloads Gradle - be patient)..."
    $tasks = @("assembleRelease")
    if ($Bundle) { $tasks += "bundleRelease" }
    & cmd /c "gradlew.bat $($tasks -join ' ') --no-daemon" 2>&1 | Select-String -Pattern "BUILD SUCCESSFUL|BUILD FAILED|error:" | ForEach-Object { "     $_" }

    $unsigned = Get-ChildItem "app\build\outputs\apk\release\*.apk" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $unsigned) { throw "No APK produced - check the Gradle output above." }

    if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Force $dist | Out-Null }
    $outApk = Join-Path $dist $outName
    Write-Host "   signing..."
    & "$($buildTools.FullName)\apksigner.bat" sign --ks $ks --ks-pass "pass:$KeystorePassword" `
        --ks-key-alias gata --key-pass "pass:$KeystorePassword" --out $outApk $unsigned.FullName
    & "$($buildTools.FullName)\apksigner.bat" verify $outApk | Out-Null
    Write-Host ("   APK: dist\{0} ({1:N1} MB)" -f $outName, ((Get-Item $outApk).Length / 1MB)) -ForegroundColor Green

    if ($Bundle) {
        $aab = Get-ChildItem "app\build\outputs\bundle\release\*.aab" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($aab) {
            Copy-Item $aab.FullName (Join-Path $dist ($outName -replace '\.apk$', '.aab')) -Force
            Write-Host "   AAB (for Google Play): dist\$($outName -replace '\.apk$', '.aab')" -ForegroundColor Green
        }
    }
} finally { Pop-Location }

# ---- what still has to be published --------------------------------------
$fp = (& "$jdk\bin\keytool" -list -v -keystore $ks -alias gata -storepass $KeystorePassword |
       Select-String -Pattern "SHA256:" | Select-Object -First 1) -replace '.*SHA256:\s*', ''
Write-Host ""
Write-Host "Digital Asset Links entry for https://gata2024.github.io/.well-known/assetlinks.json" -ForegroundColor Cyan
Write-Host "(without it the app still works but shows a browser address bar):"
Write-Host (@"
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": { "namespace": "android_app", "package_name": "$packageId",
                "sha256_cert_fingerprints": ["$($fp.Trim())"] }
  }
"@)
