# GATA Cloud Uploader

Zero-install, production-ready firmware updater for the GATA controller.
It replaces the Python `USB_Uploder` tool with a single web app that:

* runs on **Windows / macOS / Linux** (Chrome or Edge) and on **Android phones
  over a USB-OTG cable** (Chrome) — no Python, nothing to install;
* downloads firmware **from the cloud** (a JSON manifest + files on any static
  HTTPS host), with SHA-256 verification and offline caching;
* performs the **exact same update sequence** as the old tool (details below),
  auto-detecting whether the board has an ESP32 — so the ESP-less board
  version works with the same app and the same package;
* has a **3-language UI** (English / العربية with full RTL / Türkçe),
  a guided 3-step wizard, live per-phase progress, an update history and a
  technical log (copy / save to file);
* is **safe by design**: every file is validated against the controller's own
  image rules before anything is flashed (a wrong file is rejected, not
  flashed), downloads are hash-checked, the screen is kept awake during
  flashing, closing the tab mid-update asks for confirmation, and Cancel
  aborts cleanly at any point;
* installs as an **app** (PWA): in Chrome choose *Install app* / *Add to Home
  screen*; it keeps working offline (cloud files come from the cache).

> **iPhone / iPad:** not possible — an Apple platform limit, not a bug. iOS
> browsers have no WebUSB/WebSerial and native iOS apps may only talk to
> MFi-certified accessories, so no app of any kind could flash this board
> from an iPhone. The page still opens on iOS for browsing versions, and the
> app explains this to the user. Use an Android phone or a PC.

---

## 1. Running it

### On a PC (no hosting needed) — one file
Double-click **`CLICK_ME_START_ON_PC.bat`**. It does everything:

1. **First run only**: sets up fully automatic USB connection in Chrome/Edge —
   a Windows admin prompt appears once, click **Yes**. (Click **No** and the
   updater still works; the browser just shows a one-time device picker. The
   setup is offered again on the next start.)
2. Starts a tiny local server (pure PowerShell, nothing installed) and opens
   the app. Keep the window open, use Chrome or Edge.

After the first-run setup + one full browser restart, an update is literally
one click: the running controller reboots itself into update mode and the
browser connects with no questions.

### Hosted (recommended — this is what phones use)
Copy this folder to any **HTTPS** static host. Easiest: a GitHub repository
with **GitHub Pages** enabled (a `.nojekyll` file is already included):

1. Create a repo, e.g. `gata-updater`, and push this folder's contents to it.
2. Repo → Settings → Pages → Source: *Deploy from a branch* → `main` / root.
3. Open `https://<user>.github.io/gata-updater/` on any PC or Android phone.

WebUSB/WebSerial require HTTPS (or localhost) — `file://` or plain `http://`
on a LAN will **not** work.

### On an Android phone — install it as a real app
1. Open the hosted URL in **Chrome** → menu **⋮ → Install app** (or the
   install banner). A real GATA icon (bundled PNG set) lands on the home
   screen; it opens fullscreen and keeps working offline.
2. Connect the controller with a **USB-OTG** adapter.
3. Follow the 3 steps on screen; allow USB access when Android asks.
4. The screen is kept awake automatically while flashing.

