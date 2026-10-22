/* GATA Cloud Uploader - license keys.
 *
 * ONE app for every customer; a signed license decides which firmware channel
 * it serves. A license is a compact token issued by tools\make_license.ps1:
 *
 *     GATA1.<base64url payload JSON>.<base64url ECDSA P-256 signature>
 *
 *     payload = { customer:"KSP", channel:"ksp", issued:"2026-08-20",
 *                 exp:null|"YYYY-MM-DD", id:"L-0007" }
 *
 * The signature covers the raw payload JSON bytes and verifies OFFLINE against
 * the public key pinned in config.js - no server, and no secret inside the
 * app (nobody can mint licenses from the shipped code). The manifest's own
 * channel check stays downstream, so even a tampered localStorage cannot
 * cross-load another customer's firmware list.
 *
 * Legacy: app copies with a channel pinned in config.js (the old per-customer
 * packages) are grandfathered - the package itself was the license.
 */
"use strict";

const License = {
  KEY: "gata.license",
  MANUAL_KEY: "gata.licenseManual",   // the user opened a license file by hand
  _info: null,          // verified payload, or null

  _b64uToBytes(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },

  /* Legacy per-customer package? Then the license system is bypassed. */
  legacyPinned() {
    return !!(APP_CONFIG.channel && APP_CONFIG.channel !== "default");
  },

  /* Parse + verify a token. Returns the payload, or throws a friendly error. */
  async verify(token) {
    token = String(token || "").trim();
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "GATA1") {
      throw new Error(I18N.t("lic.badFormat"));
    }
    if (!APP_CONFIG.licensePublicKey) {
      throw new Error("This build has no license public key pinned (run tools\\make_license.ps1).");
    }
    const payloadBytes = this._b64uToBytes(parts[1]);
    const sigBytes = this._b64uToBytes(parts[2]);
    let ok = false;
    try {
      const key = await crypto.subtle.importKey("jwk", APP_CONFIG.licensePublicKey,
        { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sigBytes, payloadBytes);
    } catch (e) { ok = false; }
    if (!ok) throw new Error(I18N.t("lic.badSig"));
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(payloadBytes)); }
    catch (e) { throw new Error(I18N.t("lic.badFormat")); }
    if (payload.t || !payload.channel || !payload.customer) throw new Error(I18N.t("lic.badFormat"));
    if (payload.exp) {
      const today = new Date().toISOString().slice(0, 10);
      if (today > payload.exp) throw new Error(I18N.t("lic.expired", { d: payload.exp }));
    }
    return payload;
  },

  /* PACKAGE licenses: every published version carries a .lic token that binds
   * that exact software (by hash) to a channel. Same signature machinery,
   * different payload shape (t:"pkg", no customer) - so a customer license
   * can never be replayed as a package license or the other way round. */
  async verifyPackage(token) {
    token = String(token || "").trim();
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "GATA1") throw new Error(I18N.t("lic.badFormat"));
    if (!APP_CONFIG.licensePublicKey) throw new Error("No license public key pinned in this build.");
    const payloadBytes = this._b64uToBytes(parts[1]);
    const sigBytes = this._b64uToBytes(parts[2]);
    let ok = false;
    try {
      const key = await crypto.subtle.importKey("jwk", APP_CONFIG.licensePublicKey,
        { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sigBytes, payloadBytes);
    } catch (e) { ok = false; }
    if (!ok) throw new Error(I18N.t("lic.badSig"));
    let p;
    try { p = JSON.parse(new TextDecoder().decode(payloadBytes)); }
    catch (e) { throw new Error(I18N.t("lic.badFormat")); }
    if (p.t !== "pkg" || !p.version) throw new Error(I18N.t("lic.badFormat"));
    return p;
  },

  /* Verify + store a license the USER opened. Returns the payload; throws on
   * a bad token. Marked manual so it is not overridden by the folder's own
   * file on the next start. */
  async activate(token) {
    const payload = await this.verify(token);
    store.setItem(this.KEY, String(token).trim());
    store.setItem(this.MANUAL_KEY, "1");
    this._info = payload;
    Util.ok("License activated: " + payload.customer + " (channel " + payload.channel + ").");
    return payload;
  },

  /* Re-verify whatever is stored (app start). Drops a broken/expired token.
   * When nothing is stored, look for the BUNDLED license file: the uploader
   * is handed to a customer with their `gata.license` file inside the folder,
   * so the app licenses itself on first start - but the file is VERIFIED like
   * any other license, never trusted just for being included. */
  async loadStored() {
    this._info = null;
    if (this.legacyPinned()) {
      this._info = { customer: APP_CONFIG.customerName || APP_CONFIG.channel,
                     channel: APP_CONFIG.channel, legacy: true };
      return this._info;
    }

    /* THE FOLDER WINS. Every uploader folder runs on the same local address,
     * so the browser shares one storage between them: a licence remembered
     * from another company's folder would otherwise stick and the app would
     * announce the wrong customer. The license file shipped WITH this folder
     * is the authority - unless the user deliberately opened a different
     * license file on this device (then their choice is kept). */
    const manual = store.getItem(this.MANUAL_KEY) === "1";
    if (!manual) {
      const bundled = await this.loadBundled();
      if (bundled) return bundled;
    }

    const token = store.getItem(this.KEY);
    if (token) {
      try {
        this._info = await this.verify(token);
        return this._info;
      } catch (e) {
        Util.warn("Stored license rejected: " + e.message);
        store.removeItem(this.KEY);
      }
    }
    return manual ? await this.loadBundled() : null;
  },

  /* The license file shipped inside the uploader folder (next to index.html).
   * Absent file = simply unlicensed; a PRESENT but invalid file is reported. */
  BUNDLED_FILE: "gata.license",
  async loadBundled() {
    if (location.protocol === "file:") return null;   // fetch() cannot read local files there
    let text = null;
    try {
      const res = await fetch(this.BUNDLED_FILE, { cache: "no-store" });
      if (res.ok) text = (await res.text()).trim();
    } catch (e) { /* offline or not bundled - fine */ }
    if (!text || !text.startsWith("GATA1.")) return null;
    try {
      this._info = await this.verify(text);
      store.setItem(this.KEY, text);       // works offline from now on
      store.removeItem(this.MANUAL_KEY);   // this came from the folder
      Util.ok("License file found with the uploader: " + this._info.customer +
              " (channel " + this._info.channel + ").");
    } catch (e) {
      Util.warn("The bundled license file was rejected: " + e.message);
      this._info = null;
    }
    return this._info;
  },

  clear() {
    store.removeItem(this.KEY);
    store.removeItem(this.MANUAL_KEY);
    this._info = null;
  },

  info() { return this._info; },
  licensed() { return !!this._info; },
  channel() { return this._info ? (this._info.channel || "default") : "default"; },
};
