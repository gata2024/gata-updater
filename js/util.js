/* GATA Cloud Uploader - small shared utilities */
"use strict";

/* Every company's app lives on the SAME origin - the shared one at
 * /gata-updater/ and one per company at /gata-updater/c/<id>/ - and
 * localStorage is per-ORIGIN, not per-folder. An unprefixed key is therefore
 * literally the same key in all of them, which is how one company's manifest
 * override or license could surface inside another company's app. Every key
 * is scoped to the channel instead; "gata.x" and "gata.ksp.x" cannot collide.
 *
 * Call sites keep writing the familiar "gata.something" names - the prefix is
 * applied here, in one place. */
const store = {
  prefix: "gata." + ((typeof APP_CONFIG !== "undefined" &&
                      APP_CONFIG.channel && APP_CONFIG.channel !== "default")
                       ? APP_CONFIG.channel + "." : ""),
  key(k) { return this.prefix + String(k).replace(/^gata\./, ""); },
  getItem(k) { try { return localStorage.getItem(this.key(k)); } catch (e) { return null; } },
  setItem(k, v) { try { localStorage.setItem(this.key(k), v); } catch (e) { /* private mode / full */ } },
  removeItem(k) { try { localStorage.removeItem(this.key(k)); } catch (e) { } },
};

const Util = {
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

  hex(n, width) {
    return "0x" + n.toString(16).toUpperCase().padStart(width || 8, "0");
  },

  fmtBytes(n) {
    if (n == null) return "?";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  },

  async sha256Hex(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  },

  concat(chunks) {
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  },

  /* Offer a text file as a download (used for saving the technical log). */
  saveTextFile(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },

  // ---------------------------------------------------------------- logging
  _logListeners: [],
  onLog(cb) { this._logListeners.push(cb); },
  log(msg, cls) {
    const line = { time: new Date(), msg: String(msg), cls: cls || "info" };
    console.log("[" + line.cls + "] " + line.msg);
    for (const cb of this._logListeners) { try { cb(line); } catch (e) { /* ignore */ } }
  },
  info(msg) { this.log(msg, "info"); },
  ok(msg) { this.log(msg, "ok"); },
  warn(msg) { this.log(msg, "warn"); },
  err(msg) { this.log(msg, "err"); },
  dev(msg) { this.log(msg, "dev"); },   // device -> host traffic
};

/* Error type that carries a user-friendly hint on how to fix the problem. */
class UploaderError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = "UploaderError";
    this.hint = hint || "";
  }
}
