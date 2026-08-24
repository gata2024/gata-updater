# GATA Cloud Uploader - tiny local web server (no Python, no installs).
# Web Serial / WebUSB require http://localhost or https, so plain file:// will
# not work - this script serves the app folder on http://127.0.0.1:8765 using
# only built-in Windows components (.NET TcpListener), then opens the browser.

param([int]$Port = 8765)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot   # app folder (parent of tools\)
$port = $Port
$prefix = "http://127.0.0.1:$port/"

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".htm"  = "text/html; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".webmanifest" = "application/manifest+json; charset=utf-8"
    ".svg"  = "image/svg+xml"
    ".png"  = "image/png"
    ".ico"  = "image/x-icon"
    ".bin"  = "application/octet-stream"
    ".txt"  = "text/plain; charset=utf-8"
    ".md"   = "text/plain; charset=utf-8"
}

# First run on this PC: create the firmware-source config from the example.
$fwCfg = Join-Path $PSScriptRoot 'firmware_source.json'
$fwExample = Join-Path $PSScriptRoot 'firmware_source.example.json'
if (-not (Test-Path $fwCfg) -and (Test-Path $fwExample)) { Copy-Item $fwExample $fwCfg }

# Serve THIS folder or nothing. Opening the browser at a busy port - which is
# what this used to do - hands the person whatever app already answers there:
# start a Danway folder next to a development copy and you get the General app,
# with its licence and its firmware channel, looking entirely normal. Walk to a
# free port instead, and open the one we actually bound.
$listener = $null
$first = $port
foreach ($try in 0..19) {
    $candidate = $first + $try
    $l = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), $candidate
    try { $l.Start(); $listener = $l; $port = $candidate; break }
    catch { try { $l.Stop() } catch { } }
}
if (-not $listener) {
    Write-Host ""
    Write-Host "ERROR: no free port between $first and $($first + 19)." -ForegroundColor Red
    Write-Host "Close the other updater windows and start this one again."
    Read-Host "Press ENTER to close"
    exit 1
}
$prefix = "http://127.0.0.1:$port/"

# Name the company this folder belongs to, so a mix-up shows before any flashing.
$chan = ""
try {
    $cfgTxt = Get-Content (Join-Path $root "js\config.js") -Raw
    if ($cfgTxt -match 'channel:\s*"([^"]*)"') { $chan = "  [" + $Matches[1] + "]" }
} catch { }

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  GATA Firmware Updater - local server running$chan" -ForegroundColor Cyan
Write-Host "  Open:  $prefix" -ForegroundColor Yellow
Write-Host "  Keep this window open while using the updater." -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""

Start-Process $prefix

