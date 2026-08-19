/* GATA Cloud Uploader - UI wiring. */
"use strict";

const App = {
  manifest: null,
  selectedVersion: null,
  localMode: false,
  busy: false,

  $(id) { return document.getElementById(id); },

  /* ---------------------------------------------------------------- boot */
  async init() {
    I18N.init();
    I18N.applyStatic();
    this.wireEvents();
    this.renderBoardButtons();
    this.renderCaps();
    this.renderHistory();
    this.applySettingsToUi();
    this.initLog();
    Transport.watchDisconnects();
    Flows.installWakeLockKeeper();
    this.$("verInfo").textContent = "GATA Cloud Uploader v" + APP_CONFIG.version;

    // Never lose a running update to an accidental tab close / back gesture.
    window.addEventListener("beforeunload", e => {
      if (this.busy) { e.preventDefault(); e.returnValue = ""; }
    });

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      // Auto-refresh on deploys: when a new service worker (new APP_CONFIG
      // version) activates, reload so the tab can never keep running old code
      // - unless an update is in progress; then reload after it finishes.
      navigator.serviceWorker.register("sw.js").then(reg => {
        reg.update().catch(() => {});
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state !== "activated") return;
            if (this.busy) {
              this._pendingReload = true;
              Util.warn("A new app version is ready - it loads when this update finishes.");
            } else {
              Util.ok("New app version deployed - reloading.");
              location.reload();
            }
          });
        });
      }).catch(() => {});
    }

    /* License first: it decides the firmware channel, so the manifest can
     * only be loaded after it. Without one, the app shows the license card
     * and waits - nothing else works until a valid license is entered. */
    await License.loadStored();
    this.renderLicense();
    if (License.licensed()) {
      await this.loadManifest();
    }
  },

  /* --------------------------------------------------------------- license */
  renderLicense() {
    const card = this.$("licenseCard");
    const lic = License.info();
    if (lic && lic.legacy) { card.classList.add("hidden"); return; }  // old per-customer package
    card.classList.remove("hidden");
    this.$("licEnter").classList.toggle("hidden", !!lic);
    this.$("licShow").classList.toggle("hidden", !lic);
    if (lic) {
      this.$("licWho").textContent = lic.customer + " (" + lic.channel + ")";
      this.$("licExp").textContent = lic.exp ? I18N.t("lic.until", { d: lic.exp }) : "";
    }
  },

  async onLicActivate() {
    const err = this.$("licError");
    err.classList.add("hidden");
    try {
      await License.activate(this.$("licInput").value);
      this.$("licInput").value = "";
      this.renderLicense();
      localStorage.removeItem("gata.lastManifestDate");   // channels have their own timeline
      await this.loadManifest();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  },

  /* Every action that would touch a controller or download firmware runs
   * through this gate. */
  requireLicense() {
    if (License.licensed()) return true;
    Util.err(I18N.t("lic.needed"));
    this.$("licenseCard").scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  },

  demo() { return localStorage.getItem("gata.demo") === "1"; },

  /* ------------------------------------------------------------ platform */
  platform() {
    const ua = navigator.userAgent;
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
    return { isAndroid, isIOS, hasSerial: !!navigator.serial, hasUsb: !!navigator.usb };
  },

  renderCaps() {
    const p = this.platform();
    const banner = this.$("platformBanner");
    banner.className = "banner hidden";

    this.$("prepConnect").textContent = I18N.t(p.isAndroid || p.isIOS ? "prep.1.phone" : "prep.1.pc");

    const caps = [];
    if (p.hasSerial) caps.push("Web Serial");
    if (p.hasUsb) caps.push("WebUSB");
    this.$("capsInfo").textContent = caps.length
      ? I18N.t("foot.usb") + " " + caps.join(" + ")
      : I18N.t("foot.noUsb");

    if (p.isIOS) {
      banner.innerHTML = I18N.t("plat.ios");
      banner.className = "banner err";
    } else if (!p.hasUsb && !p.hasSerial) {
      banner.innerHTML = I18N.t(p.isAndroid ? "plat.noUsbAndroid" : "plat.noUsb");
      banner.className = "banner";
    } else if (p.isAndroid) {
      banner.innerHTML = I18N.t("plat.android");
      banner.className = "banner";
    }
  },

  /* ---------------------------------------------------------------- log */
  initLog() {
    const el = this.$("log");
    Util.onLog(line => {
      const span = document.createElement("span");
      span.className = line.cls;
      span.textContent = "[" + line.time.toLocaleTimeString() + "] " + line.msg + "\n";
      el.appendChild(span);
      if (el.childNodes.length > 800) el.removeChild(el.firstChild);
      el.scrollTop = el.scrollHeight;
    });
    Util.info("GATA Cloud Uploader v" + APP_CONFIG.version + " (" + location.href + ")");
  },

  /* ------------------------------------------------------------ manifest */
  async loadManifest() {
    const list = this.$("versionList");
    if (!License.licensed()) {
      list.innerHTML = "";
      const div = document.createElement("div");
      div.className = "muted";
      div.textContent = I18N.t("lic.needed");
      list.appendChild(div);
      return;
    }
    list.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "muted";
    loading.textContent = I18N.t("d.loading");
    list.appendChild(loading);
    try {
      this.manifest = await Cloud.fetchManifest();
      this.renderVersions();
    } catch (e) {
      this.manifest = null;
      list.innerHTML = "";
      const div = document.createElement("div");
      div.className = "banner err";
      div.textContent = e.message + (e.hint ? " — " + e.hint : "");
      list.appendChild(div);
      const btn = document.createElement("button");
      btn.className = "btn ghost";
      btn.textContent = I18N.t("btn.refresh");
      btn.onclick = () => this.loadManifest();
      list.appendChild(btn);
    }
  },

  /* Which board revision the user is updating (persisted per device). */
  board() { return localStorage.getItem("gata.board") === "rev6" ? "rev6" : "rev5"; },
  setBoard(b) {
    localStorage.setItem("gata.board", b);
    this.selectedVersion = null;               // the old pick may not exist for this board
    this.renderBoardButtons();
    this.renderVersions();
  },
  renderBoardButtons() {
    const b = this.board();
    this.$("btnBoard5").classList.toggle("on", b === "rev5");
    this.$("btnBoard6").classList.toggle("on", b === "rev6");
    this.$("boardNote6").classList.toggle("hidden", b !== "rev6");
  },

  renderVersions() {
    const list = this.$("versionList");
    list.innerHTML = "";
    if (!this.manifest) return;
    const shown = Cloud.forBoard(this.manifest.versions, this.board());
    if (!shown.length) {
      const div = document.createElement("div");
      div.className = "muted";
      div.textContent = I18N.t("board.none");
      list.appendChild(div);
      return;
    }
    shown.forEach((v, idx) => {
      const row = document.createElement("label");
      row.className = "verrow";
      const radio = document.createElement("input");
      radio.type = "radio"; radio.name = "ver";
      const isSel = this.selectedVersion ? this.selectedVersion === v : idx === 0;
      radio.checked = isSel;
      if (isSel) { this.selectedVersion = v; row.classList.add("sel"); }
      radio.onchange = () => {
        this.selectedVersion = v;
        list.querySelectorAll(".verrow").forEach(r => r.classList.remove("sel"));
        row.classList.add("sel");
      };
      const main = document.createElement("div");
      main.className = "vmain";
      const name = document.createElement("div");
      name.className = "vname";
      name.textContent = I18N.t("ver.prefix") + " " + v.version;
      if (idx === 0 || v.latest) {
        const tag = document.createElement("span");
        tag.className = "tag latest"; tag.textContent = I18N.t("tag.latest");
        name.appendChild(tag);
      }
      if (v.esp && v.esp.firmware) {
        const tag = document.createElement("span");
        tag.className = "tag esp"; tag.textContent = I18N.t("tag.esp");
        name.appendChild(tag);
      }
      const notes = document.createElement("div");
      notes.className = "vnotes";
      notes.textContent = v.notes || "";
      main.appendChild(name); main.appendChild(notes);
      const meta = document.createElement("div");
      meta.className = "vmeta";
      meta.textContent = v.date || "";
      if (v.main && v.main.size) {
        meta.appendChild(document.createElement("br"));
        meta.appendChild(document.createTextNode(Util.fmtBytes(v.main.size)));
      }
      row.appendChild(radio); row.appendChild(main); row.appendChild(meta);
      list.appendChild(row);
    });
  },

  /* ----------------------------------------------------- local folder mode */
  localFound: null,          // result of LocalSource.scan()
  localMainSel: null,        // chosen M*.bin when several exist

  async scanLocal() {
    const list = this.$("localList");
    list.innerHTML = "";
    const busy = document.createElement("div");
    busy.className = "muted small";
    busy.textContent = I18N.t("d.readingLocal");
    list.appendChild(busy);
    try {
      this.localFound = await LocalSource.scan();
    } catch (e) {
      this.localFound = null;
      Util.err("Local folder scan failed: " + e.message);
    }
    this.renderLocal();
  },

  renderLocal() {
    const list = this.$("localList");
    list.innerHTML = "";
    const f = this.localFound;
    if (!f) {
      const div = document.createElement("div");
      div.className = "banner err";
      div.textContent = I18N.t("local.hintFiles");
      list.appendChild(div);
      return;
    }
    const row = (ok, label, detail) => {
      const div = document.createElement("div");
      div.className = "lrow " + (ok ? "lok" : "lmiss");
      const b = document.createElement("b");
      b.textContent = label;
      const s = document.createElement("span");
      s.textContent = detail;
      div.appendChild(b); div.appendChild(s);
      list.appendChild(div);
      return div;
    };

    // System firmware pair
    row(!!f.system, I18N.t("local.sys"),
      f.system ? f.system : I18N.t("local.missing") + " (system*.bin)");

    // Controller software (radio choice when several M*.bin exist)
    if (!f.mains.length) {
      row(false, I18N.t("local.main"), I18N.t("local.missing") + " (M*.bin)");
      this.localMainSel = null;
    } else if (f.mains.length === 1) {
      this.localMainSel = f.mains[0].name;
      row(true, I18N.t("local.main"),
        f.mains[0].name + (f.mains[0].size ? " (" + Util.fmtBytes(f.mains[0].size) + ")" : ""));
    } else {
      if (!this.localMainSel || !f.mains.some(m => m.name === this.localMainSel)) {
        this.localMainSel = f.mains[0].name;
      }
      const holder = row(true, I18N.t("local.main"), "");
      for (const m of f.mains) {
        const lab = document.createElement("label");
        lab.className = "lchoice";
        const radio = document.createElement("input");
        radio.type = "radio"; radio.name = "localMain";
        radio.checked = m.name === this.localMainSel;
        radio.onchange = () => { this.localMainSel = m.name; };
        lab.appendChild(radio);
        lab.appendChild(document.createTextNode(
          m.name + (m.size ? " (" + Util.fmtBytes(m.size) + ")" : "")));
        holder.appendChild(lab);
      }
    }

    // ESP32 files
    const espDetail = f.espComplete ? I18N.t("local.espComplete")
      : (f.esp.firmware ? I18N.t("local.espFwOnly")
      : I18N.t("local.missing") + " (cloud_firmware) — " + I18N.t("opt"));
    row(!!f.esp.firmware, I18N.t("local.esp"), espDetail);

    // The listing endpoint only exists in the current serve.ps1 - if we had
    // to fall back to name-probing on localhost, the user is running an old
    // server window and M*.bin discovery cannot work. Say so plainly.
    if (!f.viaListing && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
      const warn = document.createElement("div");
      warn.className = "banner";
      warn.textContent = I18N.t("local.oldServer");
      list.appendChild(warn);
    }
  },

  /* --------------------------------------------------------- step display */
  /* mode controls which phase rows are shown for this run. */
  resetSteps(mode) {
    this.$("stepList").classList.remove("hidden");
    this.$("resultBox").classList.add("hidden");
    const hiddenFor = {
      controller: ["esp"],
      cloud: ["app", "wipe"],
      both: [],
    }[mode || "both"] || [];
    // The memory-preparation row only exists on a first installation.
    const chk = this.$("chkFirstInstall");
    if (!(chk && chk.checked) && !hiddenFor.includes("wipe")) hiddenFor.push("wipe");
    document.querySelectorAll("#stepList li").forEach(li => {
      li.className = "";
      li.classList.toggle("hidden", hiddenFor.includes(li.dataset.step));
      li.querySelector("small").textContent = "";
      li.querySelector(".bar").classList.remove("show");
      li.querySelector(".bar i").style.width = "0";
    });
  },

  step(id, state, detail, progress) {
    const li = document.querySelector('#stepList li[data-step="' + id + '"]');
    if (!li) return;
    li.className = "st-" + state;
    if (detail != null) li.querySelector("small").textContent = detail;
    const bar = li.querySelector(".bar");
    if (progress != null) {
      bar.classList.add("show");
      bar.querySelector("i").style.width = Math.round(progress * 100) + "%";
    }
  },

  /* A big button the flow can show when a user gesture (device picker) is
   * needed. `alt` = optional secondary choice { label, action }.
   * `poll` = optional async () => value|null, checked every second - when it
   * returns a value the gate resolves ITSELF with it (no click needed, e.g.
   * the user just put the board into BOOT mode). */
  userGate(title, text, action, alt, poll) {
    return new Promise((resolve, reject) => {
      const box = this.$("gateBox");
      const btn = this.$("gateBtn");
      const btnAlt = this.$("gateBtnAlt");
      /* No wall of text - the explanation goes to the technical log. Two
       * buttons only where there is a genuine choice: a controller still
       * running its old software, or one already sitting in update mode
       * (a new controller, or one put there with B + R). Everywhere else a
       * single neutral button. */
      this.$("gateText").textContent = "";
      btn.textContent = alt ? I18N.t("btn.connectRunning") : I18N.t("btn.connect");
      btn.classList.remove("hidden");
      btnAlt.classList.toggle("hidden", !alt);
      if (alt) btnAlt.textContent = I18N.t("btn.connectUpdateMode");
      box.classList.remove("hidden");
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      Util.warn("WAITING FOR YOU: " + title);
      if (text) Util.info(text);
      let pollTimer = null;
      let finish = (ok, value) => {
        if (pollTimer) clearInterval(pollTimer);
        box.classList.add("hidden");
        btn.classList.remove("hidden");        // restore for any other user
        if (ok) resolve(value); else reject(value);
      };
      /* Never leave the buttons dead. Disabling them while a device chooser is
       * open used to make later taps do NOTHING AT ALL if that chooser never
       * settled - which looks exactly like "the popup does not appear". */
      let asking = false;
      const run = fn => async () => {
        /* NEVER disable these buttons. A disabled button does not fire its
         * handler at all, so if a device chooser failed to appear the next
         * tap did nothing AND said nothing - looking exactly like a broken
         * app. Guard with a flag instead, so every tap gets an answer. */
        if (asking) {
          Util.warn("Still waiting for the device list to open — touch again.");
          return;
        }
        asking = true;
        const reArm = setTimeout(() => { asking = false; }, 12000);
        try {
          Util.info("Opening the device list…");
          finish(true, await fn());
          return;
        } catch (e) {
          if (e && (e.name === "NotFoundError" || /No (device|port) selected/i.test(e.message))) {
            // The picker was dismissed - but an EMPTY picker looks identical
            // to a cancelled one, so say which of the two it was.
            Util.warn("No device picked — waiting…");
            await this.explainEmptyPicker();
          } else if (e && e.name === "SecurityError") {
            Util.err("The browser refused to open the device list (" + e.message +
                     "). Press the button again - it must be a direct tap.");
          } else if (e && e.name === "NotAllowedError") {
            Util.err("The browser blocked USB access (" + e.message + ").");
          } else {
            finish(false, e);
          }
        } finally {
          clearTimeout(reArm);
          asking = false;
        }
      };
      /* No button to hunt for: a browser only opens a device chooser during a
       * real touch, so ANY touch on the page opens it. Successive touches
       * alternate between the two ways a controller can appear (running, or
       * held in BOOT mode), so nothing has to be chosen or explained. */
      /* MUST be a real "click" handler: a browser opens a device chooser only
       * during a COMPLETED tap - pointerdown fires too early and the request
       * is refused with "Must be handling a user gesture". */
      btn.onclick = run(action);
      btnAlt.onclick = alt ? run(alt.action) : null;

      if (poll) {
        pollTimer = setInterval(async () => {
          try {
            const v = await poll();
            if (v != null) { Util.ok("Controller detected — continuing automatically."); finish(true, v); }
          } catch (e) { /* keep polling */ }
        }, 1000);
      }
    });
  },

  /* One tap: if this browser has never been given the controller, open the
   * chooser straight away (we are inside the click). Returns the transport, or
   * null - a refusal is not fatal, the flow still has its own gates. */
  async preConnect() {
    if (this.demo()) return null;
    try {
      const known = await Transport.reconnect();
      if (known) { Util.info("Controller already approved on this device - connecting."); return known; }
      Util.info("Asking for permission to use the controller…");
      return await Transport.request();
    } catch (e) {
      if (e && (e.name === "NotFoundError" || /No (device|port) selected/i.test(e.message))) {
        await this.explainEmptyPicker();
      } else {
        Util.warn("Could not open the controller yet (" + e.message + ") - continuing.");
      }
      return null;
    }
  },

  /* Report what the browser can actually SEE on USB. "The list was empty" and
   * "I closed the list" produce the same error, and the causes are different:
   * on a phone it is nearly always the OTG cable, an unpowered controller, or
   * another app (the GATA HMI) already holding the device. */
  async explainEmptyPicker() {
    try {
      const seen = [];
      if (navigator.usb) {
        for (const d of await navigator.usb.getDevices()) {
          seen.push((d.productName || "USB device") +
                    " " + d.vendorId.toString(16).padStart(4, "0") +
                    ":" + d.productId.toString(16).padStart(4, "0"));
        }
      }
      if (navigator.serial) {
        for (const p of await navigator.serial.getPorts()) {
          const i = p.getInfo ? p.getInfo() : {};
          if (i.usbVendorId != null) {
            seen.push("port " + i.usbVendorId.toString(16).padStart(4, "0") +
                      ":" + (i.usbProductId || 0).toString(16).padStart(4, "0"));
          }
        }
      }
      if (seen.length) {
        Util.info("The browser already has access to: " + seen.join(", ") +
                  " — if the list was empty, the controller is not reachable right now.");
      } else if (Transport.isAndroid()) {
        Util.warn("The phone sees no controller. Check: the USB-OTG adapter is fully seated, " +
                  "the controller is powered, and no other app (the GATA HMI) is connected to it — " +
                  "close that app completely, then try again.");
      } else {
        Util.warn("No controller visible on USB. Check the cable, and that the controller is powered.");
      }
    } catch (e) { /* diagnostics must never break the flow */ }
  },

  showResult(ok, title, html) {
    const box = this.$("resultBox");
    box.className = "result " + (ok ? "ok" : "err");
    box.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = title;
    box.appendChild(b);
    const span = document.createElement("span");
    span.innerHTML = html;                 // our own strings + escaped error text
    box.appendChild(span);
    box.classList.remove("hidden");
  },

  escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  },

  failHtml(e) {
    return this.escapeHtml(e.message) +
      (e.hint ? "<br><small>" + this.escapeHtml(e.hint) + "</small>" : "");
  },

  setBusy(b) {
    this.busy = b;
    this.$("btnCancel").classList.toggle("hidden", !b);
    for (const id of ["btnUpdateNow", "btnUpdCtrl", "btnUpdCloud", "btnUpdBoth", "btnRefresh", "btnRescan"]) {
      const el = this.$(id);
      if (el) el.disabled = b;
    }
    if (!b && this._pendingReload) {
      this._pendingReload = false;
      setTimeout(() => location.reload(), 4000);   // let the result stay readable a moment
    }
  },

  /* ------------------------------------------------------- package loading */
  async getPackage(mode) {
    // Only fetch what the chosen action actually flashes.
    const needs = {
      controller: { controller: true, system: true, esp: "no" },
      cloud: { controller: false, system: true, esp: "required" },
      both: { controller: true, system: true, esp: "optional" },
    }[mode || "both"];

    if (this.localMode) {
      this.step("download", "active", I18N.t("d.readingLocal"), null);
      if (!this.localFound) this.localFound = await LocalSource.scan();
      const pkg = await LocalSource.load(this.localFound, needs, this.localMainSel,
        (name, frac) => this.step("download", "active", name + " — " + Math.round(frac * 100) + "%", null));
      this.step("download", "done", I18N.t("d.localLoaded"), 1);
      return { pkg, version: needs.controller && this.localMainSel ? this.localMainSel : "(folder)" };
    }
    if (!this.manifest || !this.selectedVersion) {
      throw new UploaderError("No firmware version selected.", I18N.t("btn.refresh"));
    }
    const v = this.selectedVersion;
    this.step("download", "active", I18N.t("d.downloading", { v: v.version }), 0);
    const pkg = await Cloud.downloadPackage(this.manifest, v, (name, frac) => {
      this.step("download", "active", name + " — " + Math.round(frac * 100) + "%", null);
    }, needs);
    this.step("download", "done",
      I18N.t(pkg.esp ? "d.pkgReadyEsp" : "d.pkgReady", { v: v.version }), 1);
    return { pkg, version: v.version };
  },

  /* ------------------------------------------------------------ main flow */
  async onUpdate(mode) {
    if (this.busy) return;
    if (!this.requireLicense()) return;
    this.setBusy(true);
    this.resetSteps(mode);
    try {
      /* Ask for the controller NOW, while this click still counts as a user
       * gesture - browsers only open the device chooser during one. Doing it
       * here means one tap: the chooser appears immediately instead of a
       * second "connect" button appearing minutes later, after the download,
       * when the gesture is long gone. Already-approved controllers skip it
       * entirely and nothing is ever shown. */
      const preConnected = await this.preConnect();

      const { pkg, version } = await this.getPackage(mode);
      await Flows.runFullUpdate({
        mode, pkg, version, preConnected,
        board: this.board(),
        firstInstall: !!(this.$("chkFirstInstall") && this.$("chkFirstInstall").checked),
        demo: this.demo(),
        demoHasEsp: localStorage.getItem("gata.demoEsp") !== "0",
        autoJump: this.$("chkAutoJump").checked,
        /* Forward EVERY argument: dropping `alt` hid the second choice
         * ("board is running normally") so the only way forward was BOOT
         * mode, and dropping `poll` disabled the automatic detection that
         * continues the moment the controller appears. */
        ui: {
          step: (a, b, c, d) => this.step(a, b, c, d),
          userGate: (t, x, a, alt, poll) => this.userGate(t, x, a, alt, poll),
        },
        onDeviceLine: line => Util.dev("< " + line),
      });
        this.showResult(true, I18N.t("res.ok.title"),
        I18N.t(mode === "cloud" ? "res.cloudOk.text" : "res.ok.text"));
    } catch (e) {
      Util.err(e.message + (e.hint ? " — " + e.hint : ""));
      this.markActiveStepFailed();
      this.showResult(false, I18N.t("res.fail.title"), this.failHtml(e));
    } finally {
      this.$("gateBox").classList.add("hidden");
      this.setBusy(false);
      this.renderHistory();
      }
  },

  markActiveStepFailed() {
    document.querySelectorAll("#stepList li.st-active").forEach(li => { li.className = "st-err"; });
  },

  /* -------------------------------------------------------------- history */
  renderHistory() {
    const box = this.$("historyBox");
    box.innerHTML = "";
    const list = Flows.history();
    if (!list.length) {
      box.textContent = I18N.t("history.empty");
      box.className = "history muted small";
      return;
    }
    box.className = "history";
    for (const h of list) {
      const row = document.createElement("div");
      row.className = "histrow " + (h.ok ? "hok" : "hfail");
      const when = new Date(h.date);
      row.textContent =
        when.toLocaleDateString() + " " + when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
        " · " + I18N.t(h.action) + (h.version ? " · " + h.version : "") +
        " · " + (h.ok ? I18N.t("hist.ok") : I18N.t("hist.fail")) +
        (h.seconds ? " (" + h.seconds + " s)" : "");
      box.appendChild(row);
    }
  },

  /* ------------------------------------------------------------- settings */

  applySettingsToUi() {
    this.$("inManifestUrl").value = localStorage.getItem("gata.manifestUrl") || "";
    this.$("chkDemo").checked = this.demo();
    this.$("chkDemoEsp").checked = localStorage.getItem("gata.demoEsp") !== "0";
    this.$("demoBanner").classList.toggle("hidden", !this.demo());
    this.$("selLang").value = I18N.lang;
    this.$("selLangDlg").value = I18N.lang;
  },

  changeLanguage(lang) {
    I18N.setLang(lang);
    this.applySettingsToUi();
    this.renderCaps();
    this.renderVersions();
    this.renderHistory();
    if (this.localMode) this.renderLocal();
    this.$("srcBadge").textContent = I18N.t(this.localMode ? "badge.local" : "badge.cloud");
  },

  wireEvents() {
    /* The one button everybody uses: newest software, everything the board
     * has. "both" already skips the ESP32 by itself when none is fitted. */
    this.$("btnBoard5").onclick = () => this.setBoard("rev5");
    this.$("btnBoard6").onclick = () => this.setBoard("rev6");
    this.$("btnUpdateNow").onclick = () => this.onUpdate("both");
    this.$("btnUpdCtrl").onclick = () => this.onUpdate("controller");
    this.$("btnUpdCloud").onclick = () => this.onUpdate("cloud");
    this.$("btnUpdBoth").onclick = () => this.onUpdate("both");
    this.$("btnCancel").onclick = () => { Flows.cancel(); Util.warn("Cancelling…"); };
    this.$("btnRefresh").onclick = () => this.loadManifest();
    this.$("btnRescan").onclick = () => this.scanLocal();

    this.$("btnUseLocal").onclick = () => {
      this.localMode = true;
      this.$("cloudPane").classList.add("hidden");
      this.$("localPane").classList.remove("hidden");
      this.$("srcBadge").textContent = I18N.t("badge.local");
      this.scanLocal();
    };
    this.$("btnUseCloud").onclick = () => {
      this.localMode = false;
      this.$("localPane").classList.add("hidden");
      this.$("cloudPane").classList.remove("hidden");
      this.$("srcBadge").textContent = I18N.t("badge.cloud");
    };

    this.$("btnLicActivate").onclick = () => this.onLicActivate();
    this.$("btnLicChange").onclick = () => {
      License.clear();
      this.manifest = null;
      this.renderVersions();
      this.renderLicense();
    };

    this.$("selLang").onchange = e => this.changeLanguage(e.target.value);
    this.$("selLangDlg").onchange = e => this.changeLanguage(e.target.value);

    this.$("btnSettings").onclick = () => this.$("dlgSettings").showModal();
    this.$("btnSettingsClose").onclick = () => {
      Cloud.setManifestUrl(this.$("inManifestUrl").value);
      localStorage.setItem("gata.demo", this.$("chkDemo").checked ? "1" : "0");
      localStorage.setItem("gata.demoEsp", this.$("chkDemoEsp").checked ? "1" : "0");
      this.$("dlgSettings").close();
      this.applySettingsToUi();
      this.loadManifest();
    };
    this.$("btnClearCache").onclick = async () => {
      try { indexedDB.deleteDatabase("gata-firmware-cache"); Cloud._db = null; } catch (e) { /* ignore */ }
      Util.ok(I18N.t("msg.cacheCleared"));
    };

    this.$("btnCopyLog").onclick = () => {
      navigator.clipboard.writeText(this.$("log").textContent).then(() => Util.ok("Log copied."));
    };
    this.$("btnSaveLog").onclick = () => {
      const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
      Util.saveTextFile("gata-update-log-" + stamp + ".txt", this.$("log").textContent);
    };
    this.$("btnClearLog").onclick = () => { this.$("log").textContent = ""; };
  },
};

window.addEventListener("DOMContentLoaded", () => App.init());
