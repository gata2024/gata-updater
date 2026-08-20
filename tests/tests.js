/* GATA Cloud Uploader - self tests (pure logic, no hardware needed).
 * Open tests/tests.html - the title/summary reports PASS/FAIL counts.
 */
"use strict";

const T = {
  results: [],
  out: document.getElementById("out"),

  check(name, cond, detail) {
    this.results.push({ name, ok: !!cond });
    const div = document.createElement("div");
    div.className = cond ? "pass" : "fail";
    div.textContent = (cond ? "PASS  " : "FAIL  ") + name + (cond || detail == null ? "" : "  -> " + detail);
    this.out.appendChild(div);
  },

  async run() {
    /* ------------------------------------------------- DfuSe memory map */
    let m = DfuSeDevice.parseMemoryMap("@Internal Flash  /0x08000000/01*128Kg");
    this.check("dfuse: H750 single-sector map",
      m && m.length === 1 && m[0].start === 0x08000000 && m[0].sectorSize === 131072 && m[0].count === 1,
      JSON.stringify(m));

    m = DfuSeDevice.parseMemoryMap("@Internal Flash/0x08000000/04*032Kg,01*128Kg,07*256Kg");
    this.check("dfuse: multi-segment map",
      m && m.length === 3 && m[1].start === 0x08020000 && m[2].sectorSize === 262144,
      JSON.stringify(m));

    this.check("dfuse: garbage map -> null", DfuSeDevice.parseMemoryMap("nonsense") === null);

    /* ------------------------------------------------- ESP32 combined image */
    const mk = (len, fill) => new Uint8Array(len).fill(fill);
    const files = { bootloader: mk(100, 1), partitions: mk(32, 2), boot_app0: mk(16, 3), firmware: mk(50, 4) };
    const img = Esp32.buildCombinedImage(files);
    this.check("esp: image length = firmware offset + firmware size",
      img.length === (0x10000 - 0x1000) + 50, "len=" + img.length);
    this.check("esp: bootloader at 0x0000", img[0] === 1 && img[99] === 1);
    this.check("esp: padding is 0xFF", img[100] === 0xFF && img[0x6FFF] === 0xFF);
    this.check("esp: partitions at 0x7000", img[0x7000] === 2 && img[0x7000 + 31] === 2);
    this.check("esp: boot_app0 at 0xD000", img[0xD000] === 3);
    this.check("esp: firmware at 0xF000", img[0xF000] === 4 && img[0xF000 + 49] === 4);
    this.check("esp: hasCompleteSet true", Esp32.hasCompleteSet(files) === true);
    this.check("esp: hasCompleteSet false when missing",
      Esp32.hasCompleteSet({ firmware: files.firmware }) === false);

    /* ------------------------------------------------- image validation */
    const word = (arr, off, v) => { new DataView(arr.buffer).setUint32(off, v, true); };
    const app = new Uint8Array(64);
    word(app, 0, 0x24080000); word(app, 4, 0x90000135);
    this.check("validate: good app accepted", Validate.isValidApp(app) === true);
    const badApp = new Uint8Array(64);
    word(badApp, 0, 0x24080000); word(badApp, 4, 0x08000135);
    this.check("validate: internal-flash image rejected as app", Validate.isValidApp(badApp) === false);

    const boot = new Uint8Array(64);
    word(boot, 0, 0x20020000); word(boot, 4, 0x08000299);
    this.check("validate: good system firmware accepted", Validate.isValidSystem(boot) === true);
    this.check("validate: app rejected as system firmware", Validate.isValidSystem(app) === false);
    const bigBoot = new Uint8Array(APP_CONFIG.systemFlashMax + 1);
    word(bigBoot, 0, 0x20020000); word(bigBoot, 4, 0x08000299);
    this.check("validate: oversized system firmware rejected", Validate.isValidSystem(bigBoot) === false);

    const espImg = new Uint8Array(32); espImg[0] = 0xE9;
    this.check("validate: ESP image magic 0xE9", Validate.isValidEspImage(espImg) === true);
    this.check("validate: non-ESP rejected", Validate.isValidEspImage(app) === false);
    const parts = new Uint8Array(64); parts[0] = 0xAA; parts[1] = 0x50;
    this.check("validate: ESP partition table magic", Validate.isValidEspPartitions(parts) === true);

    /* ------------------------------------------------- ping-pong */
    const saved = localStorage.getItem("gata.lastBootloader");
    localStorage.removeItem("gata.lastBootloader");
    this.check("no ping-pong left: alternating system firmware is gone",
      typeof PingPong === "undefined");
    if (saved === null) localStorage.removeItem("gata.lastBootloader");
    else localStorage.setItem("gata.lastBootloader", saved);

    /* ------------------------------------------------- manifest validation */
    const goodManifest = {
      versions: [{ version: "1", controller: { url: "controller_1.bin" }, system: { url: "system_1.bin" } }]
    };
    let threw = false;
    try { Cloud.validateManifest(goodManifest); } catch (e) { threw = true; }
    this.check("manifest: valid accepted", !threw);
    threw = false;
    try { Cloud.validateManifest({ versions: [] }); } catch (e) { threw = true; }
    this.check("manifest: empty rejected", threw);
    threw = false;
    try { Cloud.validateManifest({ versions: [{ version: "1", controller: { url: "c.bin" } }] }); }
    catch (e) { threw = true; }
    this.check("manifest: missing system firmware rejected", threw);
    threw = false;
    try {
      Cloud.validateManifest({ versions: [{ version: "1", main: { url: "M_1.bin" },
                                            bootloaders: { b1: { url: "B1.bin" }, b3: { url: "B3.bin" } } }] });
    } catch (e) { threw = true; }
    this.check("manifest: releases published under the old names still load", !threw);

    /* ------------------------------------------------- board filtering */
    {
      const vs = [
        { version: "old" },                          // legacy: no board field
        { version: "five", board: "rev5" },
        { version: "six", board: "rev6" },
        { version: "uni", board: "all" },
      ];
      const names = (list) => list.map(v => v.version).join(",");
      this.check("board: rev5 list = legacy + rev5 + unified",
        names(Cloud.forBoard(vs, "rev5")) === "old,five,uni");
      this.check("board: rev6 list = rev6 + unified only (old binaries never offered)",
        names(Cloud.forBoard(vs, "rev6")) === "six,uni");
      const src = await (await fetch("../js/flows.js", { cache: "no-store" })).text();
      this.check("board: the rev 6 ESP gate keys off the INSTALLED firmware (BL >= 1.0.9 lifts it)",
        /espPossible = \(bl\.blVersion \|\| 0\) >= 0x00010009/.test(src) &&
        /\(bl\.boardRev \|\| ctx\.board\) !== "rev6"/.test(src) &&
        /d\.espRev6/.test(src) && /err\.espRev6/.test(src));
      const gsrc = await (await fetch("../js/gata.js", { cache: "no-store" })).text();
      this.check("board: the handshake parses the BOARD:revN line from INFO",
        /BOARD:\(rev\\d\+\)/.test(gsrc) && /this\.boardRev/.test(gsrc));
    }

    /* ------------------------------------------------- licenses */
    {
      const b64u = b => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const pair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const pubJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
      const mk = async (payload) => {
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        const sig = new Uint8Array(await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" }, pair.privateKey, bytes));
        return "GATA1." + b64u(bytes) + "." + b64u(sig);
      };
      const saved = APP_CONFIG.licensePublicKey;
      APP_CONFIG.licensePublicKey = { kty: pubJwk.kty, crv: pubJwk.crv, x: pubJwk.x, y: pubJwk.y };
      try {
        const good = await mk({ customer: "KSP", channel: "ksp", issued: "2026-08-20", exp: null, id: "T-1" });
        const p = await License.verify(good);
        this.check("license: a signed token verifies and carries its channel",
          p.customer === "KSP" && p.channel === "ksp");
        let bad = null;
        try { await License.verify(good.slice(0, -4) + "AAAA"); } catch (e) { bad = e; }
        this.check("license: a tampered token is refused", !!bad);
        let exp = null;
        try { await License.verify(await mk({ customer: "X", channel: "x", exp: "2020-01-01", id: "T-2" })); }
        catch (e) { exp = e; }
        this.check("license: an expired token is refused", !!exp && /2020-01-01/.test(exp.message));
        let junk = null;
        try { await License.verify("not-a-license"); } catch (e) { junk = e; }
        this.check("license: garbage input is refused politely", !!junk);
      } finally {
        APP_CONFIG.licensePublicKey = saved;
      }
      this.check("license: channel routing derives the customer's manifest URL",
        Cloud.channelize("https://x/main/manifest.json", "ksp") === "https://x/main/customers/ksp/manifest.json" &&
        Cloud.channelize("firmware/manifest.json", "danway") === "firmware/customers/danway/manifest.json" &&
        Cloud.channelize("firmware/manifest.json", "default") === "firmware/manifest.json");
      const asrc = await (await fetch("../js/app.js", { cache: "no-store" })).text();
      this.check("license: updates and the firmware list are gated on a license",
        /requireLicense\(\)/.test(asrc) && /License\.loadStored\(\)/.test(asrc) &&
        /if \(!License\.licensed\(\)\)/.test(asrc));
      const swsrc = await (await fetch("../sw.js", { cache: "no-store" })).text();
      this.check("license: license.js is part of the offline app shell", /js\/license\.js/.test(swsrc));

      /* license FILE delivery: bundled with the uploader + openable in the UI */
      const lsrc = await (await fetch("../js/license.js", { cache: "no-store" })).text();
      this.check("license-file: the app auto-loads a bundled gata.license and still VERIFIES it",
        /BUNDLED_FILE:\s*"gata\.license"/.test(lsrc) && /loadBundled/.test(lsrc) &&
        /verify\(text\)/.test(lsrc));
      const hsrc = await (await fetch("../index.html", { cache: "no-store" })).text();
      this.check("license-file: the UI offers 'Open license file' (no pasted codes)",
        /id="licFile"/.test(hsrc) && /btnLicOpen/.test(hsrc) && !/licInput/.test(hsrc));
      this.check("license-file: the FOLDER's license wins over one remembered from another folder",
        /MANUAL_KEY/.test(lsrc) && /const manual = localStorage\.getItem\(this\.MANUAL_KEY\)/.test(lsrc) &&
        /if \(!manual\)/.test(lsrc));
      const bundled = await (await fetch("../gata.license", { cache: "no-store" })).text();
      const bp = await License.verify(bundled.trim());
      this.check("license-file: the license bundled with THIS uploader verifies against the pinned key",
        bp.channel === "default" && bp.customer === "General");

      /* package licenses (software bound to a channel by a signed .lic) */
      APP_CONFIG.licensePublicKey = { kty: pubJwk.kty, crv: pubJwk.crv, x: pubJwk.x, y: pubJwk.y };
      try {
        const pkgTok = await mk({ t: "pkg", version: "1_1_26_X_rev5", channel: "ksp",
                                  board: "rev5", controller: "aabbcc", issued: "2026-08-20" });
        const pp = await License.verifyPackage(pkgTok);
        this.check("pkg-license: a signed package token verifies",
          pp.version === "1_1_26_X_rev5" && pp.channel === "ksp" && pp.controller === "aabbcc");
        let cross1 = null;
        try { await License.verify(pkgTok); } catch (e) { cross1 = e; }
        this.check("pkg-license: a package token is NOT accepted as a customer license", !!cross1);
        let cross2 = null;
        const custTok = await mk({ customer: "KSP", channel: "ksp", id: "T-9" });
        try { await License.verifyPackage(custTok); } catch (e) { cross2 = e; }
        this.check("pkg-license: a customer license is NOT accepted as a package license", !!cross2);
      } finally {
        APP_CONFIG.licensePublicKey = saved;
      }
      const csrc = await (await fetch("../js/cloud.js", { cache: "no-store" })).text();
      this.check("pkg-license: downloads verify the package license and bind version+channel+hash",
        /ver\.license && ver\.license\.url/.test(csrc) &&
        /verifyPackage/.test(csrc) && /lic\.version === ver\.version/.test(csrc) &&
        /activeChannel\(\)/.test(csrc));
      const psrc = await (await fetch("../tools/publish_firmware.ps1", { cache: "no-store" })).text();
      this.check("pkg-license: every publish attaches a signed .lic",
        /licenses\//.test(psrc) && /t\s+=\s+'pkg'/.test(psrc) && /license_key\.json/.test(psrc));
    }

    /* ------------------------- boards WITHOUT a cloud module (no ESP files) */
    {
      /* A release published with the ESP32 unticked has no esp entry at all.
       * Downloading it must succeed for a normal update and only fail when
       * the ESP is the whole point (the "update cloud module" action). */
      const verNoEsp = { version: "noesp", controller: { url: "c.bin" }, system: { url: "s.bin" } };
      let threwOptional = null, threwRequired = null;
      const fakeManifest = { _baseUrl: new URL("http://127.0.0.1/x/manifest.json") };
      const origDownload = Cloud.download;
      Cloud.download = async () => new Uint8Array([1, 2, 3]);
      try {
        const pkg = await Cloud.downloadPackage(fakeManifest, verNoEsp, null,
                                                { controller: true, system: true, esp: "optional" });
        this.check("no-esp: a normal update downloads fine and simply has no ESP files",
          pkg.controller !== null && pkg.esp === null);
      } catch (e) { threwOptional = e; this.check("no-esp: a normal update downloads fine", false, e.message); }
      try {
        await Cloud.downloadPackage(fakeManifest, verNoEsp, null,
                                    { controller: false, system: true, esp: "required" });
      } catch (e) { threwRequired = e; }
      Cloud.download = origDownload;
      this.check("no-esp: 'update cloud module' on such a release is refused with a clear message",
        !!threwRequired);

      this.check("no-esp: validation only demands ESP files when they are the point",
        (() => {
          try { Validate.checkPackage({ controller: null, system: null, esp: null },
                                      { controller: false, system: false, esp: false }); return true; }
          catch (e) { return false; }
        })());

      const fsrc = await (await fetch("../js/flows.js", { cache: "no-store" })).text();
      this.check("no-esp: the update skips the cloud-module step entirely (no pointless probe)",
        /mode === "both" && !ctx\.pkg\.esp/.test(fsrc) && /d\.espNotIncluded/.test(fsrc));
      const rmsrc = await (await fetch("../tools/ReleaseManager.cs", { cache: "no-store" })).text();
      this.check("no-esp: unticking the cloud module publishes with -NoEsp (never reuses old ESP files)",
        /else a\.Append\(" -NoEsp"\)/.test(rmsrc));
    }

    /* --------------------------------- firmware fingerprints (.bin identity) */
    {
      const bin = new Uint8Array([1, 2, 3, 4, 5]);
      const good = await Util.sha256Hex(bin);
      const receipt = { files: { "main_firmware/controller_x.bin": good } };
      let okHash = await LocalSource._verify(bin, "main_firmware/controller_x.bin", receipt);
      this.check("fingerprint: the delivered .bin is accepted", okHash === good);

      let refused = null;
      const swapped = new Uint8Array([9, 9, 9, 9, 9]);
      try { await LocalSource._verify(swapped, "main_firmware/controller_x.bin", receipt); }
      catch (e) { refused = e; }
      this.check("fingerprint: a SWAPPED .bin is refused and the refusal is fatal",
        !!refused && refused.fatal === true);

      let noReceipt = await LocalSource._verify(bin, "main_firmware/controller_x.bin", null);
      this.check("fingerprint: a folder without a receipt still works (hash reported, not enforced)",
        noReceipt === good);

      const lsrc2 = await (await fetch("../js/localsource.js", { cache: "no-store" })).text();
      this.check("fingerprint: every local .bin is verified before it can be installed",
        (lsrc2.match(/await this\._verify\(/g) || []).length >= 3 &&
        /firmware_receipt\.json/.test(lsrc2));
    }

    /* ------------------------------------------------- manifest signing */
    {
      const pair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const pubJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
      const payload = new TextEncoder().encode('{"versions":[{"version":"t"}]}');
      const sig = new Uint8Array(await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" }, pair.privateKey, payload));
      this.check("signing: valid signature accepted",
        await Cloud.verifySignedBytes(payload, sig, pubJwk) === true);
      const tampered = payload.slice(); tampered[3] ^= 0xFF;
      this.check("signing: tampered content rejected",
        await Cloud.verifySignedBytes(tampered, sig, pubJwk) === false);
      if (APP_CONFIG.signingPublicKey) {
        let liveOk = false, liveNote = "";
        try {
          const mRes = await fetch("../firmware/manifest.json", { cache: "no-store" });
          const sRes = await fetch("../firmware/manifest.json.sig", { cache: "no-store" });
          if (mRes.ok && sRes.ok) {
            const mBytes = new Uint8Array(await mRes.arrayBuffer());
            const sBytes = Uint8Array.from(atob((await sRes.text()).trim()), c => c.charCodeAt(0));
            liveOk = await Cloud.verifySignedBytes(mBytes, sBytes, APP_CONFIG.signingPublicKey);
          } else liveNote = "manifest/sig fetch failed";
        } catch (e) { liveNote = e.message; }
        this.check("signing: shipped manifest verifies against the pinned key", liveOk, liveNote);
      }
    }

    /* ------------------------------------------------- PWA install assets */
    {
      let pwaOk = false, pwaNote = "";
      try {
        const wm = await (await fetch("../app.webmanifest", { cache: "no-store" })).json();
        const pngs = (wm.icons || []).filter(i => i.type === "image/png");
        pwaOk = pngs.length >= 3;
        for (const i of pngs) {
          const r = await fetch("../" + i.src, { cache: "no-store" });
          if (!r.ok) { pwaOk = false; pwaNote = i.src + " missing"; break; }
        }
      } catch (e) { pwaNote = e.message; }
      this.check("pwa: webmanifest lists PNG icons and all exist", pwaOk, pwaNote);
    }

    /* ------------------------ every mode validates what it downloads */
    {
      // "update cloud module" downloads NO controller image on purpose; the
      // validator must not demand one (this broke that mode once).
      const app = new Uint8Array(64);
      new DataView(app.buffer).setUint32(0, 0x24080000, true);
      new DataView(app.buffer).setUint32(4, 0x90000135, true);
      const sys = new Uint8Array(64);
      new DataView(sys.buffer).setUint32(0, 0x20020000, true);
      new DataView(sys.buffer).setUint32(4, 0x08000299, true);
      const espImg = () => { const a = new Uint8Array(64); a[0] = 0xE9; return a; };
      const espSet = { bootloader: espImg(),
                       partitions: (() => { const a = new Uint8Array(64); a[0] = 0xAA; a[1] = 0x50; return a; })(),
                       boot_app0: new Uint8Array(64),
                       firmware: espImg() };
      const modes = {
        controller: { pkg: { controller: app, system: sys, esp: null },
                      needs: { controller: true, system: true, esp: false } },
        cloud:      { pkg: { controller: null, system: sys, esp: espSet },
                      needs: { controller: false, system: true, esp: true } },
        both:       { pkg: { controller: app, system: sys, esp: espSet },
                      needs: { controller: true, system: true, esp: true } },
      };
      for (const [name, m] of Object.entries(modes)) {
        let threw = null;
        try { Validate.checkPackage(m.pkg, m.needs); } catch (e) { threw = e.message; }
        this.check("package: '" + name + "' mode validates its own files", threw === null, threw);
      }
      let unknownRejected = false;
      try { Validate.checkPackage(modes.both.pkg, { main: true }); }
      catch (e) { unknownRejected = /unknown package requirement/.test(e.message); }
      this.check("package: a renamed/misspelt requirement fails loudly", unknownRejected);
    }

    /* --------------------------- the connect gesture must be a real tap */
    {
      /* Chrome refuses requestDevice() from pointerdown/touchstart ("Must be
       * handling a user gesture"); only a COMPLETED tap counts. */
      const src = await (await fetch("../js/app.js", { cache: "no-store" })).text();
      const gate = src.slice(src.indexOf("userGate(title"), src.indexOf("preConnect()"));
      this.check("gate: connects from a button click, never from pointerdown",
        /btn\.onclick\s*=\s*run\(action\)/.test(gate) &&
        /btnAlt\.onclick\s*=\s*alt \? run\(alt\.action\)/.test(gate) &&
        !/addEventListener\("pointerdown"/.test(gate));
    }

    /* --------------------------------- the connect gate: labels + text */
    {
      const src = await (await fetch("../js/app.js", { cache: "no-store" })).text();
      const gate = src.slice(src.indexOf("userGate(title"), src.indexOf("preConnect()"));
      this.check("gate: no paragraph above the buttons",
        /gateText"\)\.textContent\s*=\s*""/.test(gate));
      this.check("gate: offers 'older firmware running' and 'in update mode' when there is a choice",
        /btn\.connectRunning/.test(gate) && /btn\.connectUpdateMode/.test(gate));
      this.check("gate: a single neutral button when there is no choice",
        /btn\.connect"\)/.test(gate) && /btnAlt\.classList\.toggle\("hidden", !alt\)/.test(gate));
    }

    /* ------------------------------------- gate buttons stay answerable */
    {
      /* A disabled button does not fire its handler, so a device chooser that
       * never opened left every further tap doing NOTHING and saying nothing.
       * The connect buttons must never be disabled while asking. */
      const src = await (await fetch("../js/app.js", { cache: "no-store" })).text();
      const gate = src.slice(src.indexOf("userGate(title"), src.indexOf("showResult(ok"));
      this.check("gate: connect buttons are never disabled while asking",
        !/btn\.disabled\s*=\s*true/.test(gate) && !/btnAlt\.disabled\s*=\s*true/.test(gate));
      this.check("gate: a repeated tap is answered instead of ignored",
        /Still waiting for the device list/.test(gate));
    }

    /* --------------------------------------------- gate wiring (app.js) */
    {
      // The flow passes 5 arguments to ui.userGate: title, text, action, the
      // SECOND choice, and the auto-detect poll. A wrapper that forwards only
      // the first three silently removes the second button and the automatic
      // continuation - which is exactly what shipped in 1.7.0.
      let ok = false, note = "";
      try {
        const src = await (await fetch("../js/app.js", { cache: "no-store" })).text();
        const m = src.match(/userGate:\s*\(([^)]*)\)\s*=>\s*this\.userGate\(([^)]*)\)/);
        if (!m) note = "userGate wrapper not found in app.js";
        else {
          const params = m[1].split(",").map(s => s.trim()).filter(Boolean);
          const args = m[2].split(",").map(s => s.trim()).filter(Boolean);
          ok = params.length >= 5 && args.length >= 5;
          note = "params=" + params.length + " args=" + args.length;
        }
      } catch (e) { note = e.message; }
      this.check("gate: ui.userGate forwards alt button + auto-detect poll", ok, note);
    }

    /* ------------------------------------------------- customer channel */
    {
      const orig = APP_CONFIG.channel;
      try {
        APP_CONFIG.channel = "acme";
        let threw = false;
        try { Cloud._requireOwnChannel({ channel: "acme" }, "t"); } catch (e) { threw = true; }
        this.check("channel: this customer's own list accepted", !threw);

        threw = false; let fatal = false;
        try { Cloud._requireOwnChannel({ channel: "other-co" }, "t"); }
        catch (e) { threw = true; fatal = !!e.fatal; }
        this.check("channel: another customer's list refused, and fatally", threw && fatal);

        APP_CONFIG.channel = "default";
        threw = false;
        try { Cloud._requireOwnChannel({}, "t"); } catch (e) { threw = true; }
        this.check("channel: list without a channel accepted by the shared app", !threw);
      } finally { APP_CONFIG.channel = orig; }
    }

    /* ------------------------------------------------- transport choice */
    {
      const orig = Transport.isAndroid;
      try {
        Transport.isAndroid = () => true;
        this.check("transport: Android prefers WebUSB (Web Serial there is Bluetooth-only)",
          !navigator.usb || Transport.preferred() === "webusb-cdc");
        Transport.isAndroid = () => false;
        this.check("transport: desktop prefers Web Serial",
          !navigator.serial || Transport.preferred() === "serial");
      } finally { Transport.isAndroid = orig; }
    }

    /* ------------------------------------------------- i18n completeness */
    const missing = I18N.missingKeys();
    this.check("i18n: AR + TR cover every EN key", missing.length === 0, missing.join(", "));

    /* ------------------------------------------------- local folder scan */
    const lm = LocalSource.matchNames(
      ["system_18_8_27.bin", "controller_18_8_27.bin", "M_16_0_0.bin", "notes.bin"],
      ["bootloader.bin", "partitions.bin", "boot_app0.bin", "firmware.bin"]);
    this.check("local: finds the system firmware", lm.system === "system_18_8_27.bin");
    this.check("local: controller files listed, system not among them",
      lm.mains.length === 2 && !lm.mains.some(n => /^system/i.test(n)));
    const lmOld = LocalSource.matchNames(["B1.bin", "b3.BIN", "M_15_4_26.bin"], []);
    this.check("local: old B1/M names still recognised",
      lmOld.system === "B1.bin" && lmOld.mains.length === 1);
    this.check("local: collects controller files, ignores everything else",
      lm.mains.includes("controller_18_8_27.bin") && lm.mains.includes("M_16_0_0.bin") &&
      !lm.mains.includes("notes.bin"));
    this.check("local: complete ESP32 set matched",
      lm.esp.bootloader === "bootloader.bin" && lm.esp.firmware === "firmware.bin" &&
      lm.esp.partitions === "partitions.bin" && lm.esp.boot_app0 === "boot_app0.bin");
    const lm2 = LocalSource.matchNames(["M1.bin"], []);
    this.check("local: missing files reported as null",
      lm2.system === null && lm2.esp.firmware === null && lm2.mains.length === 1);

    /* Live scan against the local server's listing endpoint (when present). */
    try {
      LocalSource.BASE = "../";                 // tests page lives in tests/
      const found = await LocalSource.scan();
      this.check("local: live scan finds system + controller in main_firmware",
        !!found.system && found.mains.length >= 1,
        JSON.stringify({ system: found.system, mains: found.mains.map(m => m.name) }));
      this.check("local: live scan finds complete cloud_firmware set", found.espComplete === true);
    } catch (e) {
      this.check("local: live scan", false, e.message);
    }

    /* ------------------------------------------------- protocol client */
    // Fake transport: we control what the "device" says and when.
    const fake = {
      cb: null, sent: [],
      onData(cb) { this.cb = cb; },
      async write(bytes) { this.sent.push(bytes); },
      async open() {}, async close() {},
    };
    const bl = new GataBootloader(fake);
    const enc = s => new TextEncoder().encode(s);

    const p1 = bl.waitFor(["VERIFY_OK"], 2000, ["VERIFY_FAILED"]);
    fake.cb(enc("VERIFY"));           // split across chunks on purpose
    fake.cb(enc("_OK\r\nOK\r\n"));
    let r1 = await p1;
    this.check("gata: waitFor matches across chunk boundary", r1.keyword === "VERIFY_OK");

    bl.clear();
    const p2 = bl.waitFor(["COMPLETE"], 2000, ["WRITE_ERROR"]).then(() => "ok", e => "err:" + e.message);
    fake.cb(enc("WRITE_ERROR\r\n"));
    const r2 = await p2;
    this.check("gata: bad keyword rejects", r2.startsWith("err:"), r2);

    bl.clear();
    bl.shouldAbort = () => true;
    const r3 = await bl.waitFor(["X"], 2000).then(() => "ok", e => e.message);
    this.check("gata: cancellation interrupts waitFor", r3 === I18N.t("err.cancelled"), r3);
    bl.shouldAbort = null;

    /* ------------------------------------------ enterBootloader command */
    const fakeApp = {
      cb: null, sent: [],
      onData(cb) { this.cb = cb; },
      async write(b) { this.sent.push(new TextDecoder().decode(b)); },
      async open() {}, async close() {},
    };
    const blApp = new GataBootloader(fakeApp);
    const pAck = blApp.enterBootloaderViaApp();
    await Util.sleep(60);
    // Must match the HMI wire format the firmware parser accepts:
    // value*?identifier*?len*firstV*firstI*  with len = value.len + id.len
    this.check("app-cmd: exact frame bytes",
      fakeApp.sent[0] === "8321*?enterBootloader*?19*8*e*\r\n", JSON.stringify(fakeApp.sent[0]));
    fakeApp.cb(new TextEncoder().encode("|#1*?enterBootloaderAck*?19*1*e*#|"));
    this.check("app-cmd: ack resolves true", (await pAck) === true);

    /* ------------------------------------------------- mock end-to-end */
    const mt = new MockTransport({ hasEsp: false });
    const bl2 = new GataBootloader(mt);
    await mt.open();
    await bl2.handshake();
    this.check("mock: handshake against simulated bootloader", true);
    const hasEsp = await bl2.espDetect();
    this.check("mock: ESP detect returns false on no-ESP board", hasEsp === false);
    const appBytes = new Uint8Array(3000).fill(7);
    let progressed = 0;
    await bl2.writeApp(appBytes, f => { progressed = f; });
    this.check("mock: writeApp completes with progress", progressed === 1);
    await bl2.verify();
    this.check("mock: verify OK", true);

    /* ------------------------------------------------- first-install wipe */
    this.check("wipe: handshake read BL 1.0.10 + board from the mock",
      bl2.blVersion === 0x0001000A && bl2.boardRev === "rev5",
      "blVersion=0x" + bl2.blVersion.toString(16) + " boardRev=" + bl2.boardRev);
    let ticked = false;
    await bl2.formatData(() => { ticked = true; });
    this.check("wipe: FORMAT_DATA completes against the mock (with heartbeat)", ticked);
    {
      const fsrc = await (await fetch("../js/flows.js", { cache: "no-store" })).text();
      this.check("wipe: flow gates FORMAT_DATA on system firmware 1.0.10 and runs it AFTER the app-flash erase",
        /ctx\.firstInstall/.test(fsrc) && /0x0001000A/.test(fsrc) && /d\.wipeOld/.test(fsrc) &&
        fsrc.indexOf("await bl.format(") < fsrc.indexOf("await bl.formatData("));
      const html = await (await fetch("../index.html", { cache: "no-store" })).text();
      this.check("wipe: first-install checkbox exists and is separate from the BOOT-mode gate",
        /chkFirstInstall/.test(html) && /data-step="wipe"/.test(html));
    }

    /* ------------------------------------------------- summary */
    const pass = this.results.filter(r => r.ok).length;
    const fail = this.results.length - pass;
    const sum = document.getElementById("summary");
    sum.textContent = pass + " passed, " + fail + " failed, " + this.results.length + " total";
    sum.style.color = fail ? "#f85149" : "#56d364";
    document.title = (fail ? "FAIL " : "PASS ") + pass + "/" + this.results.length;
    window.__results = { pass, fail, total: this.results.length };
  }
};

T.run().catch(e => {
  document.getElementById("summary").textContent = "SUITE CRASHED: " + e.message;
  document.getElementById("summary").style.color = "#f85149";
  document.title = "FAIL crash";
  window.__results = { pass: 0, fail: 999, total: 0, crash: e.message + "\n" + e.stack };
});