**Play Store later (optional):** wrap the hosted URL as a Trusted Web
Activity with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap):
`npx @bubblewrap/cli init --manifest https://<host>/app.webmanifest` then
`npx @bubblewrap/cli build`, upload the produced `.aab`, and serve the
generated `assetlinks.json` at `/.well-known/` on the host. A TWA runs real
Chrome, so WebUSB keeps working (a plain WebView wrapper would NOT — WebView
has no WebUSB; don't go that route).

### Windows only, once per PC
The DFU phase needs the WinUSB driver. Automatic install: board in BOOT mode →
run **`tools\INSTALL_DFU_DRIVER.bat`** (binds Windows' own signed WinUSB
driver, no downloads). Zadig in `windows-driver/` remains as fallback.
**Android (USB-OTG), macOS and Linux need no driver at all** — on Android both
the DFU phase and the serial phase run over WebUSB; the user just accepts the
USB permission dialog.

### How the zero-prompt USB works (background)
The first-run step of `CLICK_ME_START_ON_PC.bat` installs the Chrome/Edge
device policies `SerialAllowUsbDevicesForUrls` + `WebUsbAllowDevicesForUrls`
(machine-wide), pre-authorizing the controller's serial port (0483:5740) and
DFU device (0483:DF11) for the updater's origin — that is what removes the
picker, including for the DFU device whose permission Chrome otherwise forgets
on every unplug (it reports no serial number). The browser will show
"Managed by your organization"; that is this policy.
Undo: `tools\enable_auto_connect.ps1 -Remove`. Hosted copy on another origin:
`tools\enable_auto_connect.ps1 -Origins http://127.0.0.1:8765, https://<user>.github.io`.

---

## Lifecycle: factory once, customer forever

**Factory (per new board, one time):** ST-Link on the bench →
`tools\FACTORY_BURN.bat` — burns the resident bootloader + current
application, verifies both, and confirms the app is running (green LED).
Flash the ESP32 cloud module once via the updater's "Update cloud module"
button. The BOOT switch is never needed when provisioning via ST-Link.
(No ST-Link? BOOT switch high → plug USB → the updater provisions it over
DFU — the one time in the board's life the switch is used.)

**Customer (every update, forever):** the board always carries firmware, so
updates are fully automatic — open the updater page, click the update button,
done. The running firmware reboots itself into update mode (`enterBootloader`),
installs, verifies, and restarts instantly. First time on a new computer or
phone the browser asks one tap to pick the controller's port (a browser
security rule); that permission is remembered permanently. No BOOT switch, no
drivers (serial side), no Python, nothing to install.

## 2. Publishing a new firmware version (release process)

Use the helper — it copies the files, verifies they are the right *kind* of
image, computes SHA-256 and updates the manifest in one step:

```powershell
cd GATA_Cloud_Uploader\tools

# Typical release: new main app, reuse existing B1/B3 and ESP files
.\publish_firmware.ps1 -Version 15.5.0 -Main C:\build\M_15_5_0.bin -Notes "Pump curve fixes"

# Full release including new bootloaders and a fresh ESP32 build
.\publish_firmware.ps1 -Version 15.5.0 -Main M.bin -B1 B1.bin -B3 B3.bin `
                       -EspDir C:\esp\.pio\build\esp32dev -Notes "…"

# Release for boards without ESP32 files
.\publish_firmware.ps1 -Version 15.5.0 -Main M.bin -NoEsp
```

Then upload/push the `firmware/` folder to your host. Every user immediately
sees the new version — nothing to reinstall on their side.

Manual editing of `firmware/manifest.json` also works (newest version first),
**but you must re-sign afterwards** (run `tools\make_signing_key.ps1` — it
re-signs the current manifest). The manifest URL is configurable in the app
under **Settings** (a host on another domain must allow CORS; GitHub Pages and
GitHub Releases both work).

### Firmware authenticity — how nobody can feed boards a foreign program

The firmware list is **cryptographically signed** (ECDSA P-256):

* `tools\make_signing_key.ps1` (already run once) created the company keypair:
  the **private key** lives ONLY in `tools\signing_key.json` on this PC —
  `.gitignore` keeps it out of the repo. **Back this file up**; without it you
  cannot release, with it anyone can. Never upload or commit it.
* The **public key is pinned inside the app** (`js/config.js`), so it ships
  with every installed copy.
* On every load the app downloads `manifest.json` + `manifest.json.sig` and
  **hard-refuses the list** if the signature is missing or invalid — then
  every downloaded `.bin` is checked against the SHA-256 hashes inside that
  verified manifest, and images are additionally type-validated before flash.
* `publish_firmware.ps1` signs automatically on every release; the self tests
  verify the shipped manifest against the pinned key.
* Net effect: even an attacker with **full control of the web host** cannot
  make the app flash foreign firmware — they would need the private key file
  from your PC. (They could at most serve an *older* signed list; the app
  logs a SECURITY rollback warning when the list gets older.)

### Uploading to the server (GitHub Pages, step by step)

One time:
1. On GitHub create an empty repository, e.g. `gata-updater`.
2. In this folder:
   `git init && git add -A && git commit -m "GATA Cloud Uploader"`
   `git remote add origin https://github.com/<you>/gata-updater.git && git push -u origin main`
   (`.gitignore` already excludes the private key.)
3. Repo → Settings → Pages → *Deploy from a branch* → `main` / root.
4. Your app is live at `https://<you>.github.io/gata-updater/` — open it once
   on each customer device. For zero-picker PCs also run
   `tools\enable_auto_connect.ps1 -Origins https://<you>.github.io`.
   Note: Pages files are public (tamper-proof via the signature, but readable).
   Any other HTTPS static host works identically if you prefer private.

Each release:
1. `tools\publish_firmware.ps1 -Version ... -Main ...`  (validates, hashes, signs)
2. `git add firmware && git commit -m "fw <version>" && git push`
3. Done — every user sees the new version on their next load.

### Local folder mode (no internet, like the original USB_Uploder)

Instead of the cloud list, press **“Use the files in the uploader folder”**.
The app finds the firmware by itself — no file picking — in two folders inside
the uploader:

```
GATA_Cloud_Uploader\
├── main_firmware\          B1.bin, B3.bin, M*.bin   (controller files)
└── cloud_firmware\         bootloader.bin, partitions.bin,
                            boot_app0.bin, firmware.bin   (ESP32 files)
```

Drop new files in, press **Scan again**, done. Several `M*.bin` files show up
as a choice. Discovery uses the local server's listing endpoint (start via
`CLICK_ME_START_ON_PC.bat`); on a plain static host the standard fixed names
are probed instead.

