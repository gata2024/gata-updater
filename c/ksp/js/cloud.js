/* GATA Cloud Uploader - cloud firmware source.
 *
 * The app reads a small JSON "manifest" from any HTTPS static host
 * (GitHub Pages / GitHub Releases / your own server) that lists the released
 * firmware packages. Files are downloaded on demand, SHA-256 verified and
 * cached in the browser (IndexedDB) so a package flashed once keeps working
 * offline.
 *
 * manifest.json shape (URLs are absolute or relative to the manifest):
 * {
 *   "product": "GATA Controller",
 *   "versions": [{
 *     "version": "15.4.26", "date": "2026-04-15", "notes": "…", "latest": true,
 *     "controller":  { "url": "controller_18_8_27.bin", "sha256": "…", "size": … },
 *     "system":      { "url": "system_18_8_27.bin",     "sha256": "…", "size": … },
 *     "esp": { "bootloader": {…}, "partitions": {…}, "boot_app0": {…}, "firmware": {…} }
 *   }]
 * }
 */
"use strict";

const Cloud = {
  get DEFAULT_MANIFEST_URL() { return APP_CONFIG.defaultManifestUrl; },
  _db: null,

  manifestUrl() {
    return store.getItem("gata.manifestUrl") || this.manifestUrlCandidates()[0];
  },
  setManifestUrl(url) {
    if (url && url.trim()) store.setItem("gata.manifestUrl", url.trim());
    else store.removeItem("gata.manifestUrl");
  },

  /* The channel this app serves: the license decides (legacy per-customer
   * packages keep their pinned config channel via License.legacyPinned()). */
  activeChannel() {
    if (typeof License !== "undefined" && License.licensed()) return License.channel();
    return APP_CONFIG.channel || "default";
  },

  /* A channel's manifest lives NEXT TO the default one: customers/<id>/
   * manifest.json under the same firmware root, for every source kind. */
  channelize(url, channel) {
    if (!channel || channel === "default") return url;
    /* A company's own copy of the app is configured with its channel manifest
     * ALREADY spelled out, so adding the folder again produced
     * .../customers/ksp/customers/ksp/manifest.json - a 404, and that app
     * could not see its firmware list at all. Only add what is missing. */
    if (url.indexOf("customers/" + channel + "/") !== -1) return url;
    return url.replace(/manifest\.json$/, "customers/" + channel + "/manifest.json");
  },

  /* Sources to try, best first. A URL set in Settings wins outright. */
  manifestUrlCandidates() {
    const custom = store.getItem("gata.manifestUrl");
    if (custom && custom.trim()) return [custom.trim()];
    const ch = this.activeChannel();
    const list = [];
    const local = location.hostname === "127.0.0.1" || location.hostname === "localhost";
    if (APP_CONFIG.cloudManifestUrl) list.push(this.channelize(APP_CONFIG.cloudManifestUrl, ch));
    if (local && APP_CONFIG.proxyManifestUrl) list.push(this.channelize(APP_CONFIG.proxyManifestUrl, ch));
    if (APP_CONFIG.defaultManifestUrl) list.push(this.channelize(APP_CONFIG.defaultManifestUrl, ch));
    return list;
  },

  /* Try each source until one answers. Transport failures fall through to the
   * next; a SIGNATURE failure never does - a forged list must stop the app,
   * not silently demote it to another source. */
  async fetchManifest() {
    const candidates = this.manifestUrlCandidates();
    let lastErr = null;
    for (let i = 0; i < candidates.length; i++) {
      try {
        const m = await this.fetchManifestFrom(candidates[i]);
        this._rememberManifest(m._rawBytes, m._rawSig);
        return m;
      } catch (e) {
        if (e && e.fatal) throw e;                 // signature verdict: stop here
        lastErr = e;
        if (i < candidates.length - 1) {
          Util.warn("Firmware source unavailable (" + candidates[i] + ") - trying the next one.");
        }
      }
    }

    /* Nothing answered - no signal, or the server is down. Fall back to the
     * list this device saw last time. It is re-checked against the pinned
     * signing key exactly like a fresh one, and firmware already downloaded
     * onto the device installs from its own cache, so a technician can finish
     * a job with no internet. */
    const kept = await this._rememberedManifest();
    if (kept) {
      Util.warn("No internet - using the firmware list saved on this device" +
                (kept.updated ? " (" + kept.updated + ")" : "") + ".");
      kept._offline = true;
      return kept;
    }
    throw lastErr || new UploaderError("No firmware source could be reached.");
  },

  /* --- the last good list, kept for working without internet -------------- */
  _keptKey() { return "gata.manifest." + this.activeChannel(); },

  _rememberManifest(bytes, sig) {
    try {
      if (!bytes || !sig) return;
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      store.setItem(this._keptKey(), JSON.stringify({ b: btoa(bin), s: sig }));
    } catch (e) { /* storage full or private mode - not fatal */ }
  },

  async _rememberedManifest() {
    let stored;
    try { stored = JSON.parse(store.getItem(this._keptKey()) || "null"); }
    catch (e) { return null; }
    if (!stored || !stored.b) return null;
    const bin = atob(stored.b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (APP_CONFIG.signingPublicKey) {
      const sigBytes = Uint8Array.from(atob(stored.s), c => c.charCodeAt(0));
      const ok = await this.verifySignedBytes(bytes, sigBytes, APP_CONFIG.signingPublicKey);
      if (!ok) { Util.err("The saved firmware list failed its signature check - ignoring it."); return null; }
    }
    let m;
    try { m = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { return null; }
    try { this.validateManifest(m); this._requireOwnChannel(m, "saved list"); }
    catch (e) { return null; }
    m._baseUrl = new URL(this.manifestUrlCandidates()[0], location.href);
    return m;
  },

  /* raw.githubusercontent serves with "Cache-Control: max-age=300", so for up
   * to five minutes after publishing, every app in the world is still told the
   * OLD list - a release looked missing, and taking one back looked ignored.
   * The same file read through the API is not behind that cache.
   *
   * Returns the address to read a file FRESH, or null when there is no fresher
   * way to read it than the address given. */
  freshUrl(url) {
    const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url);
    if (!m) return null;
    return "https://api.github.com/repos/" + m[1] + "/" + m[2] +
           "/contents/" + m[4] + "?ref=" + m[3];
  },

  /* The bytes of a file, whichever address style it is. The API answers with a
   * JSON envelope carrying the content base64-encoded; unwrapped here it is
   * byte-for-byte the file itself, so the signature check is unaffected. */
  async _fileBytes(url) {
    const viaApi = url.indexOf("api.github.com") !== -1;
    const res = await fetch(url, {
      cache: "no-store",
      headers: viaApi ? { "Accept": "application/vnd.github.v3+json" } : {},
    });
    if (!res.ok) {
      const e = new Error("HTTP " + res.status);
      e.status = res.status;
      throw e;
    }
    if (!viaApi) return new Uint8Array(await res.arrayBuffer());
    const j = await res.json();
    const b = atob(String(j.content || "").replace(/\n/g, ""));
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  },

  async fetchManifestFrom(url) {
    Util.info("Loading firmware list from " + url + " ...");

    /* Read it fresh when there is a way to; fall back to the plain address if
     * that fails for any reason (rate limit, no network route to the API). */
    let bytes = null;
    const fresh = this.freshUrl(url);
    if (fresh) {
      try {
        bytes = await this._fileBytes(fresh);
        this._sigBase = fresh;
      } catch (e) {
        Util.dev("fresh read unavailable (" + e.message + ") - using the cached address.");
      }
    }
    if (!bytes) {
      this._sigBase = url;
      try {
        bytes = await this._fileBytes(url);
      } catch (e) {
        if (e.status) {
          throw new UploaderError("Firmware server answered " + e.status + " for " + url + ".",
            "Check the server address under Settings.");
        }
        throw new UploaderError("Could not reach the firmware server (" + e.message + ").",
          "Check the internet connection, or check the server address under Settings.");
      }
    }
    if (APP_CONFIG.signingPublicKey) {
      await this._requireValidSignature(url, bytes);
    }
    let manifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      throw new UploaderError("The firmware list is not valid JSON (" + e.message + ").",
        "Check the manifest file on the server.");
    }
    this.validateManifest(manifest);
    this._requireOwnChannel(manifest, url);
    // Rollback watch: a compromised host could serve a VALIDLY signed but
    // OLD list to push users back to vulnerable firmware - flag it.
    try {
      const prev = store.getItem("gata.lastManifestDate") || "";
      const cur = String(manifest.updated || "");
      if (cur && prev && cur < prev) {
        Util.warn("SECURITY: the server offered an OLDER firmware list (" + cur +
                  " < last seen " + prev + ") - possible rollback, be careful.");
      }
      if (cur > prev) store.setItem("gata.lastManifestDate", cur);
    } catch (e) { /* storage unavailable - not fatal */ }
    manifest._baseUrl = new URL(url, location.href);
    manifest._rawBytes = bytes;                 // kept for the offline fallback
    manifest._rawSig = this._lastSigB64 || null;
    if (manifest.versions.length) {
      Util.ok("Firmware list loaded: " + manifest.versions.length + " version(s) available.");
    } else {
      /* Said plainly, because it is a deliberate state: everything was taken
       * back off the cloud. The app can still install from files on this
       * device - it just has nothing to download. */
      Util.warn("The firmware list is empty - nothing is published for " +
                (manifest.customer || "this company") + " right now.");
    }
    return manifest;
  },

  /* The manifest bytes MUST verify against the pinned public key. The private
   * key never leaves the release PC, so even a fully compromised web host
   * cannot make this app accept a foreign firmware list - and every file is
   * then checked against the SHA-256 hashes inside that verified list. */
  async _requireValidSignature(url, bytes) {
    /* The signature has to come from the SAME place as the list it signs. Read
     * fresh here but cached there (or the other way round) and a good release
     * looks forged: a five-minute-old signature against a new list. */
    const base = this._sigBase || url;
    /* ".sig" goes on the FILE NAME, which on the API address sits before the
     * query: .../contents/manifest.json.sig?ref=main */
    const sigUrl = base.indexOf("?") !== -1 ? base.replace("?", ".sig?") : base + ".sig";

    let raw = null;
    try { raw = await this._fileBytes(sigUrl); } catch (e) { /* treated as missing */ }
    if (!raw) {
      Util.err(I18N.t("err.sigMissing") + " (" + sigUrl + ")");   // must appear in the support log
      const e = new UploaderError(I18N.t("err.sigMissing"), I18N.t("hint.sig"));
      e.fatal = true;                              // never fall back to another source
      throw e;
    }
    let sig = null;
    let sigB64 = null;
    try {
      sigB64 = new TextDecoder().decode(raw).trim();
      sig = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
    }
    catch (e) { /* malformed base64 -> invalid */ }
    this._lastSigB64 = sigB64;      // kept so the list can be saved for offline use
    const ok = sig && sig.length >= 64 &&
      await this.verifySignedBytes(bytes, sig, APP_CONFIG.signingPublicKey);
    if (!ok) {
      Util.err(I18N.t("err.sigBad") + " (" + url + ")");
      const e = new UploaderError(I18N.t("err.sigBad"), I18N.t("hint.sig"));
      e.fatal = true;
      throw e;
    }
    Util.ok("Firmware list signature verified (ECDSA P-256).");
  },

  /* This app serves one customer channel (from the LICENSE, or pinned in a
   * legacy package); the channel id is part of the SIGNED manifest, so a
   * mixed-up or swapped URL cannot feed a customer another customer's
   * firmware. Older unsigned-era lists carry no channel field - those are
   * accepted only on the shared "default" channel. */
  _requireOwnChannel(manifest, url) {
    const mine = this.activeChannel();
    const theirs = (manifest.channel || "default");
    if (mine === theirs) return;
    Util.err(I18N.t("err.channel", { mine: mine, theirs: theirs }) + " (" + url + ")");
    const e = new UploaderError(I18N.t("err.channel", { mine: mine, theirs: theirs }),
                                I18N.t("hint.channel"));
    e.fatal = true;                 // wrong owner: never fall through to another source
    throw e;
  },

  /* Pure helper, also exercised by the self tests. */
  async verifySignedBytes(bytes, sigBytes, jwk) {
    try {
      const key = await crypto.subtle.importKey("jwk", jwk,
        { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sigBytes, bytes);
    } catch (e) { return false; }
  },

  /* Structural validation with actionable errors (run before anything trusts it). */
  validateManifest(m) {
    if (!m || !Array.isArray(m.versions)) {
      throw new UploaderError("The firmware list is malformed.",
        "The manifest must contain a \"versions\" array.");
    }
    /* An EMPTY list is a real answer, not a failure: it means nothing is
     * published for this company right now. Treating it as an error made the
     * app fall through to the copy saved on this device - so withdrawing
     * every release from a channel brought the withdrawn version back as
     * "Latest", which is the one outcome a withdrawal must never have. */
    m.versions.forEach((v, i) => {
      const where = "versions[" + i + "]";
      if (!v.version) throw new UploaderError("Manifest error: " + where + " has no \"version\".");
      if (!this.controllerEntry(v) || !this.controllerEntry(v).url) {
        throw new UploaderError("Manifest error: " + where + " has no controller software file.");
      }
      if (!this.systemEntry(v) || !this.systemEntry(v).url) {
        throw new UploaderError("Manifest error: " + where + " has no system firmware file.");
      }
      if (v.esp && !v.esp.firmware) {
        throw new UploaderError("Manifest error: " + where + ".esp needs at least esp.firmware.");
      }
    });
  },

  resolveUrl(manifest, fileUrl) {
    return new URL(fileUrl, manifest._baseUrl).href;
  },

  /* ------------------------------------------------------------ IndexedDB */

  _openDb() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("gata-firmware-cache", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },

  async _cacheGet(key) {
    try {
      const db = await this._openDb();
      const rec = await new Promise((resolve, reject) => {
        const tx = db.transaction("files", "readonly").objectStore("files").get(key);
        tx.onsuccess = () => resolve(tx.result || null);
        tx.onerror = () => reject(tx.error);
      });
      if (!rec) return null;
      return rec.data ? rec.data : rec;    // {data, ts} wrapper or legacy raw buffer
    } catch (e) { return null; }
  },

  async _cachePut(key, buffer) {
    try {
      const db = await this._openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("files", "readwrite").objectStore("files")
          .put({ data: buffer, ts: Date.now() }, key);
        tx.onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      await this._prune();
    } catch (e) { /* cache is best-effort */ }
  },

  /* Keep the cache bounded: drop the oldest entries beyond the limit. */
  async _prune() {
    const db = await this._openDb();
    const entries = await new Promise((resolve, reject) => {
      const out = [];
      const cur = db.transaction("files", "readonly").objectStore("files").openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) { resolve(out); return; }
        out.push({ key: c.key, ts: (c.value && c.value.ts) || 0 });
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
    if (entries.length <= APP_CONFIG.cacheMaxFiles) return;
    entries.sort((a, b) => a.ts - b.ts);
    const toDelete = entries.slice(0, entries.length - APP_CONFIG.cacheMaxFiles);
    await new Promise((resolve) => {
      const store = db.transaction("files", "readwrite").objectStore("files");
      for (const e of toDelete) store.delete(e.key);
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => resolve();
    });
    Util.info("Cache pruned: removed " + toDelete.length + " old firmware file(s).");
  },

  /* ------------------------------------------------------------ downloads */

  /* Download one file entry {url, sha256?, size?}; returns Uint8Array. */
  async download(manifest, entry, label, onProgress) {
    const url = this.resolveUrl(manifest, entry.url);
    const cacheKey = url + "|" + (entry.sha256 || "");

    const cached = await this._cacheGet(cacheKey);
    if (cached) {
      Util.info(label + ": using cached copy (" + Util.fmtBytes(cached.byteLength) + ").");
      if (onProgress) onProgress(1);
      return new Uint8Array(cached);
    }

    Util.info("Downloading " + label + " ...");
    let res;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch (e) {
      throw new UploaderError("Download failed for " + label + " (" + e.message + ").",
        "Check the internet connection. If the file is hosted on another domain, that server must allow CORS.");
    }
    if (!res.ok) throw new UploaderError("Server answered " + res.status + " for " + label + ".");

    const total = Number(res.headers.get("content-length")) || entry.size || 0;
    const chunks = [];
    let received = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress && total) onProgress(Math.min(received / total, 1));
    }
    const bytes = Util.concat(chunks);
    if (onProgress) onProgress(1);

    if (entry.sha256) {
      const got = await Util.sha256Hex(bytes);
      if (got.toLowerCase() !== entry.sha256.toLowerCase()) {
        throw new UploaderError("Checksum mismatch for " + label + " - download corrupted.",
          "Try again. If it keeps failing the file on the server does not match the manifest.");
      }
      Util.ok(label + ": downloaded and SHA-256 verified (" + Util.fmtBytes(bytes.length) + ").");
    } else {
      Util.warn(label + ": downloaded (" + Util.fmtBytes(bytes.length) + "), no checksum in manifest.");
    }

    await this._cachePut(cacheKey, bytes.buffer.slice(0));
    return bytes;
  },

  /* Which board a published version is for. Everything released before rev 6
   * existed carries no board field and is rev5-ONLY (older binaries do not
   * know the rev 6 pin map); "all" marks a unified binary that detects the
   * board itself at boot. */
  boardOf(v) { return v.board || "rev5"; },
  forBoard(versions, board) {
    return (versions || []).filter(v => {
      const b = this.boardOf(v);
      return b === "all" || b === (board || "rev5");
    });
  },

  /* The two controller files a version can carry. Releases published before
   * the naming was cleaned up call them "main" and "bootloaders.b1/.b3" (two
   * builds of the same system firmware that only differed by a version number,
   * flashed alternately to force the old update window). Both spellings are
   * accepted so older releases keep installing. */
  controllerEntry(ver) { return ver.controller || ver.main || null; },
  systemEntry(ver) {
    if (ver.system) return ver.system;
    if (ver.bootloaders) return ver.bootloaders.b1 || ver.bootloaders.b3 || null;
    return null;
  },

  /* Download what one version needs for the chosen action.
   * needs = { controller: bool, system: bool, esp: "no"|"optional"|"required" }
   * Returns { controller, system, esp: {bootloader,partitions,boot_app0,firmware}|null } */
  async downloadPackage(manifest, ver, onProgress, needs) {
    for (const k of Object.keys(needs || {})) {
      if (!["controller", "system", "esp"].includes(k)) {
        throw new UploaderError("Internal error: unknown download requirement '" + k + "'.");
      }
    }
    const n = Object.assign({ controller: true, system: true, esp: "optional" }, needs || {});
    const report = (name, frac) => { if (onProgress) onProgress(name, frac); };
    const pkg = { controller: null, system: null, esp: null };

    /* Package license: versions published with a .lic file are BOUND to a
     * channel and to their exact controller binary (by hash). The token must
     * verify against the pinned license key AND match this app's customer
     * license - so a package copied out of another customer's channel refuses
     * to install here. Versions without one (published before licensing) are
     * accepted as legacy. */
    if (ver.license && ver.license.url) {
      const licBytes = await this.download(manifest, ver.license, "Package license", () => {});
      let lic;
      try {
        lic = await License.verifyPackage(new TextDecoder().decode(licBytes));
      } catch (e) {
        const err = new UploaderError(I18N.t("err.pkgLic", { v: ver.version }) + " (" + e.message + ")",
          I18N.t("hint.pkgLic"));
        err.fatal = true;
        throw err;
      }
      const ctrl = this.controllerEntry(ver);
      const boundOk =
        lic.version === ver.version &&
        (lic.channel || "default") === this.activeChannel() &&
        (!ctrl || !ctrl.sha256 || !lic.controller ||
          lic.controller.toLowerCase() === ctrl.sha256.toLowerCase());
      if (!boundOk) {
        const err = new UploaderError(I18N.t("err.pkgLic", { v: ver.version }), I18N.t("hint.pkgLic"));
        err.fatal = true;
        throw err;
      }
      Util.ok("Package license verified: " + ver.version + " is licensed for this channel.");
    }

    if (n.controller) {
      const entry = this.controllerEntry(ver);
      if (!entry || !entry.url) throw new UploaderError("This version has no controller software file.");
      pkg.controller = await this.download(manifest, entry, "Controller software (" + entry.url + ")",
        f => report("Controller software", f));
    }

    if (n.system) {
      const entry = this.systemEntry(ver);
      if (!entry || !entry.url) throw new UploaderError("This version has no system firmware file.");
      pkg.system = await this.download(manifest, entry, "System firmware", f => report("System firmware", f));
    }

    if (n.esp !== "no") {
      if (ver.esp && ver.esp.firmware) {
        pkg.esp = {};
        for (const part of ["bootloader", "partitions", "boot_app0", "firmware"]) {
          if (ver.esp[part]) {
            pkg.esp[part] = await this.download(manifest, ver.esp[part], "ESP32 " + part,
              f => report("ESP32 " + part, f));
          }
        }
      } else if (n.esp === "required") {
        throw new UploaderError(I18N.t("err.noEspFiles"));
      }
    }
    return pkg;
  }
};

/* The alternating B1/B3 ping-pong is gone: the controller is asked to enter
 * update mode (backup register 30), and system firmware from 18.8.27 on comes
 * as ONE image. Only this cleanup of the old bookkeeping remains. */
try { store.removeItem("gata.lastBootloader"); } catch (e) { /* private mode */ }
