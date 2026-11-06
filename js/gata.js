/* GATA Cloud Uploader - client for the GATA CDC bootloader text protocol.
 *
 * Faithful port of USB_Uploder/dfu_programmer.py phases 3+4, talking to
 * USBupdaterCode/USB_DEVICE/App/usbd_cdc_if.c:
 *
 *   INFO                      -> "MCU:STM32H750VBT6\r\nEXTERNAL_FLASH:16MB@0x90000000\r\nOK\r\n"
 *   FORMAT                    -> mass-erase external flash -> "FORMAT_COMPLETE\r\nOK\r\n"
 *   WRITE:<size>              -> "READY_FOR_DATA:<size>\r\nOK\r\n", then raw bytes,
 *                                "PROGRESS:<n>/<total>" every 4 KB, "COMPLETE\r\nOK\r\n"
 *   VERIFY                    -> "VERIFY_OK\r\nOK\r\n"
 *   JUMP                      -> "JUMPING_TO_APP" + device reset
 *   ESP_DETECT                -> "ESP32_FOUND" | "ESP32_NOT_FOUND"
 *   ESP_WRITE:0x<addr>:<size> -> "ESP_INIT_STARTED" ... "ESP_READY_FOR_DATA" ... "ESP_COMPLETE"
 *   ESP_RESET                 -> "ESP_RESET_OK"
 */
"use strict";

class GataBootloader {
  constructor(transport) {
    this.t = transport;
    this._buf = "";
    this._decoder = new TextDecoder("utf-8", { fatal: false });
    this._encoder = new TextEncoder();
    this.onDeviceLine = null;      // optional UI hook for raw device output
    this.shouldAbort = null;       // optional () => bool, set by the flow for cancellation
    transport.onData(chunk => this._feed(chunk));
  }