---

## 3. The three update actions

| Button | What it flashes | What it keeps |
|---|---|---|
| **Update controller** | System firmware (B1/B3) + controller software (M) | ESP32 untouched. ESP files are not even downloaded. |
| **Update cloud module (ESP32)** | System firmware (B1/B3) + ESP32 firmware only | Controller software is **kept** (no erase). After the ESP32 upload the controller restarts by itself and returns to the existing software after its normal ~15 s check. |
| **Update controller + cloud** | Everything | — |

**Missed-window recovery (important for first-time use):** after the DFU phase
the bootloader waits only 15 seconds before starting any existing software.
On the very first run on a browser, the one-time serial-port permission picker
can make you miss that window. The app detects this, asks you to put the
controller back in BOOT mode, and automatically redoes the system-firmware
phase with the **alternate** B file (which guarantees the window reopens).
From the second run on, the port is remembered and everything is automatic.

## What each phase does (mirrors `dfu_programmer.py`)

| Phase | Transport | What happens |
|---|---|---|
| 1. System firmware | WebUSB → DFU (`0483:DF11`) | Erases the 128 KB internal-flash sector and writes `B1.bin` **or** `B3.bin` at `0x08000000`, then "leave" → reboot. The two builds carry different version numbers; the bootloader only opens its update window when the flashed version differs from the one stored in the RTC backup register, so the app **alternates** them (ping-pong, stored per browser like `.last_bootloader.txt`). |
| 2. Connect | Web Serial / WebUSB-CDC (`0483:5740`) | Waits for the "STM32 Bootloader" serial port and completes the `INFO` handshake. |
| 3. Erase | serial | `FORMAT` — full external-flash erase, sent **immediately** so the bootloader's 15-second window can never time out mid-update. |
| 4. ESP32 | serial | `ESP_DETECT`; if an ESP32 answers **and** the package contains ESP files, they are merged into one image (bootloader@0x1000, partitions@0x8000, boot_app0@0xE000, firmware@0x10000) and flashed via `ESP_WRITE`. Boards without an ESP32 are skipped automatically. The controller restarts itself afterwards and the app reconnects. |
| 5. Application | serial | `WRITE:<size>` + paced data stream to external flash `0x90000000`, then `VERIFY`. |
| 6. Finish | serial | `JUMP` — controller reboots, validates the new app for ~15 s, stores the version and starts it (sky-blue LED). If the LED does not appear, press RESET once. |

**Advanced** panel: app-only / ESP-only / system-only updates, skip-system
mode (device already in update mode), manual B1/B3 switch, update history.

**Demo mode** (Settings) simulates a device — for trying the app, training
users, and automated UI testing. A toggle selects whether the simulated board
has an ESP32.

---

## 4. Quality / maintenance

* **Self tests**: open `tests/tests.html` (via the local server or the hosted
  site). It checks the DFU memory-map parser, the ESP32 image builder byte
  offsets, all file validators, the B1/B3 ping-pong, manifest validation,
  translation completeness and the serial protocol client against the
  simulated bootloader. The page title reports `PASS n/n`.
* **Versioning**: bump `APP_CONFIG.version` in [js/config.js](js/config.js)
  on every deploy — it names the offline cache, so clients pick up the new
  build on their next online load.
* **Security**: strict CSP (`default-src 'self'`), no external scripts/fonts,
  no build step, no dependencies. Firmware authenticity = HTTPS + SHA-256
  hashes in the manifest you publish.
* **Logs for support**: the Technical log panel has Copy / **Save** (downloads
  a `.txt`) — ask users to attach it when reporting a failed update.

## 5. Folder map

```
index.html, css/, js/        the app (plain HTML/JS, no build step, no CDN)
  js/config.js               product constants + app version (bump on deploy)
  js/i18n.js                 EN / AR (RTL) / TR user-interface strings
  js/validate.js             image-type guards (blocks flashing wrong files)
  js/dfuse.js                DfuSe/DFU client over WebUSB   (replaces dfu-util)
  js/transport.js            Web Serial + WebUSB CDC-ACM transports
  js/gata.js                 bootloader text protocol (INFO/FORMAT/WRITE/…/ESP_*)
  js/esp.js                  4-file → combined ESP32 image (same as Python tool)
  js/cloud.js                manifest + downloads + SHA-256 + offline cache
  js/flows.js                update sequences, wake-lock, history, cancel
  js/mock.js                 demo-mode simulated device
firmware/                    deploy-ready cloud folder (manifest.json + bins)
tests/                       self-test page (logic + protocol, no hardware)
tools/serve.ps1              local server for CLICK_ME_START_ON_PC.bat
tools/publish_firmware.ps1   one-command firmware release helper
windows-driver/              Zadig + instructions (Windows DFU phase only)
docs/                        screenshots
```

The original `USB_Uploder/` and `USBupdaterCode/` folders are untouched; the
bootloader firmware on the board needs **no changes** to work with this app.
