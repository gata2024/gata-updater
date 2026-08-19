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
    Util.info("> " + cmd);
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
    Util.info("> [app] enterBootloader (reboot into update mode)");
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
}
