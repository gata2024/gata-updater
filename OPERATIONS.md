# GATA Updater — how to build and publish

Everything here is done on **this PC**, in **PowerShell**, from the folder

```
D:\emirates\saudi\makeLogicwork\gc22SramToflash\GATA_Cloud_Uploader\tools
```

Open it once and stay there:

```powershell
cd D:\emirates\saudi\makeLogicwork\gc22SramToflash\GATA_Cloud_Uploader\tools
```

Two files must be backed up and never shared — they are the company's identity:

| File | What it signs | If lost | If leaked |
|---|---|---|---|
| `tools\signing_key.json` | every firmware release | you cannot publish firmware again | someone else could sign firmware |
| `android\gata-release.keystore` | the Android app | customers must uninstall/reinstall the app | someone else could publish an app update |

---

## 1. The Windows program (.exe)

```powershell
.\build_exe.ps1
```

Produces **`GATA_Updater.exe`** in the updater folder (about 13 KB). It needs no
installer and no .NET download — it uses the compiler and runtime already inside
Windows.

**What to give a customer:** the whole `GATA_Cloud_Uploader` folder (or their ZIP
from section 4). They double-click `GATA_Updater.exe`; it serves the app locally
and opens the browser. A browser only allows USB access from `https://` or
`localhost`, which is why the program exists at all.

Once per PC, for a prompt-free USB connection:

```powershell
.\enable_auto_connect.ps1        # click Yes on the admin prompt, then restart the browser
```

---

## 2. The Android app (.apk)

```powershell
.\build_android_app.ps1                                  # the shared app
.\build_android_app.ps1 -Id ksp -Name "KSP"              # one customer's app
.\build_android_app.ps1 -Bundle                          # also .aab, for Google Play
```

Produces **`dist\gata-updater[-<customer>].apk`**, signed and installable. The
shared one is also published for download at
`https://gata2024.github.io/gata-updater/gata-updater.apk`.

The app is a thin shell around the hosted page: **app updates need no new APK** —
publishing the web app is enough. Rebuild the APK only when the name, icon,
package or start URL changes.

The script prints a Digital Asset Links entry. Paste it into
`https://github.com/gata2024/gata2024.github.io` → `.well-known/assetlinks.json`
so the app runs full screen (without it everything still works, but Chrome shows
an address bar).

---

## 3. Publishing controller software (per customer)

Customers each have their own **channel**: their app only ever sees their own
firmware, and this is enforced by the signature, not by convention.

| Channel id | Company | App link |
|---|---|---|
| `default` | General | https://gata2024.github.io/gata-updater/ |
| `ksp` | KSP | https://gata2024.github.io/gata-updater/c/ksp/ |
| `danway` | Danway | https://gata2024.github.io/gata-updater/c/danway/ |

### See who has what

```powershell
.\assign_firmware.ps1 -List
```

### Publish a new build for one customer

```powershell
# KSP gets a new controller build (leave -Version out: it is named for you)
.\publish_firmware.ps1 -Customer ksp -Main D:\build\NPC20_mini.bin

# also a new system firmware (only when the bootloader itself changed)
.\publish_firmware.ps1 -Customer ksp -Main D:\build\NPC20_mini.bin `
                       -System D:\build\Booster_phase.bin

# new cloud-module (ESP32) firmware as well
.\publish_firmware.ps1 -Customer danway -Main D:\build\NPC20_mini.bin `
                       -EspDir D:\emirates\saudi\makeLogicwork\gc22SramToflash\esp\.pio\build\esp32dev

# the shared/General channel: just leave -Customer out
.\publish_firmware.ps1 -Main D:\build\NPC20_mini.bin
```

**Version names are generated as `day_month_year_Customer`** — today that is
`18_08_26_KSP`, `18_08_26_Danway`, `18_08_26_General`. Pass `-Version` yourself
only if you want something different. The files are stored as
`controller_<version>.bin` and `system_<version>.bin`, so two customers can run
completely different controller software at the same time.

Where the firmware comes from:

