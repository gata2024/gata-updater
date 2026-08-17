/* GATA Cloud Uploader - update flows (the equivalent of dfu_programmer.py's main()).
 *
 * Three user-facing modes, all built on the same phases:
 *   "controller" - DFU system firmware + controller application (ESP32 untouched)
 *   "cloud"      - DFU system firmware + ESP32 firmware only (application kept:
 *                  no FORMAT is sent, so after the ESP upload the controller's
 *                  own 15-second revalidation boots the existing app again)
 *   "both"       - everything (system + ESP32 + application)
 *
 * The 15-second update window: after DFU the bootloader waits 15 s and, if a
 * valid app exists, boots it. First-ever runs can lose that race (the browser
 * shows a one-time port-permission picker). _establishUpdateMode() therefore
 * retries the whole DFU+connect cycle - with the ALTERNATE B file, so the
 * version-mismatch window is guaranteed to reopen - after asking the user to
 * re-enter BOOT mode. In "controller"/"both" mode FORMAT is sent immediately
 * after connecting, which closes the window for good.
 */
"use strict";

const Flows = {
  cancelRequested: false,
  running: false,
  _wakeLock: null,

  cancel() { this.cancelRequested = true; },
  _ck() {
    if (this.cancelRequested) throw new UploaderError(I18N.t("err.cancelled"));
  },

  /* ------------------------------------------------ screen wake lock ----- */
  /* Phones must not sleep mid-flash: a suspended tab stops the USB transfer. */
  async _acquireWakeLock() {
    try {
      if (navigator.wakeLock && !this._wakeLock) {
        this._wakeLock = await navigator.wakeLock.request("screen");
        this._wakeLock.addEventListener("release", () => { this._wakeLock = null; });
        Util.info("Screen wake-lock acquired (device will not sleep during the update).");
      }
    } catch (e) { Util.warn("No wake-lock (" + e.message + ") - keep the screen on manually."); }
  },
  async _releaseWakeLock() {
    try { if (this._wakeLock) { await this._wakeLock.release(); this._wakeLock = null; } }
    catch (e) { /* ignore */ }
  },
  installWakeLockKeeper() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.running) this._acquireWakeLock();
    });
  },

  /* ------------------------------------------------ update history ------- */
  history() {
    try { return JSON.parse(localStorage.getItem("gata.history") || "[]"); }
    catch (e) { return []; }
  },
  _record(actionKey, ok, seconds, version) {
    try {
      const list = this.history();
      list.unshift({
        date: new Date().toISOString(), action: actionKey,
        ok: !!ok, seconds: Math.round(seconds), version: version || "",
      });
      localStorage.setItem("gata.history", JSON.stringify(list.slice(0, APP_CONFIG.historyMax)));
    } catch (e) { /* history is best-effort */ }
  },

  /* --------------------------------------------------------------- helpers */

  /* close() can hang on a just-unplugged Windows COM port - never wait
   * more than 2 s for it. */
  async _safeClose(t) {
    try { await Promise.race([t.close(), Util.sleep(2000)]); } catch (e) { /* ignore */ }
  },

  /* After JUMP: poll the authorized port until the APPLICATION's HMI stream
   * ("value*?identifier*?...") appears - the proof the controller restarted
   * and runs the new software. Returns true/false, never throws. */
  async _waitForApp(ctx, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    await Util.sleep(3000);
    while (Date.now() < deadline) {
      if (this.cancelRequested) return false;
      let t = null;
      try {
        // JUMP's reset re-samples the BOOT pin: with the switch high the
        // board lands in ROM DFU instead of the app - jump past it again.
        if (!ctx.demo) await this._kickPastBootSwitch(ctx);
        t = await Transport.reconnect();
        if (t) {
          // open() can block INDEFINITELY on a port that never dropped
          // (e.g. an old resident bootloader that ignored JUMP) - never let
          // it pin this loop past the deadline.
          const opened = await Promise.race([
            t.open().then(() => true, () => false),
            Util.sleep(4000).then(() => false),
          ]);
          if (opened) {
            const probe = new GataBootloader(t);
            await Util.sleep(1300);
            const running = probe._buf.includes("*?");
            await this._safeClose(t);
            if (running) {
              Util.ok("Controller restarted - the new software is RUNNING.");
              return true;
            }
          } else {
            await this._safeClose(t);
          }
        }
      } catch (e) {
        if (t) await this._safeClose(t);
      }
      await Util.sleep(1500);
    }
    return false;
  },

  async _openDfu(ctx) {
    if (ctx.demo) return new MockDfuDevice();
    let dev = ctx._pickedDfu || null;      // already picked at the connect gate
    ctx._pickedDfu = null;
    if (!dev) dev = await DfuSeDevice.getAuthorizedDevice();
    if (!dev) {
      dev = await ctx.ui.userGate(I18N.t("gate.dfu.btn"), I18N.t("gate.dfu.text"),
        () => DfuSeDevice.requestDevice());
    }
    await dev.open();
    return dev;
  },

  /* The board is sitting in ROM DFU ("DFU in FS Mode") when we expected the
   * update firmware - the BOOT switch is (still) in the update position, so
   * every reset lands back in the ROM. DfuSe "leave" makes the ROM JUMP to
   * the resident bootloader WITHOUT a reset, so the BOOT pin is never
   * re-sampled - the switch position stops mattering for this whole update. */
  async _kickPastBootSwitch(ctx) {
    try {
      const d = await DfuSeDevice.getAuthorizedDevice();
      if (!d) return false;
      Util.warn("Board is in ROM DFU (BOOT switch in update position) - jumping past it automatically.");
      ctx._bootSwitchHigh = true;
      await d.open();
      await d._ensureIdle();
      await d.leave(APP_CONFIG.systemFlashAddr);
      await Util.sleep(2500);
      return true;
    } catch (e) {
      Util.warn("DFU jump attempt failed: " + e.message);
      return false;
    }
  },

  /* Connect to the CDC bootloader and complete the INFO handshake.
   * Self-healing against every known branch:
   *  - board reappears in ROM DFU (BOOT switch high) -> jump past it;
   *  - the RUNNING APPLICATION answers instead (e.g. the fresh system
   *    firmware's version already matched, so it started the app straight
   *    away) -> send enterBootloader and keep going;
   *  - port not there yet (app takes ~15 s to boot) -> retry long enough;
   *  - the first-time permission gate auto-continues when a port appears. */
  async _connectBootloader(ctx, opts) {
    const o = Object.assign({ tries: 12, delay: 1200, promptAfter: 0 }, opts || {});
    let lastErr = null;
    for (let attempt = 0; attempt < o.tries; attempt++) {
      this._ck();
      let transport = null;
      try {
        if (ctx.demo) {
          transport = new MockTransport({ hasEsp: ctx.demoHasEsp });
        } else {
          await this._kickPastBootSwitch(ctx);
          transport = await Transport.reconnect();
          if (!transport && attempt >= o.promptAfter) {
            transport = await ctx.ui.userGate(I18N.t("gate.ser.btn"), I18N.t("gate.ser.text"),
              () => Transport.request(),
              null,
              async () => (await Transport.reconnect()) || null);
          }
          if (!transport) { await Util.sleep(o.delay); continue; }
        }
        await transport.open();
        const bl = new GataBootloader(transport);
        bl.shouldAbort = () => this.cancelRequested;
        if (ctx.onDeviceLine) bl.onDeviceLine = ctx.onDeviceLine;
        await Util.sleep(ctx.demo ? 100 : 700);   // let the port settle

        // The APPLICATION owns this port? Command it back into update mode.
        if (!ctx.demo && bl._buf.includes("*?")) {
          Util.info("Running application answered - commanding it into update mode.");
          try { await bl.enterBootloaderViaApp(); } catch (e2) { /* fall through */ }
          await this._safeClose(transport);
          await Util.sleep(2500);
          continue;
        }

        await bl.handshake();
        return bl;
      } catch (e) {
        if (e.message === I18N.t("err.cancelled")) throw e;
        lastErr = e;
        Util.warn("Connect attempt " + (attempt + 1) + "/" + o.tries + " failed: " + e.message);
        if (transport) { try { await transport.close(); } catch (e2) { /* ignore */ } }
        await Util.sleep(o.delay);
      }
    }
    throw new UploaderError("Could not reach the update firmware over USB." +
      (lastErr ? " (" + lastErr.message + ")" : ""), I18N.t("hint.boot"));
  },

  /* Open one serial transport and sort out WHO answers:
   *  - the update firmware (INFO handshake works)   -> done, return it;
   *  - the running application                       -> send enterBootloader,
   *    the board reboots itself into update mode     -> reconnect, return it;
   *  - neither (old app firmware without the command) -> null (DFU fallback).
   */
  async _probeOrCommand(ctx, transport, step) {
    try { await transport.open(); }
    catch (e) { Util.warn("Could not open the port: " + e.message); return null; }
    const bl = new GataBootloader(transport);
    bl.shouldAbort = () => this.cancelRequested;
    if (ctx.onDeviceLine) bl.onDeviceLine = ctx.onDeviceLine;
    await Util.sleep(900);

    // The APPLICATION streams HMI frames ("value*?identifier*?...") on this
    // port nonstop - if they are already in the buffer, skip the handshake
    // attempt entirely and command the reboot straight away.
    const looksLikeApp = bl._buf.includes("*?");
    if (looksLikeApp) {
      Util.info("Application traffic detected on the port - sending enterBootloader.");
    } else {
      try {
        await bl.handshake();
        step("system", "done", I18N.t("d.sysSkipped"), 1);
        step("connect", "done", I18N.t("d.connected"), 1);
        return bl;                                 // already in update mode
      } catch (e) {
        if (e.message === I18N.t("err.cancelled")) throw e;
      }
    }

    // The application owns the port -> ask it to reboot into update mode.
    step("connect", "active", I18N.t("d.cmdReboot"), null);
    let acked = false;
    try { acked = await bl.enterBootloaderViaApp(); }
    catch (e) { if (e.message === I18N.t("err.cancelled")) throw e; }
    try { await transport.close(); } catch (e) { /* resetting anyway */ }
    if (!acked) {
      // The ack string routinely LOSES the race: the board resets ~1 s after
      // the command and the reply drowns in the streaming HMI frames. The
      // real success signal is who answers on the port next - so always go
      // and look instead of trusting the ack.
      Util.info("No ack seen (board may have reset mid-reply) - checking who owns the port now...");
    }

    await Util.sleep(2500);                        // board reboots into the window
    let appSeenAgain = 0;
    for (let i = 0; i < 10; i++) {
      this._ck();
      const t2 = await Transport.reconnect();
      if (t2) {
        let opened = false;
        try {
          await t2.open();
          opened = true;
          const bl2 = new GataBootloader(t2);
          bl2.shouldAbort = () => this.cancelRequested;
          if (ctx.onDeviceLine) bl2.onDeviceLine = ctx.onDeviceLine;
          await Util.sleep(700);
          if (bl2._buf.includes("*?")) {
            // The APPLICATION is (still/again) running. A single command
            // frame can get LOST inside the app (its receive path competes
            // with the nonstop telemetry stream - the HMI protocol itself is
            // built around resending for this reason). So RESEND on every
            // sighting; only after 3 sightings each followed by a fresh
            // resend is the command really unsupported -> DFU fallback.
            appSeenAgain++;
            if (appSeenAgain >= 3 && !acked) {
              await this._safeClose(t2);
              Util.warn("Application still running after 3x enterBootloader - firmware without the command.");
              return null;
            }
            if (!acked) {
              Util.info("Application still streaming - resending enterBootloader (attempt " +
                        (appSeenAgain + 1) + "/3).");
              try { acked = await bl2.enterBootloaderViaApp(); }
              catch (e3) { if (e3.message === I18N.t("err.cancelled")) throw e3; }
              // A dying port right here usually IS the reset taking effect.
            }
            await this._safeClose(t2);
            await Util.sleep(acked ? 2500 : 1200);
            continue;
          }
          await bl2.handshake();
          step("system", "done", I18N.t("d.sysCmd"), 1);
          step("connect", "done", I18N.t("d.connected"), 1);
          return bl2;
        } catch (e) {
          if (e.message === I18N.t("err.cancelled")) throw e;
          if (opened) { try { await t2.close(); } catch (e2) { /* ignore */ } }
        }
      }
      await Util.sleep(1200);
    }
    return null;
  },

  /* DFU fallback: flash the (alternating) system firmware, then connect to
   * the update firmware's serial port - retrying if the 15 s window was
   * missed. Also used directly when the board is already in BOOT mode. */
  async _dfuCycle(ctx, step) {
    const maxCycles = 3;
    let lastErr = null;
    for (let cycle = 0; cycle < maxCycles; cycle++) {
      this._ck();
      const which = PingPong.next();
      const image = which === "B1" ? ctx.pkg.b1 : ctx.pkg.b3;
      step("system", "active",
        I18N.t("d.sysFlashing", { b: which, s: Util.fmtBytes(image.length) }), 0);
      const dfu = await this._openDfu(ctx);
      this._ck();
      await dfu.flash(APP_CONFIG.systemFlashAddr, image, p => {
        const frac = p.phase === "erase" ? p.value * 0.25 : 0.25 + p.value * 0.75;
        step("system", "active",
          p.phase === "erase" ? I18N.t("d.sysErasing") : I18N.t("d.sysWriting", { b: which }),
          frac);
      });
      PingPong.commit(which);
      step("system", "done", I18N.t("d.sysDone", { b: which }), 1);
      Util.ok("System firmware " + which + " flashed - controller rebooting into update mode.");
      await Util.sleep(ctx.demo ? 300 : 2000);

      step("connect", "active", I18N.t("d.waitPort"), null);
      try {
        const bl = await this._connectBootloader(ctx);
        step("connect", "done", I18N.t("d.connected"), 1);
        return bl;
      } catch (e) {
        if (this.cancelRequested || e.message === I18N.t("err.cancelled")) throw e;
        lastErr = e;
        if (cycle === maxCycles - 1) break;
        Util.warn(I18N.t("d.winLost"));
        step("connect", "warn", I18N.t("d.winLost"), null);

        // The board likely booted the existing application. If that firmware
        // knows the enterBootloader command, recover with NO buttons at all.
        if (!ctx.demo) {
          const t3 = await Transport.reconnect();
          if (t3) {
            const bl3 = await this._probeOrCommand(ctx, t3, step);
            if (bl3) return bl3;
          }
        }
        // Old firmware: one more BOOT-mode cycle (alternate B file reopens
        // the window even if the stored version happens to match).
        await ctx.ui.userGate(I18N.t("gate.reboot.btn"), I18N.t("gate.reboot.text"),
          async () => true);
      }
    }
    throw lastErr || new UploaderError("Could not reach the update firmware.", I18N.t("hint.boot"));
  },

  /* Get a connected bootloader with as little user involvement as possible:
   * one serial connection (a picker only on the very first run), the running
   * application reboots itself into update mode via enterBootloader, and the
   * BOOT-button + DFU path remains as the fallback for old/blank firmware. */
  async _establishUpdateMode(ctx, step) {
    if (ctx.demo) return this._dfuCycle(ctx, step);

    step("connect", "active", I18N.t("d.waitPort"), null);
    let transport = await Transport.reconnect();
    let bootModeChosen = false;

    if (!transport) {
      // No authorized serial port. If a known DFU device is already present,
      // the board is sitting in BOOT mode - go straight to the DFU path.
      const dfuThere = await DfuSeDevice.getAuthorizedDevice();
      if (!dfuThere) {
        // PRIMARY button = board in BOOT mode -> the DFU picker opens in that
        // same click ("STM32 BOOTLOADER"). Secondary = board running normally
        // -> serial picker. The poll auto-continues the moment the board
        // appears in ANY state the browser can access without a prompt:
        // DFU device (BOOT mode) or serial port (running app OR the parked
        // no-firmware bootloader) - policies/persisted grants make both
        // visible, so plugging the board in is enough, no click.
        /* Primary button = the normal situation (the controller is running);
         * BOOT mode is the fallback for old or blank firmware. */
        const picked = await ctx.ui.userGate(
          I18N.t("gate.run.btn"),
          I18N.t("gate.connect.text") + " " +
            I18N.t(Transport.isAndroid() ? "gate.connect.tipMobile" : "gate.connect.tipPc"),
          async () => ({ serial: await Transport.request() }),
          { label: I18N.t("gate.boot.btn"), action: async () => ({ dfu: await DfuSeDevice.requestDevice() }) },
          async () => {
            const d = await DfuSeDevice.getAuthorizedDevice();
            if (d) return { dfu: d };
            const t = await Transport.reconnect();
            if (t) return { serial: t };
            return null;
          });
        if (picked.dfu) { ctx._pickedDfu = picked.dfu; bootModeChosen = true; }
        else transport = picked.serial;
      } else {
        bootModeChosen = true;
      }
    }

    if (transport && !bootModeChosen) {
      const bl = await this._probeOrCommand(ctx, transport, step);
      if (bl) return bl;
      step("connect", "active", I18N.t("d.waitPort"), null);
    }
    return this._dfuCycle(ctx, step);
  },

  /* ------------------------------------------------------------- main flow */

  /* ctx = {
   *   mode: "controller" | "cloud" | "both",
   *   pkg: { main, b1, b3, esp|null },        // Uint8Arrays
   *   version,                                 // for the history entry
   *   demo, demoHasEsp, autoJump,
   *   ui: { step(id, state, detail, progress), userGate(title, text, action) },
   *   onDeviceLine(line),
   * }
   */
  async runFullUpdate(ctx) {
    if (this.running) throw new UploaderError("An update is already running.");
    const mode = ctx.mode || "both";
    const actionKey = mode === "controller" ? "action.ctrl"
                    : mode === "cloud" ? "action.cloud" : "action.full";
    this.running = true;
    this.cancelRequested = false;
    const step = ctx.ui.step;
    const t0 = Date.now();
    let ok = false;

    try {
      Validate.checkPackage(ctx.pkg, {
        main: mode !== "cloud",
        system: true,                 // B1/B3 always present (DFU fallback)
        esp: mode === "cloud",
      });
      await this._acquireWakeLock();

      /* ---- phases 1+2: reach the update firmware ------------------------
       * One serial connection: the running application reboots itself into
       * update mode (enterBootloader); BOOT-button DFU is the fallback. */
      let bl = await this._establishUpdateMode(ctx, step);

      /* =================================================== mode: cloud ==== */
      if (mode === "cloud") {
        // No FORMAT: the controller application stays untouched. Move quickly -
        // the 15 s window keeps ticking until ESP_WRITE reaches the device
        // (from then on the firmware blocks its own auto-exit).
        step("esp", "active", I18N.t("d.espCheck"), null);
        const hasEsp = await bl.espDetect(true);
        this._ck();
        if (!hasEsp) throw new UploaderError(I18N.t("err.noEsp"), I18N.t("hint.noEsp"));

        let image, addr;
        if (Esp32.hasCompleteSet(ctx.pkg.esp)) {
          image = Esp32.buildCombinedImage(ctx.pkg.esp);
          addr = Esp32.BASE_ADDR;
        } else {
          image = ctx.pkg.esp.firmware;
          addr = Esp32.APP_ONLY_ADDR;
        }
        step("esp", "active", I18N.t("d.espFound"), 0);
        await bl.espWrite(addr, image,
          f => step("esp", "active", I18N.t("d.espProg", { p: Math.round(f * 100) }), f),
          msg => step("esp", "active", msg, null));
        step("esp", "done", I18N.t("d.espDone"), 1);
        try { await bl.t.close(); } catch (e) { /* controller resets itself */ }

        const secs = Math.round((Date.now() - t0) / 1000);
        step("finish", "done", I18N.t("d.finishCloud", { t: secs }), 1);
        Util.ok("CLOUD MODULE UPDATE COMPLETE.");
        ok = true;
        return true;
      }

      /* ====================================== modes: controller / both ==== */
      /* Erase external flash FIRST - this closes the 15 s window for good. */
      step("app", "active", I18N.t("d.extErase"), 0);
      await bl.format(sec => step("app", "active",
        I18N.t("d.extEraseSec", { t: Math.round(sec) }), null));
      this._ck();
      step("app", "active", I18N.t("d.extErased"), 0.15);

      /* ESP32 phase (mode "both" only) - BETWEEN erase and app install, and
       * the app region stays erased throughout it, which makes the ordering
       * bulletproof: with no valid app the bootloader never auto-exits, so
       * there is no time pressure, and any mid-phase reset just returns here.
       *
       * Why the ESP must be silenced BEFORE the app is streamed (8:47 PM run):
       * an incompatible/old ESP firmware chatters on the shared UART from
       * power-on, and the interrupt load slows the bootloader's USB write
       * path ~80x until it wedges (4 s per 4 KB, dead at 12 KB). Flashing the
       * ESP first puts it into its silent ROM download mode and installs
       * firmware that does not chatter - the app then streams at full speed.
       * And why a FAILED probe needs a reboot (5:05/6:12 runs): ESP_DETECT on
       * a board without an ESP leaves the probe UART armed and a delayed
       * interrupt storm kills the stream ~13 s later at the same byte - a
       * reset fully defuses it (nothing re-arms the UART on the next boot). */
      if (mode === "both") {
        step("esp", "active", I18N.t("d.espCheck"), null);
        const hasEsp = await bl.espDetect(true);
        this._ck();

        if (hasEsp && ctx.pkg.esp) {
          let image, addr;
          if (Esp32.hasCompleteSet(ctx.pkg.esp)) {
            image = Esp32.buildCombinedImage(ctx.pkg.esp);
            addr = Esp32.BASE_ADDR;
          } else {
            image = ctx.pkg.esp.firmware;
            addr = Esp32.APP_ONLY_ADDR;
          }
          step("esp", "active", I18N.t("d.espFound"), 0);
          await bl.espWrite(addr, image,
            f => step("esp", "active", I18N.t("d.espProg", { p: Math.round(f * 100) }), f),
            msg => step("esp", "active", msg, null));
          step("esp", "done", I18N.t("d.espDone"), 1);
          /* The STM32 restarts itself after ESP_COMPLETE; the app region is
           * erased, so the bootloader waits for us - reconnect, no hurry. */
          Util.info("Controller restarts after the ESP32 upload - reconnecting...");
          try { await bl.t.close(); } catch (e) { /* port is dropping anyway */ }
          step("connect", "active", I18N.t("d.reconWait"), null);
          await Util.sleep(ctx.demo ? 300 : 4000);
          bl = await this._connectBootloader(ctx, { tries: 12, delay: 1200 });
          step("connect", "done", I18N.t("d.reconnected"), 1);
        } else {
          if (hasEsp && !ctx.pkg.esp) step("esp", "warn", I18N.t("d.espNoFiles"), 1);
          else step("esp", "done", I18N.t("d.espNone"), 1);
          if (!ctx.demo) {
            /* Defuse the failed-probe storm: reboot the board. The erased
             * app region keeps the bootloader in update mode afterwards. */
            Util.info("Rebooting the controller to clear the ESP probe (fresh start for the install)...");
            try { await bl.jump(); } catch (e) { /* reply not expected */ }
            try { await bl.t.close(); } catch (e) { /* resetting anyway */ }
            step("connect", "active", I18N.t("d.reconWait"), null);
            await Util.sleep(3000);
            bl = await this._connectBootloader(ctx, { tries: 12, delay: 1200 });
            step("connect", "done", I18N.t("d.reconnected"), 1);
          }
        }
      }

      /* Application - streamed with the ESP silenced (or absent + defused). */
      step("app", "active",
        I18N.t("d.appInstalling", { s: Util.fmtBytes(ctx.pkg.main.length) }), 0.15);
      await bl.writeApp(ctx.pkg.main, f =>
        step("app", "active", I18N.t("d.appProg", { p: Math.round(f * 100) }), 0.15 + f * 0.8));
      this._ck();
      await bl.verify();
      step("app", "done", I18N.t("d.appDone"), 1);

      /* Finish: restart, then WATCH the port until the application is
       * actually running. After JUMP the resident bootloader revalidates for
       * ~15 s (BKP30 was cleared to open the update window), the port goes
       * silent, then re-enumerates with the app streaming HMI frames - that
       * stream is the proof the controller is back up. */
      const secs = Math.round((Date.now() - t0) / 1000);
      if (ctx.autoJump !== false) {
        step("finish", "active", I18N.t("d.restarting"), null);
        await bl.jump();
        await this._safeClose(bl.t);
        let running = false;
        if (!ctx.demo) {
          step("finish", "active", I18N.t("d.restartWait"), null);
          running = await this._waitForApp(ctx, 40000);
        }
        const warn = ctx._bootSwitchHigh ? " " + I18N.t("d.bootHigh") : "";
        if (running) {
          step("finish", ctx._bootSwitchHigh ? "warn" : "done",
            I18N.t("d.finishRunning", { t: secs }) + warn, 1);
        } else {
          step("finish", "done", I18N.t("d.finishAuto", { t: secs }) + warn, 1);
        }
      } else {
        await this._safeClose(bl.t);
        step("finish", "done", I18N.t("d.finishManual"), 1);
      }
      Util.ok("UPDATE COMPLETE.");
      ok = true;
      return true;
    } finally {
      this.running = false;
      await this._releaseWakeLock();
      this._record(actionKey, ok, (Date.now() - t0) / 1000, ctx.version);
    }
  },

  /* ------------------------------------------------- individual (advanced) */

  async runSystemOnly(ctx) {
    this.cancelRequested = false;
    this.running = true;
    const t0 = Date.now();
    let ok = false;
    try {
      const which = ctx.forceBootloader || PingPong.next();
      const image = which === "B1" ? ctx.pkg.b1 : ctx.pkg.b3;
      if (!image) throw new UploaderError("System firmware file " + which + ".bin is not loaded.",
        I18N.t("hint.pickBoth"));
      if (!Validate.isValidSystem(image)) {
        throw new UploaderError(I18N.t("val.boot", { f: which + ".bin" }));
      }
      await this._acquireWakeLock();
      const dfu = await this._openDfu(ctx);
      await dfu.flash(APP_CONFIG.systemFlashAddr, image, p =>
        ctx.onProgress && ctx.onProgress(p.phase, p.value));
      PingPong.commit(which);
      Util.ok("System firmware " + which + " installed - device reboots into update mode.");
      ok = true;
    } finally {
      this.running = false;
      await this._releaseWakeLock();
      this._record("action.system", ok, (Date.now() - t0) / 1000, ctx.version);
    }
  },

  async runAppOnly(ctx) {
    this.cancelRequested = false;
    this.running = true;
    const t0 = Date.now();
    let ok = false;
    try {
      if (!Validate.isValidApp(ctx.pkg.main)) {
        throw new UploaderError(I18N.t("val.main", { f: "M*.bin" }));
      }
      await this._acquireWakeLock();
      const bl = await this._connectBootloader(ctx, { tries: 3 });
      await bl.format(sec => ctx.onProgress && ctx.onProgress("erase", sec));
      await bl.writeApp(ctx.pkg.main, f => ctx.onProgress && ctx.onProgress("write", f));
      await bl.verify();
      if (ctx.autoJump !== false) await bl.jump();
      try { await bl.t.close(); } catch (e) { /* ignore */ }
      Util.ok("Application update finished.");
      ok = true;
    } finally {
      this.running = false;
      await this._releaseWakeLock();
      this._record("action.app", ok, (Date.now() - t0) / 1000, ctx.version);
    }
  },

  async runEspOnly(ctx) {
    this.cancelRequested = false;
    this.running = true;
    const t0 = Date.now();
    let ok = false;
    try {
      if (!ctx.pkg.esp || !ctx.pkg.esp.firmware) {
        throw new UploaderError(I18N.t("err.noEspFiles"));
      }
      await this._acquireWakeLock();
      const bl = await this._connectBootloader(ctx, { tries: 3 });
      const hasEsp = await bl.espDetect(true);
      if (!hasEsp) throw new UploaderError(I18N.t("err.noEsp"), I18N.t("hint.noEsp"));
      let image, addr;
      if (Esp32.hasCompleteSet(ctx.pkg.esp)) {
        image = Esp32.buildCombinedImage(ctx.pkg.esp); addr = Esp32.BASE_ADDR;
      } else {
        image = ctx.pkg.esp.firmware; addr = Esp32.APP_ONLY_ADDR;
      }
      await bl.espWrite(addr, image, f => ctx.onProgress && ctx.onProgress("esp", f));
      try { await bl.t.close(); } catch (e) { /* ignore */ }
      Util.ok("ESP32 update finished - controller restarts.");
      ok = true;
    } finally {
      this.running = false;
      await this._releaseWakeLock();
      this._record("action.esp", ok, (Date.now() - t0) / 1000, ctx.version);
    }
  },
};
