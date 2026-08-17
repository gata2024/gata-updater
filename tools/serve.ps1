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

$listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), $port
try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "ERROR: port $port is already in use." -ForegroundColor Red
    Write-Host "Maybe the updater is already running - check your browser: $prefix"
    Start-Process $prefix
    Read-Host "Press ENTER to close"
    exit 1
}

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  GATA Firmware Updater - local server running" -ForegroundColor Cyan
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
