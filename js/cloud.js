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
 *     "main":        { "url": "M_15_4_26.bin", "sha256": "…", "size": 296368 },
 *     "bootloaders": { "b1": {…}, "b3": {…} },
 *     "esp": { "bootloader": {…}, "partitions": {…}, "boot_app0": {…}, "firmware": {…} }
 *   }]
 * }
 */
"use strict";

const Cloud = {
  get DEFAULT_MANIFEST_URL() { return APP_CONFIG.defaultManifestUrl; },
  _db: null,

  manifestUrl() {
    return localStorage.getItem("gata.manifestUrl") || this.manifestUrlCandidates()[0];
  },
  setManifestUrl(url) {
    if (url && url.trim()) localStorage.setItem("gata.manifestUrl", url.trim());
    else localStorage.removeItem("gata.manifestUrl");
  },

  /* Sources to try, best first. A URL set in Settings wins outright. */
  manifestUrlCandidates() {
    const custom = localStorage.getItem("gata.manifestUrl");
    if (custom && custom.trim()) return [custom.trim()];
    const list = [];
    const local = location.hostname === "127.0.0.1" || location.hostname === "localhost";
    if (local && APP_CONFIG.proxyManifestUrl) list.push(APP_CONFIG.proxyManifestUrl);
    if (APP_CONFIG.cloudManifestUrl) list.push(APP_CONFIG.cloudManifestUrl);
    if (APP_CONFIG.defaultManifestUrl) list.push(APP_CONFIG.defaultManifestUrl);
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
        return await this.fetchManifestFrom(candidates[i]);
      } catch (e) {
        if (e && e.fatal) throw e;                 // signature verdict: stop here
        lastErr = e;
        if (i < candidates.length - 1) {
          Util.warn("Firmware source unavailable (" + candidates[i] + ") - trying the next one.");
        }
      }
    }
    throw lastErr || new UploaderError("No firmware source could be reached.");
  },

  async fetchManifestFrom(url) {
    Util.info("Loading firmware list from " + url + " ...");
    let res;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch (e) {
      throw new UploaderError("Could not reach the firmware server (" + e.message + ").",
        "Check the internet connection, or check the server address under Settings.");
    }
    if (!res.ok) {
      throw new UploaderError("Firmware server answered " + res.status + " for " + url + ".",
        "Check the server address under Settings.");
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
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
    // Rollback watch: a compromised host could serve a VALIDLY signed but
    // OLD list to push users back to vulnerable firmware - flag it.
    try {
      const prev = localStorage.getItem("gata.lastManifestDate") || "";
      const cur = String(manifest.updated || "");
      if (cur && prev && cur < prev) {
        Util.warn("SECURITY: the server offered an OLDER firmware list (" + cur +
                  " < last seen " + prev + ") - possible rollback, be careful.");
      }
      if (cur > prev) localStorage.setItem("gata.lastManifestDate", cur);
    } catch (e) { /* storage unavailable - not fatal */ }
    manifest._baseUrl = new URL(url, location.href);
    Util.ok("Firmware list loaded: " + manifest.versions.length + " version(s) available.");
    return manifest;
  },

  /* The manifest bytes MUST verify against the pinned public key. The private
   * key never leaves the release PC, so even a fully compromised web host
   * cannot make this app accept a foreign firmware list - and every file is
   * then checked against the SHA-256 hashes inside that verified list. */
  async _requireValidSignature(url, bytes) {
    let res = null;
    try { res = await fetch(url + ".sig", { cache: "no-store" }); } catch (e) { /* treated as missing */ }
    if (!res || !res.ok) {
      Util.err(I18N.t("err.sigMissing") + " (" + url + ".sig)");   // must appear in the support log
      const e = new UploaderError(I18N.t("err.sigMissing"), I18N.t("hint.sig"));
      e.fatal = true;                              // never fall back to another source
      throw e;
    }
    let sig = null;
    try { sig = Uint8Array.from(atob((await res.text()).trim()), c => c.charCodeAt(0)); }
    catch (e) { /* malformed base64 -> invalid */ }
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
    if (!m || !Array.isArray(m.versions) || !m.versions.length) {
      throw new UploaderError("The firmware list is empty or malformed.",
        "The manifest must contain a non-empty \"versions\" array.");
    }
    m.versions.forEach((v, i) => {
      const where = "versions[" + i + "]";
      if (!v.version) throw new UploaderError("Manifest error: " + where + " has no \"version\".");
      if (!v.main || !v.main.url) throw new UploaderError("Manifest error: " + where + " has no main.url.");
      if (v.bootloaders && (!v.bootloaders.b1 || !v.bootloaders.b3)) {
        throw new UploaderError("Manifest error: " + where + " must list BOTH bootloaders.b1 and b3.");
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

  /* Download what one version needs for the chosen action.
   * needs = { main: bool, boot: bool, esp: "no" | "optional" | "required" }
   * Returns { main, b1, b3, esp: {bootloader,partitions,boot_app0,firmware} | null } */
  async downloadPackage(manifest, ver, onProgress, needs) {
    const n = Object.assign({ main: true, boot: true, esp: "optional" }, needs || {});
    const report = (name, frac) => { if (onProgress) onProgress(name, frac); };
    const pkg = { main: null, b1: null, b3: null, esp: null };

    if (n.main) {
      if (!ver.main || !ver.main.url) throw new UploaderError("This version has no main application file.");
      pkg.main = await this.download(manifest, ver.main, "Application (" + ver.main.url + ")",
        f => report("Application", f));
    }

    if (n.boot) {
      if (ver.bootloaders && ver.bootloaders.b1 && ver.bootloaders.b3) {
        pkg.b1 = await this.download(manifest, ver.bootloaders.b1, "System firmware B1", f => report("System B1", f));
        pkg.b3 = await this.download(manifest, ver.bootloaders.b3, "System firmware B3", f => report("System B3", f));
      } else {
        throw new UploaderError("This version is missing the B1/B3 system firmware files.");
      }
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

/* B1/B3 ping-pong (same idea as .last_bootloader.txt next to the Python tool):
 * the bootloader only opens its update window when the freshly flashed system
 * firmware has a DIFFERENT version than the one stored in the RTC backup
 * register - so we alternate between the two builds on every update. */
const PingPong = {
  next() {
    const last = localStorage.getItem("gata.lastBootloader");
    return last === "B1" ? "B3" : "B1";     // first run -> B1, like the Python tool
  },
  commit(name) { localStorage.setItem("gata.lastBootloader", name); },
};
