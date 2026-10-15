# Windows DFU driver (one-time setup per PC)

## Automatic way (preferred — no Zadig)

1. Board in BOOT mode (BOOT switch high + reset), USB plugged in.
2. Run **`..\tools\INSTALL_DFU_DRIVER.bat`** → click **Yes** on the admin
   prompt. It binds Windows' own Microsoft-signed generic WinUSB driver
   (`winusbcompat.inf`) to the DFU device via SetupAPI — nothing downloaded,
   nothing third-party, usually no reboot.

The Zadig procedure below is the FALLBACK for the rare Windows build without
`winusbcompat.inf`.

## Manual way (fallback)

**Only needed on Windows, only once per computer, and only for the first phase
(system firmware over DFU).** Android phones and macOS/Linux computers do NOT
need any driver.

Windows attaches its own driver to the STM32 "DFU in FS Mode" device, which
blocks browser (WebUSB) access. Zadig replaces it with WinUSB — the same step
the old Python uploader required.

## Steps

1. Put the controller in update mode: hold **BOOT**, press+release **RESET**, release **BOOT**.
2. Run `zadig.exe` (in this folder) **as administrator**.
3. Menu **Options → List All Devices**.
4. In the dropdown pick **“DFU in FS Mode”** (USB ID **0483 DF11**).
5. Make sure the target driver (right of the green arrow) says **WinUSB**.
6. Click **Install Driver** / **Replace Driver** and wait for success.
7. Close Zadig. Done — the web updater can now access the device.

The serial-port phase of the update uses Windows' built-in `usbser` driver and
needs no setup.

---
Zadig is © Pete Batard / Akeo, GPL v3 — see `ZADIG_LICENSE.txt`. It is
included unmodified, for convenience, exactly like in the original USB_Uploder
package.