| What | Built where | File to pass |
|---|---|---|
| Controller software | `g_500\Debug\` | `NPC20_mini.bin` |
| System firmware | `USBupdaterCode_relbuild\Debug\` | `Booster_phase.bin` |
| Cloud module (ESP32) | `esp\.pio\build\esp32dev\` | pass the folder to `-EspDir` |

### Give a customer a version that already exists

```powershell
.\assign_firmware.ps1 -Customer danway -Version 18_08_26_General   # copy it across
.\assign_firmware.ps1 -Customer danway -Version 18_08_26_Danway -Only   # and hide the rest
```

Nothing is copied on disk — the `.bin` files are stored once and shared, so ten
customers on three different versions still cost one copy of each file.

### Make it live

`publish_firmware.ps1` pushes the firmware repository itself. If it reports that
the push failed:

```powershell
git -C ..\firmware push
```

Customers see the new version the next time they open the app — nothing to
reinstall.

---

## 4. Adding a new customer — LICENSES (current way, from v2.7.0)

There is ONE app for everybody now (one link, one APK, one .exe). What a
customer receives is a **license key** — a signed token that tells the app
which firmware channel to serve. The app refuses to do anything until a
license is entered (once; it stays on the device).

```powershell
# 1. create their firmware channel (once) - seeds it from General:
.\new_customer.ps1 -Id acme-water -Name "ACME Water Systems"
cd ..\firmware; git push   # or let the next publish push it

# 2. issue their license (perpetual; add -Expires 2027-12-31 if wanted):
cd ..\tools
.\make_license.ps1 -Customer "ACME Water Systems" -Channel acme-water
```

Send the printed `GATA1.…` token to the customer — they paste it into the
License box on first start. Every issued license is recorded in
`tools\licenses_issued.txt`. Publishing their firmware stays the same:
`publish_firmware.ps1 -Customer acme-water …`.

**Secrets:** `tools\license_key.json` mints licenses — back it up together
with `tools\signing_key.json` and never commit either.

To take a customer's access away: stop publishing to their channel (their app
keeps whatever it already cached), or issue licenses with `-Expires` from the
start for time-limited access.

### Legacy per-customer app copies (before v2.7.0)

The old `c\<id>\` app copies and per-customer APKs keep working — a pinned
channel in their config acts as their license (grandfathered). New customers
should get the universal app + a license instead.

---

## 5. After changing the app itself

```powershell
.\rebuild_customers.ps1          # refresh every customer copy; add -Apk to rebuild their APKs
cd ..
git add -A; git commit -m "app: <what changed>"; git push github main
```

Bump `version:` in `js\config.js` first — it names the offline cache, and that is
what makes every installed copy pick up the change.

Run the self-tests before publishing: open `tests\tests.html` through the running
`GATA_Updater.exe` (`http://127.0.0.1:8765/tests/tests.html`). The page title must
read **PASS n/n**.

---

## 6. Where everything lives

```
GATA_Cloud_Uploader\
├── GATA_Updater.exe          the Windows program (built by tools\build_exe.ps1)
├── index.html, js\, css\     the app itself
├── c\<customer>\             each customer's copy of the app (generated)
├── firmware\                 the signed download channel (its own git repo)
│   ├── manifest.json         General channel
│   ├── customers\<id>\       one signed list per customer
│   └── controller_*.bin, system_*.bin, esp\*.bin
├── main_firmware\            offline copies used by "files in this folder"
├── android\                  the Android project + signing keystore (not in git)
├── dist\                     hand-off ZIPs and APKs (not in git)
└── tools\                    every script mentioned above
```

Repositories:

| Repo | Holds | Visibility |
|---|---|---|
| `github.com/gata2024/gata-updater` | the app | public (it is the web page) |
| `github.com/gata2024/gata-firmware` | firmware + signed lists | public, tamper-proof by signature |
| `github.com/gata2024/gata2024.github.io` | `.well-known/assetlinks.json` | public |
| `git.gatasys.com/Software/gata-updater` | mirror of the app | private (needs `git push origin main` re-login) |