while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
        $client.ReceiveTimeout = 5000
        $stream = $client.GetStream()

        # ---- read the request head (up to the blank line) ----
        $headBytes = New-Object System.IO.MemoryStream
        $buf = New-Object byte[] 4096
        $head = ""
        while ($head.IndexOf("`r`n`r`n") -lt 0) {
            $n = $stream.Read($buf, 0, $buf.Length)
            if ($n -le 0) { break }
            $headBytes.Write($buf, 0, $n)
            $head = [System.Text.Encoding]::ASCII.GetString($headBytes.ToArray())
            if ($headBytes.Length -gt 65536) { break }
        }
        if ($head.Length -eq 0) { $client.Close(); continue }

        $requestLine = ($head -split "`r`n")[0]
        $parts = $requestLine -split " "
        if ($parts.Count -lt 2) { $client.Close(); continue }
        $method = $parts[0]
        $rawPath = $parts[1]

        # ---- resolve the file ----
        $path = [Uri]::UnescapeDataString(($rawPath -split "\?")[0])
        if ($path.EndsWith("/")) { $path = $path + "index.html" }
        $rel = $path.TrimStart("/") -replace "/", "\"
        $full = Join-Path $root $rel
        $fullResolved = [System.IO.Path]::GetFullPath($full)

        $status = "200 OK"
        $body = $null
        $ctype = "application/octet-stream"

        if ($method -ne "GET" -and $method -ne "HEAD") {
            $status = "405 Method Not Allowed"
            $body = [System.Text.Encoding]::UTF8.GetBytes("method not allowed")
            $ctype = "text/plain"
        } elseif ($path.EndsWith("/__driver_status")) {
            # Is the controller's UPDATE-MODE driver in place?
            #
            # A web page cannot look at Windows drivers and cannot install one,
            # so it asks this server - which is running on the same PC, from
            # the same folder. Only ever reachable from 127.0.0.1.
            #
            # present : a board in update mode is plugged in right now
            # bound   : WinUSB is attached to it, so the browser can open it
            $st = [ordered]@{ platform = "windows"; present = $false; bound = $false; device = "" }
            try {
                $dev = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
                       Where-Object { $_.DeviceID -like "USB\VID_0483&PID_DF11*" } | Select-Object -First 1
                if ($dev) {
                    $st.present = $true
                    $st.device = "$($dev.Name)"
                    $st.bound = ($dev.Service -eq 'WINUSB')
                }
            } catch { }
            $body = [System.Text.Encoding]::UTF8.GetBytes(($st | ConvertTo-Json -Compress))
            $ctype = "application/json; charset=utf-8"
        } elseif ($path.EndsWith("/__install_driver")) {
            # Install it. The script self-elevates, so Windows shows ONE
            # approval prompt; it binds Windows' own signed WinUSB driver and
            # nothing is downloaded. Answers with the state afterwards, so the
            # page can simply try the controller again.
            $res = [ordered]@{ ok = $false; message = "" }
            try {
                $script = Join-Path $PSScriptRoot "install_dfu_driver.ps1"
                if (-not (Test-Path $script)) {
                    $res.message = "install_dfu_driver.ps1 is missing from tools\"
                } else {
                    # -Quiet: no "press ENTER to close" in that window, or this
                    # request would wait for a keypress nobody is there to give.
                    $null = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList @(
                        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$script`"",
                        "-NoElevate", "-Quiet")
                    Start-Sleep -Seconds 2
                    $dev = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
                           Where-Object { $_.DeviceID -like "USB\VID_0483&PID_DF11*" } | Select-Object -First 1
                    $res.ok = ($dev -and $dev.Service -eq 'WINUSB')
                    if ($res.ok) { $res.message = "driver installed" }
                    else {
                        # Windows 11 ships no INF that can be forced onto this
                        # device - its winusb.inf only matches boards that
                        # advertise a WinUSB compatible ID, which the STM32 ROM
                        # does not. The bundled driver tool carries its own
                        # signed package and can, so open it for them rather
                        # than leave them hunting for a file.
                        $zadig = Join-Path $root 'windows-driver\zadig.exe'
                        if (Test-Path $zadig) {
                            try {
                                Start-Process $zadig -Verb RunAs | Out-Null
                                $res.message = "opened the driver tool - choose 'DFU in FS Mode', pick WinUSB and press Install Driver"
                                $res.tool = $true
                            } catch { $res.message = "could not open the driver tool: " + $_.Exception.Message }
                        } else {
                            $res.message = "no driver tool in this folder (windows-driver\zadig.exe is missing)"
                        }
                    }
                }
            } catch { $res.message = $_.Exception.Message }
            $body = [System.Text.Encoding]::UTF8.GetBytes(($res | ConvertTo-Json -Compress))
            $ctype = "application/json; charset=utf-8"
        } elseif ($path.EndsWith("/__local_list")) {
            # Firmware discovery for "local folder" mode: list the *.bin files
            # in main_firmware\ (B1/B3/M*) and cloud_firmware\ (ESP32 files)
            # inside the uploader folder.
            function Get-BinList([string]$dir) {
                if (-not (Test-Path $dir)) { return @() }
                return @(Get-ChildItem -Path $dir -Filter *.bin -File -ErrorAction SilentlyContinue |
                    Sort-Object LastWriteTime -Descending |
                    ForEach-Object { [ordered]@{ name = $_.Name; size = [int64]$_.Length } })
            }
            $mainBins = Get-BinList (Join-Path $root "main_firmware")
            $cloudBins = Get-BinList (Join-Path $root "cloud_firmware")
            $json = [ordered]@{ main_firmware = $mainBins; cloud_firmware = $cloudBins } | ConvertTo-Json -Depth 5
            if ($null -eq $json) { $json = '{"main_firmware":[],"cloud_firmware":[]}' }
            $body = [System.Text.Encoding]::UTF8.GetBytes($json)
            $ctype = "application/json; charset=utf-8"
        } elseif ($path.StartsWith("/__fw/")) {
            # Firmware download proxy: the page asks THIS server, and this
            # server fetches from the company firmware repository. Two reasons:
            #  - no CORS setup is ever needed on the firmware server;
            #  - an access token (if the server needs one) stays here, in the
            #    PC's own folder, and never reaches the browser.
            # Configure with tools\set_firmware_source.ps1.
            $relFw = $path.Substring(6)
            $cfgPath = Join-Path $PSScriptRoot "firmware_source.json"
            if ($relFw -match '\.\.' -or $relFw -eq "") {
                $status = "400 Bad Request"
                $body = [System.Text.Encoding]::UTF8.GetBytes("bad firmware path")
                $ctype = "text/plain; charset=utf-8"
            } elseif (-not (Test-Path $cfgPath)) {
                $status = "502 Bad Gateway"
                $body = [System.Text.Encoding]::UTF8.GetBytes("no firmware source configured (run tools\set_firmware_source.ps1)")
                $ctype = "text/plain; charset=utf-8"
            } else {
                try {
                    $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
                    $base = [string]$cfg.baseUrl
                    if (-not $base.EndsWith("/")) { $base = $base + "/" }
                    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                    $req = [System.Net.HttpWebRequest]::Create($base + $relFw)
                    $req.Timeout = 60000
                    $req.ReadWriteTimeout = 120000
                    $req.UserAgent = "GATA-Uploader"
                    if ($cfg.token) { $req.Headers.Add("Authorization", "token " + $cfg.token) }
                    $resp = $req.GetResponse()
                    $ms = New-Object System.IO.MemoryStream
                    $resp.GetResponseStream().CopyTo($ms)
                    $resp.Close()
                    $body = $ms.ToArray()
                    $ext = [System.IO.Path]::GetExtension($relFw).ToLower()
                    if ($mime.ContainsKey($ext)) { $ctype = $mime[$ext] }
                    Write-Host ("  [firmware] {0} -> {1:N0} bytes" -f $relFw, $body.Length) -ForegroundColor DarkGray
                } catch {
                    $status = "502 Bad Gateway"
                    $msg = "firmware server unreachable or refused: " + $_.Exception.Message
                    $body = [System.Text.Encoding]::UTF8.GetBytes($msg)
                    $ctype = "text/plain; charset=utf-8"
                    Write-Host ("  [firmware] FAILED {0}: {1}" -f $relFw, $_.Exception.Message) -ForegroundColor Yellow
                }
            }
        } elseif (-not $fullResolved.StartsWith([System.IO.Path]::GetFullPath($root))) {
            $status = "403 Forbidden"
            $body = [System.Text.Encoding]::UTF8.GetBytes("forbidden")
            $ctype = "text/plain"
        } elseif (Test-Path $fullResolved -PathType Leaf) {
            $body = [System.IO.File]::ReadAllBytes($fullResolved)
            $ext = [System.IO.Path]::GetExtension($fullResolved).ToLower()
            if ($mime.ContainsKey($ext)) { $ctype = $mime[$ext] }
        } else {
            $status = "404 Not Found"
            $body = [System.Text.Encoding]::UTF8.GetBytes("not found: $path")
            $ctype = "text/plain"
        }

        # ---- reply ----
        $headers = "HTTP/1.1 $status`r`n" +
                   "Content-Type: $ctype`r`n" +
                   "Content-Length: $($body.Length)`r`n" +
                   "Cache-Control: no-cache`r`n" +
                   "Connection: close`r`n`r`n"
        $hb = [System.Text.Encoding]::ASCII.GetBytes($headers)
        $stream.Write($hb, 0, $hb.Length)
        if ($method -eq "GET") { $stream.Write($body, 0, $body.Length) }
        $stream.Flush()
    } catch {
        # ignore individual request errors (browser aborts etc.)
    } finally {
        $client.Close()
    }
}