  _feed(chunk) {
    const text = this._decoder.decode(chunk, { stream: true });
    this._buf += text;
    if (this._buf.length > 20000) this._buf = this._buf.slice(-10000);
    if (this.onDeviceLine) {
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) this.onDeviceLine(line.trim());
      }
    }
  }

  clear() { this._buf = ""; }

  _abortCheck() {
    if (this.shouldAbort && this.shouldAbort()) {
      throw new UploaderError(I18N.t("err.cancelled"));
    }
  }

  /* Wait until the accumulated response contains any of `goodKeywords`.
   * Rejects early on `badKeywords` or when the flow was cancelled. */
  async waitFor(goodKeywords, timeoutMs, badKeywords) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      this._abortCheck();
      for (const k of goodKeywords) {
        if (this._buf.includes(k)) return { keyword: k, text: this._buf };
      }
      for (const k of (badKeywords || [])) {
        if (this._buf.includes(k)) {
          throw new UploaderError("Device reported: " + k, this._hintFor(k));
        }
      }
      if (Date.now() > deadline) {
        throw new UploaderError(
          "Timeout waiting for " + goodKeywords.join(" / ") +
          (this._buf.trim() ? " (device said: " + this._buf.trim().slice(-160) + ")" : " (no response)"),
          this._hintFor("TIMEOUT"));
      }
      await Util.sleep(40);
    }
  }

  _hintFor(k) {
    // Errors where re-entering BOOT mode is the fix vs. plain "try again".
    if (k === "UNKNOWN_COMMAND" || k === "TIMEOUT") return I18N.t("hint.boot");
    return I18N.t("hint.retry");
  }

  async send(cmd) {
    /* The command itself is protocol traffic, not news for the person using
     * the updater - it goes to the trace, which is off unless switched on. */
    Util.dev("> " + cmd);
    await this.t.write(this._encoder.encode(cmd + "\n"));
  }

  async sendRaw(bytes) { await this.t.write(bytes); }

  /* ------------------------------------------------------------- commands */

  /* Wake + identify. The Python tool sends INFO twice: once to flush the
   * bootloader out of any stale state, once for the real check. */
  async handshake() {
    this.clear();
    await this.send("INFO");
    await Util.sleep(350);
    this.clear();
    await this.send("INFO");
    // Strict match: the running APPLICATION streams HMI frames on this same
    // port, and a loose "MCU" substring could false-match inside them.
    const r = await this.waitFor(["MCU:STM32"], 3000, ["UNKNOWN_COMMAND"]);
    /* System firmware from 1.0.8 on reports itself, and shuts the cloud-module
     * probe down by itself when no module answers - so the host no longer has
     * to reboot the controller to make the upload safe. Older ones say
     * nothing and keep the old handling. */
    const m = /BL:(\d+)\.(\d+)\.(\d+)/.exec(r.text);
    this.blVersion = m ? (Number(m[1]) * 65536 + Number(m[2]) * 256 + Number(m[3])) : 0;
    /* From 1.0.9 the update firmware also probes the main-board revision
     * (PB12/PB13 short test) and reports it - "rev5" or "rev6". Older
     * firmware says nothing -> null, the user's board choice stands. */
    const b = /BOARD:(rev\d+)/.exec(r.text);
    this.boardRev = b ? b[1] : null;
    /* 1.0.17+: the system firmware can flash the expansion board (EXP_*). */
    this.expSupported = /EXP:1/.test(r.text);
    Util.ok("GATA controller answered - ready for the update." +
            (m ? " (system firmware " + m[1] + "." + m[2] + "." + m[3] +
                 (b ? ", " + b[1] + " board" : "") + ")" : ""));
    return r.text;
  }

  /* Full external-flash erase. W25Q128 mass erase typically 40 s, up to 2 min. */
  async format(onTick) {
    this.clear();
    await this.send("FORMAT");
    const start = Date.now();
    const timer = onTick ? setInterval(() => onTick((Date.now() - start) / 1000), 1000) : null;
    try {
      await this.waitFor(["FORMAT_COMPLETE", "OK"], 150000,
        ["FORMAT_ERROR", "QSPI_INIT_ERROR", "QSPI_MMAP_ERROR"]);
    } finally {
      if (timer) clearInterval(timer);
    }
    Util.ok("External flash erased (" + Math.round((Date.now() - start) / 1000) + " s).");
  }

  /* Stream the main application into external flash at 0x90000000.
   * opts.chunk / opts.pace exist for the gentle retry after a stall: writing
   * in smaller pieces with longer gaps gives the flash chip time to finish a
   * slow page write instead of NAKing until the host gives up. */
  async writeApp(bytes, onProgress, opts) {
    const o = Object.assign({ chunk: 1024, pace: 8, stallMs: 8000 }, opts || {});
    this.clear();
    await this.send("WRITE:" + bytes.length);
    await this.waitFor(["READY_FOR_DATA"], 4000, ["QSPI_INIT_ERROR", "UNKNOWN_COMMAND"]);
    this.clear();

    const chunk = o.chunk;
    for (let off = 0; off < bytes.length; off += chunk) {
      this._abortCheck();
      // Stall watchdog: a frozen bootloader NAKs forever and write() then
      // never resolves - fail loudly instead of hanging the update at N%.
      const wrote = await Promise.race([
        this.sendRaw(bytes.subarray(off, Math.min(off + chunk, bytes.length))).then(() => true),
        Util.sleep(o.stallMs).then(() => false),
      ]);
      if (!wrote) {
        const e = new UploaderError(
          "The controller stopped accepting data at " +
          Math.round((off / bytes.length) * 100) + "% (frozen bootloader).",
          I18N.t("hint.retry"));
        e.stalledAt = off;                       // lets the flow retry gently
        throw e;
      }
      if (onProgress) onProgress(Math.min(off + chunk, bytes.length) / bytes.length);
      // The device writes each 256-byte page inside the USB interrupt and NAKs
      // while busy; this small pause mirrors the Python tool's pacing.
      await Util.sleep(o.pace);
      if (this._buf.includes("WRITE_ERROR") || this._buf.includes("QSPI_MMAP_ERROR")) {
        throw new UploaderError("Device reported a write error during upload.", I18N.t("hint.retry"));
      }
    }

    await this.waitFor(["COMPLETE", "OK"], 15000,
      ["WRITE_ERROR", "FLASH_VERIFY_ERROR", "QSPI_MMAP_ERROR"]);
    Util.ok("Application streamed to external flash (" + Util.fmtBytes(bytes.length) + ").");
  }

  async verify() {
    this.clear();
    await this.send("VERIFY");
    await this.waitFor(["VERIFY_OK"], 6000, ["VERIFY_FAILED"]);
    Util.ok("Application verified.");
  }

  /* First-installation preparation of the settings & logs memory (the second
   * external flash): full chip erase + littlefs format, done by the update
   * firmware (1.0.10+). The erase alone runs 1-7 minutes; the device sends
   * DATA_ERASE:<seconds> heartbeats we surface through onTick. */
  async formatData(onTick) {
    this.clear();
    await this.send("FORMAT_DATA");
    await this.waitFor(["DATA_FORMAT_STARTED"], 4000, ["UNKNOWN_COMMAND"]);
    const start = Date.now();
    const timer = onTick ? setInterval(() => onTick((Date.now() - start) / 1000), 1000) : null;
    try {
      await this.waitFor(["DATA_FORMAT_COMPLETE"], 480000,
        ["DATA_FORMAT_ERROR:NO_CHIP", "DATA_FORMAT_ERROR:ERASE_TIMEOUT", "DATA_FORMAT_ERROR:FS"]);
    } finally {
      if (timer) clearInterval(timer);
    }
    Util.ok("Settings & logs memory prepared (" +
            Math.round((Date.now() - start) / 1000) + " s).");
  }

  /* Restart the device into the application.
   * New resident bootloaders (>= 0x00010005) restore the version register and
   * reset SILENTLY - the app starts in ~3 s and the only signal is the USB
   * disconnect. Old bootloaders answer JUMPING_TO_APP first; their transmit
   * spin-waits in the USB interrupt, so a settle pause is load-bearing: it
   * lets the VERIFY_OK transfer finish, or the old firmware hangs forever. */
  async jump() {
    await Util.sleep(500);
    this.clear();
    /* The controller resets the instant it reads JUMP, so the USB device can
     * disappear while this very transfer is in flight. On WebUSB (phones) that
     * surfaces as a transfer error - which is SUCCESS here, not a failure, and
     * must never abort an update that has already been verified. */
    try {
      await this.send("JUMP");
    } catch (e) {
      Util.info("Controller disconnected as it restarted (expected).");
    }
    await Util.sleep(800);   // give the reset a moment; the watcher confirms the app
    Util.ok("Restart command sent - the controller is rebooting.");
  }

  /* -------------------------------------------------- running-application */

  /* When the CONTROLLER APPLICATION (not the bootloader) owns this port,
   * ask it to reboot into the resident bootloader's update window. Frame
   * format = the HMI protocol (value*?identifier*?len*firstV*firstI*), the
   * command is guarded by the key 8321 in firmware (uart1_task.c). Returns
   * true when the app acknowledged (it resets itself ~300 ms later). */
  async enterBootloaderViaApp() {
    this.clear();
    const frame = "8321*?enterBootloader*?19*8*e*\r\n";
    Util.dev("> [app] enterBootloader (reboot into update mode)");
    await this.t.write(this._encoder.encode(frame));
    try {
      await this.waitFor(["enterBootloaderAck"], 2500);
      Util.ok("Controller acknowledged - it is rebooting into update mode.");
      return true;
    } catch (e) {
      if (e.message === I18N.t("err.cancelled")) throw e;
      return false;   // old firmware without the command, or not the app
    }
  }

  /* ---------------------------------------------------------------- ESP32 */

  async espDetect(quick) {
    if (!quick) {
      // Match the Python tool: poke INFO first so the CDC path is proven alive.
      this.clear();
      await this.send("INFO");
      await Util.sleep(800);
    }
    this.clear();
    await this.send("ESP_DETECT");
    try {
      const r = await this.waitFor(["ESP32_FOUND", "ESP32_NOT_FOUND"], 12000);
      return r.keyword === "ESP32_FOUND";
    } catch (e) {
      if (e.message === I18N.t("err.cancelled")) throw e;
      Util.warn("No answer to ESP_DETECT - treating as 'no ESP32 on this board'.");
      return false;
    }
  }

  /* Upload one image into the ESP32 flash through the STM32 (UART pass-through). */
  async espWrite(flashAddress, bytes, onProgress, onPhase) {
    this.clear();
    await this.send("ESP_WRITE:0x" + flashAddress.toString(16).toUpperCase() + ":" + bytes.length);
    await this.waitFor(["ESP_INIT_STARTED"], 4000, ["UNKNOWN_COMMAND"]);
    if (onPhase) onPhase(I18N.t("d.espErase"));
    await this.waitFor(["ESP_READY_FOR_DATA"], 45000,
      ["ESP_SYNC_ERROR", "ESP_SPI_ATTACH_ERROR", "ESP_FLASH_BEGIN_ERROR"]);
    await Util.sleep(600);   // grace period: bootloader re-arms USB reception
    this.clear();

    const chunk = 1024;
    for (let off = 0; off < bytes.length; off += chunk) {
      this._abortCheck();
      // Longer stall allowance here: the device legitimately NAKs ~200 ms per
      // 1 KB block while it forwards data to the ESP32.
      const wrote = await Promise.race([
        this.sendRaw(bytes.subarray(off, Math.min(off + chunk, bytes.length))).then(() => true),
        Util.sleep(20000).then(() => false),
      ]);
      if (!wrote) {
        throw new UploaderError(
          "The controller stopped accepting ESP32 data at " +
          Math.round((off / bytes.length) * 100) + "%.",
          I18N.t("hint.retry"));
      }
      if (onProgress) onProgress(Math.min(off + chunk, bytes.length) / bytes.length);
      await Util.sleep(10);  // same pacing as the Python tool (device NAKs during block sends)
      if (this._buf.includes("ESP_FLASH_ERROR")) {
        throw new UploaderError("ESP32 flash error during upload.", I18N.t("hint.retry"));
      }
    }

    await this.waitFor(["ESP_COMPLETE"], 40000, ["ESP_FLASH_ERROR"]);
    Util.ok("ESP32 image uploaded (" + Util.fmtBytes(bytes.length) + ").");
    // NOTE: after ESP_COMPLETE the STM32 restarts itself; the port will drop.
  }

  async espReset() {
    this.clear();
    await this.send("ESP_RESET");
    try { await this.waitFor(["ESP_RESET_OK"], 4000); } catch (e) { /* device may reset */ }
    Util.ok("ESP32 restarted with its new firmware.");
  }

  /* ------------------------------------------------------ expansion board */
  /* System firmware 1.0.17+ flashes the expansion board's STM32 through the
   * main board (I2C cable, ST ROM bootloader). The cable can be noisy, so the
   * image is checked at every hop:
   *   - here -> controller: every 128-byte piece carries its offset + CRC32
   *     and is answered EXP_ACK / EXP_NAK; a NAK or a missing answer resends
   *     it (up to 10 times); the whole image's CRC32 is checked at EXP_END;
   *   - controller -> expansion: every 256-byte block is read back and
   *     compared, a bad pass is erased and redone (3 attempts, slower bus each
   *     time), and the finished flash is read back whole - its CRC32 must
   *     equal the image's.
   * Interrupting it is harmless: the ST ROM bootloader cannot be erased, the
   * update can always be repeated. */

  /* -> { found: bool, reason } ; reason "NO_BOARD" = no expansion fitted. */
  async expDetect() {
    this.clear();
    await this.send("EXP_DETECT");
    try {
      const r = await this.waitFor(["EXP_FOUND", "EXP_NOT_FOUND", "UNKNOWN_COMMAND"], 15000);
      if (r.keyword === "EXP_FOUND") return { found: true, reason: "" };
      if (r.keyword === "UNKNOWN_COMMAND") return { found: false, reason: "OLD_SYSTEM" };
      const m = /EXP_NOT_FOUND:([A-Z_0-9]+)/.exec(r.text);
      return { found: false, reason: m ? m[1] : "UNKNOWN" };
    } catch (e) {
      if (e.message === I18N.t("err.cancelled")) throw e;
      return { found: false, reason: "NO_ANSWER" };
    }
  }

  /* Wait for one exact line (regex on whole lines of the buffer). */
  async _waitLine(re, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      this._abortCheck();
      /* only COMPLETE lines: a half-arrived "EXP_ACK:8" must not pass for
       * the answer to offset 8 when "EXP_ACK:80" is on its way */
      const lines = this._buf.split(/\r?\n/).slice(0, -1);
      for (const l of lines) {
        const m = re.exec(l.trim());
        if (m) return m;
      }
      if (Date.now() > deadline) return null;
      await Util.sleep(5);
    }
  }

  async expWrite(bytes, onProgress, onPhase) {
    const crc = Crc32.of(bytes);
    const hex8 = v => (v >>> 0).toString(16).toUpperCase().padStart(8, "0");
    Util.info("Expansion image: " + Util.fmtBytes(bytes.length) + ", CRC32 " + hex8(crc) +
              (Validate.expansionBuild(bytes) ? ", " + Validate.expansionBuild(bytes) : ""));

    this.clear();
    await this.send("EXP_BEGIN:" + bytes.length + ":" + hex8(crc));
    await this.waitFor(["EXP_BEGIN_OK"], 4000, ["EXP_ERROR", "EXP_BUSY", "UNKNOWN_COMMAND"]);

    /* ---- transfer: one piece at a time, each acknowledged */
    const CH = 128;
    let off = 0, resent = 0;
    while (off < bytes.length) {
      this._abortCheck();
      const n = Math.min(CH, bytes.length - off);
      const piece = bytes.subarray(off, off + n);
      let hex = "";
      for (let i = 0; i < n; i++) hex += (piece[i] < 16 ? "0" : "") + piece[i].toString(16);
      const offHex = off.toString(16).toUpperCase();
      const line = "EXP_DATA:" + offHex + ":" + hex.toUpperCase() + ":" + hex8(Crc32.of(piece));
      let acked = false;
      for (let attempt = 0; attempt < 10 && !acked; attempt++) {
        this.clear();
        await this.send(line);
        const m = await this._waitLine(new RegExp("^EXP_(ACK|NAK):" + offHex + "(?::([A-Z]+)(?::([0-9A-F]+))?)?$"), 1500);
        if (m && m[1] === "ACK") { acked = true; break; }
        resent++;
        if (m && m[2] === "ORDER" && m[3]) {
          /* the controller holds a different next offset - follow it */
          const want = parseInt(m[3], 16);
          Util.warn("Expansion transfer: controller expects offset " + want + " - resuming there.");
          off = want;
          acked = null;
          break;
        }
        Util.warn("Expansion piece at " + off + (m ? " refused (" + (m[2] || "?") + ")" : " not acknowledged") +
                  " - sending it again.");
        if (m && m[2] === "STATE") {
          throw new UploaderError("The controller lost the expansion transfer.", I18N.t("hint.retry"));
        }
      }
      if (acked === null) continue;
      if (!acked) {
        throw new UploaderError("The expansion image could not be transferred at " +
          Math.round((off / bytes.length) * 100) + "% (no acknowledgement after 10 tries).", I18N.t("hint.retry"));
      }
      off += n;
      if (onProgress) onProgress(0.3 * off / bytes.length);
    }
    if (resent) Util.info("Expansion transfer: " + resent + " piece(s) were sent again.");

    /* ---- whole-image check, then the controller flashes the expansion */
    this.clear();
    await this.send("EXP_END");
    await this.waitFor(["EXP_END_OK"], 4000, ["EXP_ERROR:INCOMPLETE"]);
    await this.waitFor(["EXP_IMAGE_OK"], 10000, ["EXP_IMAGE_BAD"]);
    Util.ok("Expansion image received complete by the controller (CRC32 " + hex8(crc) + " matches).");

    /* Progress lines keep coming; the only long silence is the sector erase
     * (up to ~30 s), so 90 s without any line means the controller is stuck. */
    let seen = 0;
    let lastAct = Date.now();
    for (;;) {
      this._abortCheck();
      const text = this._buf;
      if (text.length !== seen) { seen = text.length; lastAct = Date.now(); }
      const err = /EXP_ERROR:([A-Z_]+)/.exec(text);
      if (err) {
        throw new UploaderError("The expansion board could not be programmed (" + err[1] + ").",
          I18N.t("hint.expRetry"));
      }
      const done = /EXP_COMPLETE:RUNNING:(\d)/.exec(text);
      if (done) {
        if (done[1] === "1") Util.ok("Expansion board programmed, verified and running.");
        else Util.warn("Expansion board programmed and verified, but it did not report running yet.");
        if (onProgress) onProgress(1);
        return done[1] === "1";
      }
      const lines = text.split(/\r?\n/);
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i].trim();
        let m;
        if ((m = /^EXP_PROGRESS:WRITE:(\d+)\/(\d+)/.exec(l))) {
          if (onProgress) onProgress(0.35 + 0.45 * Number(m[1]) / Math.max(1, Number(m[2])));
          break;
        }
        if ((m = /^EXP_PROGRESS:VERIFY:(\d+)\/(\d+)/.exec(l))) {
          if (onPhase) onPhase(I18N.t("d.expVerify"));
          if (onProgress) onProgress(0.8 + 0.2 * Number(m[1]) / Math.max(1, Number(m[2])));
          break;
        }
        if (l === "EXP_PROGRESS:ERASE") { if (onPhase) onPhase(I18N.t("d.expErase")); break; }
        if ((m = /^EXP_RETRY:(\d+):([A-Z_]+)/.exec(l))) {
          if (onPhase) onPhase(I18N.t("d.expRetry", { n: Number(m[1]) + 1 }));
          break;
        }
      }
      if (Date.now() - lastAct > 90000) {
        throw new UploaderError("The controller stopped reporting while programming the expansion board.",
          I18N.t("hint.expRetry"));
      }
      await Util.sleep(100);
    }
  }
}

/* CRC-32 (IEEE 802.3, the same as zip / the system firmware's crc32Upd). */
const Crc32 = {
  _t: null,
  of(bytes) {
    if (!this._t) {
      this._t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        this._t[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = this._t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
};
