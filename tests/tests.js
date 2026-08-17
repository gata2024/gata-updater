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
    const first = PingPong.next();
    PingPong.commit(first);
    const second = PingPong.next();
    PingPong.commit(second);
    const third = PingPong.next();
    this.check("pingpong: B1 -> B3 -> B1", first === "B1" && second === "B3" && third === "B1",
      first + "," + second + "," + third);
    if (saved === null) localStorage.removeItem("gata.lastBootloader");
    else localStorage.setItem("gata.lastBootloader", saved);

    /* ------------------------------------------------- manifest validation */
    const goodManifest = {
      versions: [{ version: "1", main: { url: "m.bin" }, bootloaders: { b1: { url: "a" }, b3: { url: "b" } } }]
    };
    let threw = false;
    try { Cloud.validateManifest(goodManifest); } catch (e) { threw = true; }
    this.check("manifest: valid accepted", !threw);
    threw = false;
    try { Cloud.validateManifest({ versions: [] }); } catch (e) { threw = true; }
    this.check("manifest: empty rejected", threw);
    threw = false;
    try { Cloud.validateManifest({ versions: [{ version: "1", main: { url: "m" }, bootloaders: { b1: { url: "a" } } }] }); }
    catch (e) { threw = true; }
    this.check("manifest: missing b3 rejected", threw);

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
      ["B1.bin", "b3.BIN", "M_15_4_26.bin", "M_16_0_0.bin", "notes.bin"],
      ["bootloader.bin", "partitions.bin", "boot_app0.bin", "firmware.bin"]);
    this.check("local: finds B1/B3 case-insensitively", lm.b1 === "B1.bin" && lm.b3 === "b3.BIN");
    this.check("local: collects all M*.bin, ignores others",
      lm.mains.length === 2 && lm.mains.includes("M_15_4_26.bin") && !lm.mains.includes("notes.bin"));
    this.check("local: complete ESP32 set matched",
      lm.esp.bootloader === "bootloader.bin" && lm.esp.firmware === "firmware.bin" &&
      lm.esp.partitions === "partitions.bin" && lm.esp.boot_app0 === "boot_app0.bin");
    const lm2 = LocalSource.matchNames(["M1.bin"], []);
    this.check("local: missing files reported as null",
      lm2.b1 === null && lm2.esp.firmware === null && lm2.mains.length === 1);

    /* Live scan against the local server's listing endpoint (when present). */
    try {
      LocalSource.BASE = "../";                 // tests page lives in tests/
      const found = await LocalSource.scan();
      this.check("local: live scan finds B1+B3+M in main_firmware",
        !!found.b1 && !!found.b3 && found.mains.length >= 1,
        JSON.stringify({ b1: found.b1, b3: found.b3, mains: found.mains.map(m => m.name) }));
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
