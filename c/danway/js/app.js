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

    /* The firmware stored on this device is the whole point of working with no
     * internet, and by default Android may throw it away when storage runs
     * short - on the day someone is standing at a pump station with no signal.
     * Ask for it to be kept. Installed apps are normally granted this without
     * a prompt; a refusal costs nothing, so it is never reported. */
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then(already => {
        if (!already) return navigator.storage.persist();
      }).catch(() => {});
    }

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      // Auto-refresh on deploys: when a new service worker (new APP_CONFIG
      // version) activates, reload so the tab can never keep running old code
      // - unless an update is in progress; then reload after it finishes.
      navigator.serviceWorker.register("sw.js").then(reg => {
        reg.update().catch(() => {});
        /* Ask the worker to re-check the firmware stored on this device.
         * Without this, replacing the firmware inside the app reached nobody:
         * the binaries are cached at install, and a deploy that only changes
         * a .bin leaves sw.js byte-identical, so no install/activate ever runs
         * again and the phone keeps serving the copy it stored on day one. */
        const refresh = () => {
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: "refresh-builtin" });
          }
        };
        refresh();
        navigator.serviceWorker.addEventListener("controllerchange", refresh);
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
    await this.detectOfflineSource();

    await License.loadStored();
    this.renderLicense();
    if (License.licensed()) {
      await this.loadManifest();
    }
  },

  /* --------------------------------------------------------------- license */
  /* Licensed is the normal state: it belongs in the footer as one quiet line,
   * next to the version. The card only appears when the app actually needs a
   * license file - i.e. when there is something for the user to DO. */
  renderLicense() {
    const lic = License.info();
    this.$("licenseCard").classList.toggle("hidden", !!lic);
    const line = this.$("licLine");
    line.classList.toggle("hidden", !lic);
    /* The company this copy belongs to is worth seeing at a glance - a badge
     * in the header, not a card in the way. */
    const badge = this.$("licBadge");
    badge.classList.toggle("hidden", !lic);
    if (lic) {
      badge.textContent = lic.customer;
      /* Tapping it swaps the license. On a phone there is no Settings dialog
       * in reach mid-job, and the app auto-licenses itself from the file that
       * ships with the site - without this a technician from another company
       * would have no obvious way to load their own license. */
      badge.title = I18N.t("lic.licensedTo") + " " + lic.customer + " (" + lic.channel + ")" +
                    (lic.exp ? " " + I18N.t("lic.until", { d: lic.exp }) : "") +
                    " — " + I18N.t("lic.change");
      this.$("licWho").textContent = lic.customer + " (" + lic.channel + ")";
      this.$("licExp").textContent = lic.exp ? I18N.t("lic.until", { d: lic.exp }) : "";
    }
  },

  async onLicFile(file) {
    const err = this.$("licError");
    err.classList.add("hidden");
    try {
      const text = (await file.text()).trim();
      await License.activate(text);
      this.renderLicense();
      store.removeItem("gata.lastManifestDate");   // channels have their own timeline
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

  /* The "files in the uploader folder" source only exists when the app is
   * served BY that folder - the little local server started by
   * CLICK_ME_START_ON_PC.bat / GATA_Updater.exe, which answers __local_list.
   * The phone app (and the hosted web app) load the site from the internet:
   * there is no uploader folder there, so the button would open an empty list
   * and look broken. Offer it only where it can actually work. */
  canUseLocal() {
    if (location.protocol === "file:") return true;
    return /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
  },

  /* Which firmware-without-the-internet source this copy has:
   *   "folder"  - served by the uploader folder's own little server (a PC)
   *   "builtin" - firmware that SHIPS WITH THE APP; the service worker stores
   *               it on the device at first start, so a phone can update with
   *               no signal at all
   *   null      - neither; only the cloud (and files the user picks)
   * The offline button is labelled for whichever one is real. */
  async detectOfflineSource() {
    this.offlineSource = null;
    if (this.canUseLocal()) {
      this.offlineSource = "folder";
    } else {
      try {
        const r = await fetch("builtin.json", { cache: "no-store" });
        if (r.ok) this.offlineSource = "builtin";
      } catch (e) { /* no built-in firmware published with this app */ }
    }
    const b = this.$("btnUseLocal");
    if (!b) return;
    b.classList.toggle("hidden", !this.offlineSource);
    if (this.offlineSource === "builtin") b.textContent = I18N.t("btn.useBuiltin");
    const hint = this.$("localHint");
    if (hint && this.offlineSource === "builtin") hint.textContent = I18N.t("local.hintBuiltin");
  },

  demo() { return store.getItem("gata.demo") === "1"; },

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
  board() { return store.getItem("gata.board") === "rev6" ? "rev6" : "rev5"; },
  setBoard(b) {
    store.setItem("gata.board", b);
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
      /* In its own element, not a bare text node: a text node inside a flex
       * row is an anonymous item that will not shrink below the width of its
       * longest word, so a name like 22_08_26_Danway_rev6 pushed straight
       * through the size beside it on a phone. */
      const label = document.createElement("span");
      label.className = "vlabel";
      label.textContent = I18N.t("ver.prefix") + " " + v.version;
      name.appendChild(label);
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
      /* Each fact in its own element - not text separated by <br>. Hiding a
       * <br> to re-flow this on a phone merged the neighbouring text runs into
       * one item, so the date and the size printed with nothing between them
       * ("2026-08-22874.7 KB"). */
      const meta = document.createElement("div");
      meta.className = "vmeta";
      const addMeta = (text, cls) => {
        if (!text) return;
        const el = document.createElement("span");
        el.className = cls;
        el.textContent = text;
        meta.appendChild(el);
      };
      addMeta(v.date, "vdate");
      /* The controller software, spelled out: how big it is and when it was
       * COMPILED - not when it was published. Releases carry both names for
       * the same file (the current "controller", the older "main"), and this
       * only ever looked at the old one, so the size never appeared at all on
       * anything published recently. */
      const ctrl = Cloud.controllerEntry(v);
      if (ctrl && ctrl.size) addMeta(Util.fmtBytes(ctrl.size), "vsize");
      if (ctrl && ctrl.built) addMeta(I18N.t("ver.built") + " " + ctrl.built, "vbuilt");
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

    /* What matters when looking at a file: how big it is and WHEN it was
     * built. (The checksum that blocks a swapped file is checked silently at
     * install time - no need to read hashes here.) */
    const det = (name, rel) => {
      const size = f.sizeOf ? f.sizeOf[name] : 0;
      const when = f.builtAt ? f.builtAt(rel) : null;
      let s = name;
      if (size) s += "  (" + Util.fmtBytes(size) + ")";
      if (when) s += "   ·   " + I18N.t("local.builtAt", { d: when });
      return s;
    };
    if (f.receipt) {
      const b = document.createElement("div");
      b.className = "lrow lok";
      b.innerHTML = "<b>" + I18N.t("local.receipt") + "</b><span>" +
        I18N.t("local.receiptFor", { c: f.receipt.company || "?", d: f.receipt.built || "?" }) + "</span>";
      list.appendChild(b);
    }

    // System firmware pair
    row(!!f.system, I18N.t("local.sys"),
      f.system ? det(f.system, "main_firmware/" + f.system)
               : I18N.t("local.missing") + " (system*.bin)");

    // Controller software (radio choice when several M*.bin exist)
    if (!f.mains.length) {
      row(false, I18N.t("local.main"), I18N.t("local.missing") + " (M*.bin)");
      this.localMainSel = null;
    } else if (f.mains.length === 1) {
      this.localMainSel = f.mains[0].name;
      row(true, I18N.t("local.main"),
        det(f.mains[0].name, "main_firmware/" + f.mains[0].name));
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
    /* A delivery receipt that lists no cloud-module files means this software
     * was prepared WITHOUT one (boards with no ESP32). That is a normal state,
     * not a missing file - showing it in red made a correct delivery look
     * broken. Folders filled in by hand have no receipt, so those keep the
     * "not found" wording. */
    const receiptHasEsp = !!(f.receipt && f.receipt.files &&
      Object.keys(f.receipt.files).some(k => k.indexOf("cloud_firmware/") === 0));
    const espDeliberatelyNone = !f.esp.firmware && !!f.receipt && !receiptHasEsp;

    let espDetail = f.espComplete ? I18N.t("local.espComplete")
      : (f.esp.firmware ? I18N.t("local.espFwOnly")
      : (espDeliberatelyNone ? I18N.t("local.espNotIncluded")
      : I18N.t("local.missing") + " (cloud_firmware) — " + I18N.t("opt")));
    if (f.esp.firmware) {
      const espSize = f.sizeOf ? f.sizeOf[f.esp.firmware] : 0;
      const espWhen = f.builtAt ? f.builtAt("cloud_firmware/" + f.esp.firmware) : null;
      if (espSize) espDetail += "  (" + Util.fmtBytes(espSize) + ")";
      if (espWhen) espDetail += "   ·   " + I18N.t("local.builtAt", { d: espWhen });
    }
    row(!!f.esp.firmware || espDeliberatelyNone, I18N.t("local.esp"), espDetail);

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
      /* Erasing installs nothing - the only rows that mean anything are
       * reaching the controller and the erase itself. */
      erase: ["download", "system", "esp", "wipe", "finish"],
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
      let cancelTimer = null;
      let finish = (ok, value) => {
        if (pollTimer) clearInterval(pollTimer);
        if (cancelTimer) clearInterval(cancelTimer);
        box.classList.add("hidden");
        btn.classList.remove("hidden");        // restore for any other user
        if (ok) resolve(value); else reject(value);
      };

      /* CANCEL has to reach the gate too.
       *
       * This screen waits for a button press and nothing else, so pressing
       * Cancel only set a flag that nobody here was watching: the log said
       * "Cancelling…" and then the gate just sat there, still waiting, with
       * the update neither running nor finished. Watch the flag and end the
       * same way any other failure does, so the whole flow unwinds and the
       * buttons come back. */
      cancelTimer = setInterval(() => {
        if (Flows.cancelRequested) finish(false, new UploaderError(I18N.t("err.cancelled")));
      }, 200);
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
  /* Which controller, and in which state - asked as the FIRST thing after the
   * button is pressed.
   *
   * It used to open the serial picker here and only ask "running, or in update
   * mode?" much later, from inside the flow - after the download and often
   * after the system firmware had already been written. A board sitting in
   * BOOT mode is not a serial port, so its picker was empty, and the person
   * waited through a download before being asked the one question that
   * decides everything. Now the choice comes first and the download runs
   * underneath it.
   *
   * Returns { serial } or { dfu }, or null when nothing was reachable. A
   * controller that is already approved is used straight away and nothing is
   * shown at all. */
  async preConnect() {
    if (this.demo()) return null;
    try {
      /* ALWAYS ask, and ask FIRST - for every kind of install: UPDATE, update
       * controller, update cloud module, controller + cloud, and erase.
       *
       * It used to answer itself whenever the browser already had permission
       * for some controller, which took the decision away: a board sitting in
       * update mode could not be chosen while an authorized serial port
       * existed. There is also no automatic continue here any more, for the
       * same reason - the person says which state the board is in, and that
       * is the first thing that happens. */
      return await this.userGate(
        I18N.t("gate.run.btn"),
        I18N.t("gate.connect.text") + " " +
          I18N.t(Transport.isAndroid() ? "gate.connect.tipMobile" : "gate.connect.tipPc"),
        async () => ({ serial: await Transport.request() }),
        { label: I18N.t("gate.boot.btn"), action: async () => ({ dfu: await DfuSeDevice.requestDevice() }) });
    } catch (e) {
      /* Cancel is a decision, not a hiccup - carrying on regardless would
       * start the very update that was just called off. */
      if (Flows.cancelRequested) throw e;
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
  /* Windows only, and only when the app is served by the uploader folder's own
   * little server: ask that server whether the controller's update-mode driver
   * is in place, and have it installed if it is not.
   *
   * A web page cannot look at Windows drivers, let alone install one - but the
   * server is on the same PC, in the same folder, so it can. Without this the
   * only way forward was for someone to find tools\INSTALL_DFU_DRIVER.bat and
   * know to run it.
   *
   * Returns true when it installed the driver (so the caller stops explaining
   * and the person can simply try again). */
  async offerDriverInstall() {
    if (!this.canUseLocal()) return false;          // hosted app: no server of ours
    try {
      const st = await (await fetch("__driver_status", { cache: "no-store" })).json();
      if (!st || !st.present || st.bound) return false;   // not the driver's fault

      Util.warn("The controller IS plugged in and in update mode, but Windows has no " +
                "driver attached to it yet - that is why it does not appear in the list.");
      Util.info("Installing it now - approve the Windows prompt, and that is the only thing " +
                "you have to do. Nothing is downloaded; the board is pointed at the driver " +
                "already built into Windows.");
      const res = await (await fetch("__install_driver", { cache: "no-store" })).json();
      if (res && res.ok) {
        Util.ok("USB driver installed - press the same button again and the controller will be there.");
        return true;
      }
      if (res && res.tool) {
        /* Windows' own driver cannot be forced onto this board on Windows 11,
         * so the bundled tool - which carries its own signed package - has
         * been opened instead. Three clicks, once per PC. */
        Util.warn("Windows could not attach its own driver to this board, so the driver tool " +
                  "has been opened for you.");
        Util.info("In that window: pick \"DFU in FS Mode\" at the top, make sure the driver on " +
                  "the right says WinUSB, then press Install Driver. It takes a few seconds.");
        Util.info("When it says success, come back here and press the same button again.");
        return true;
      }
      Util.err("The driver was not installed: " + ((res && res.message) || "unknown reason") + ".");
      Util.info("You can also do it by hand: run tools\\INSTALL_DFU_DRIVER.bat from this " +
                "uploader folder with the board in update mode.");
      return true;                                   // explained; no need to say more
    } catch (e) {
      /* An older folder has no such endpoint - fall through to the advice. */
      Util.dev("driver check unavailable (" + e.message + ")");
      return false;
    }
  },

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
      } else if (Transport.isWindows() && await this.offerDriverInstall()) {
        /* handled: the driver was missing and has just been installed */
      } else if (Transport.isWindows()) {
        /* On Windows a controller in update mode does not appear to the
         * browser at all until the driver is bound to it, so an empty list
         * usually means the driver, not the cable. Saying "check the cable"
         * here sent people hunting the wrong fault. */
        Util.warn("No controller in the list. On Windows a controller in UPDATE MODE stays " +
                  "invisible to the browser until its driver is installed — this is the most " +
                  "common cause.");
        Util.warn("Fix it once: with the board in update mode, run " +
                  "tools\\INSTALL_DFU_DRIVER.bat from this uploader folder (it asks for " +
                  "administrator once and uses Windows' own driver). Then try again.");
        Util.info("If the driver is already installed: check the cable and that the controller " +
                  "is powered, and close any other program using it.");
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
      /* Erasing the controller software installs nothing - but a board sitting
       * in BOOT mode has no bootloader to take the command, so the system
       * firmware has to go in first. Nothing else is downloaded. */
      system: { controller: false, system: true, esp: "no" },
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
    /* Clear any cancel left over from a previous attempt. The flag used to be
     * reset inside runFullUpdate, which is now reached only AFTER the connect
     * question - so a cancelled run left the flag set and the next press was
     * cancelled before it began. */
    Flows.cancelRequested = false;
    this.setBusy(true);
    this.resetSteps(mode);
    try {
      /* Ask for the controller NOW, while this click still counts as a user
       * gesture - browsers only open the device chooser during one. Doing it
       * here means one tap: the chooser appears immediately instead of a
       * second "connect" button appearing minutes later, after the download,
       * when the gesture is long gone. Already-approved controllers skip it
       * entirely and nothing is ever shown. */
      /* ASK FIRST, then download, then install - one thing at a time.
       *
       * The question comes before everything else because it is the decision
       * the whole update hangs on. It must not run AT THE SAME TIME as the
       * download either: when it did, the picker and its "no device picked"
       * retries landed on top of the download messages and the flow fell
       * apart. So: answer the question, then fetch the software, then work. */
      const picked = await this.preConnect();

      const { pkg, version } = await this.getPackage(mode);

      await Flows.runFullUpdate({
        mode, pkg, version,
        preConnected: picked && picked.serial ? picked.serial : null,
        preDfu: picked && picked.dfu ? picked.dfu : null,
        board: this.board(),
        firstInstall: !!(this.$("chkFirstInstall") && this.$("chkFirstInstall").checked),
        demo: this.demo(),
        demoHasEsp: store.getItem("gata.demoEsp") !== "0",
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
    this.$("inManifestUrl").value = store.getItem("gata.manifestUrl") || "";
    this.$("chkDemo").checked = this.demo();
    this.$("chkDemoEsp").checked = store.getItem("gata.demoEsp") !== "0";
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
    /* "Scan again" belongs to the folder/built-in sources; for hand-picked
     * files it would throw away what the user just chose, so re-open the
     * picker instead. */
    this.$("btnRescan").onclick = () => {
      if (this.localFound && this.localFound.picked) pick();
      else this.scanLocal();
    };

    this.$("btnUseLocal").onclick = () => {
      this.localMode = true;
      this.$("cloudPane").classList.add("hidden");
      this.$("localPane").classList.remove("hidden");
      this.$("srcBadge").textContent = I18N.t("badge.local");
      this.scanLocal();
    };
    this.$("btnUseCloud").onclick = () => {
      this.localMode = false;
      this.localFound = null;                 // drop anything picked by hand
      this.$("localPane").classList.add("hidden");
      this.$("cloudPane").classList.remove("hidden");
      this.$("srcBadge").textContent = I18N.t("badge.cloud");
      this.$("localHint").textContent =
        I18N.t(this.offlineSource === "builtin" ? "local.hintBuiltin" : "local.hint");
    };

    /* Firmware files chosen from the device itself - works on a phone with no
     * internet and no uploader folder. */
    const pick = () => this.$("fwFiles").click();
    this.$("btnPickFiles").onclick = pick;
    this.$("btnPickFiles2").onclick = pick;
    this.$("fwFiles").onchange = async e => {
      const files = e.target.files;
      e.target.value = "";
      if (!files || !files.length) return;
      const found = await LocalSource.fromFiles(files);
      if (!found || (!found.system && !found.mains.length && !found.esp.firmware)) {
        Util.err(I18N.t("local.pickNothing"));
        return;
      }
      this.localFound = found;
      this.localMainSel = found.mains.length ? found.mains[0].name : null;
      this.localMode = true;
      this.$("cloudPane").classList.add("hidden");
      this.$("localPane").classList.remove("hidden");
      this.$("srcBadge").textContent = I18N.t("badge.picked");
      this.$("localHint").textContent = I18N.t("local.hintPicked");
      this.renderLocal();
    };

    this.$("btnLicOpen").onclick = () => this.$("licFile").click();
    this.$("licBadge").onclick = () => this.$("licFile").click();   // change it from anywhere
    this.$("licFile").onchange = e => {
      if (e.target.files && e.target.files[0]) this.onLicFile(e.target.files[0]);
      e.target.value = "";
    };
    this.$("btnLicChange").onclick = async () => {
      License.clear();
      this.manifest = null;
      this.renderVersions();
      this.renderLicense();
      this.$("dlgSettings").close();
      /* A bundled gata.license would re-license the app on the next start;
       * "change" means pick a DIFFERENT file, so open the picker now. */
      this.$("licFile").click();
    };

    this.$("selLang").onchange = e => this.changeLanguage(e.target.value);
    this.$("selLangDlg").onchange = e => this.changeLanguage(e.target.value);

    this.$("btnSettings").onclick = () => this.$("dlgSettings").showModal();
    this.$("btnSettingsClose").onclick = () => {
      Cloud.setManifestUrl(this.$("inManifestUrl").value);
      store.setItem("gata.demo", this.$("chkDemo").checked ? "1" : "0");
      store.setItem("gata.demoEsp", this.$("chkDemoEsp").checked ? "1" : "0");
      this.$("dlgSettings").close();
      this.applySettingsToUi();
      this.loadManifest();
    };
    this.$("btnClearCache").onclick = async () => {
      try { indexedDB.deleteDatabase("gata-firmware-cache"); Cloud._db = null; } catch (e) { /* ignore */ }
      Util.ok(I18N.t("msg.cacheCleared"));
    };

    /* The escape hatch: a controller with no software waits for ever, so it
     * can always be reached - even if it used to start its old software
     * before the updater could connect. */
    this.$("btnEraseApp").onclick = async () => {
      if (this.busy) return;
      if (!this.requireLicense()) return;
      if (!confirm(I18N.t("adv.eraseConfirm"))) return;
      Flows.cancelRequested = false;
      this.setBusy(true);
      this.$("logCard").open = true;
      try {
        /* The question first here too. Only a board in BOOT mode needs the
         * system firmware fetched (there is no bootloader on it yet to take
         * the erase command), so asking first also means not downloading
         * anything at all when the controller is simply running. */
        const picked = await this.preConnect();
        const needsSystem = !!(picked && picked.dfu) || !picked;
        const got = !needsSystem ? null : await this.getPackage("system").catch(e => {
          Util.warn("Could not fetch the system firmware (" + e.message +
                    ") - BOOT mode will not be available for this erase.");
          return null;
        });
        /* Show the same step rows an update uses, so the erase has a bar
           instead of a still screen for half a minute. */
        this.resetSteps("erase");
        await Flows.runEraseApp({
          demo: this.demo(),
          pkg: got ? got.pkg : null,
          board: this.board(),
          preConnected: picked && picked.serial ? picked.serial : null,
          preDfu: picked && picked.dfu ? picked.dfu : null,
          ui: {
            step: (a, b, c, d) => this.step(a, b, c, d),
            userGate: (t, x, a, alt, poll) => this.userGate(t, x, a, alt, poll),
          },
          onDeviceLine: line => Util.dev("< " + line),
          onTick: sec => Util.info(I18N.t("d.extEraseSec", { t: Math.round(sec) })),
        });
        this.showResult(true, I18N.t("adv.eraseDone"));
      } catch (e) {
        Util.err(e.message + (e.hint ? " — " + e.hint : ""));
        this.showResult(false, e.message);
      } finally {
        this.setBusy(false);
      }
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
