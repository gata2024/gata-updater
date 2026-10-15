/* GATA Cloud Uploader - "local folder" firmware source.
 *
 * Works like the original USB_Uploder: the firmware files sit in the uploader
 * folder and are discovered automatically - no file picking. Layout:
 *
 *   main_firmware/system*.bin         system firmware (legacy: B1.bin / B3.bin)
 *   main_firmware/controller*.bin     controller software (legacy: M*.bin)
 *   cloud_firmware/bootloader.bin, partitions.bin, boot_app0.bin, firmware.bin
 *
 * Discovery uses the local server's /__local_list endpoint (started by
 * CLICK_ME_START_ON_PC.bat). On a plain static host - where directories
 * cannot be listed - it falls back to probing the standard fixed names.
 */
"use strict";

const LocalSource = {
  MAIN_DIR: "main_firmware",
  CLOUD_DIR: "cloud_firmware",
  BASE: "",                  // prefix for all URLs ("" = app root; tests use "../")

  _url(p) { return this.BASE + p; },
  _asArray(x) { return Array.isArray(x) ? x : (x ? [x] : []); },

  /* Pure name-matching (also exercised by the self tests). Current names are
   * system*.bin and controller*.bin; B1/B3 and M*.bin are the old names and
   * are still accepted so existing uploader folders keep working. */
  matchNames(mainNames, cloudNames) {
    const ci = (arr, re) => arr.find(n => re.test(n)) || null;
    const mains = mainNames.filter(n => /^(controller|m).*\.bin$/i.test(n) &&
                                        !/^system.*\.bin$/i.test(n));
    return {
      system: ci(mainNames, /^system.*\.bin$/i) || ci(mainNames, /^b1\.bin$/i) || ci(mainNames, /^b3\.bin$/i),
      mains,
      esp: {
        bootloader: ci(cloudNames, /^bootloader\.bin$/i),
        partitions: ci(cloudNames, /^partitions\.bin$/i),
        boot_app0: ci(cloudNames, /^boot_app0\.bin$/i),
        firmware: ci(cloudNames, /^firmware\.bin$/i),
      },
    };
  },

  async _exists(url) {
    try {
      const r = await fetch(url, { method: "HEAD", cache: "no-store" });
      return r.ok;
    } catch (e) { return false; }
  },

  /* Scan the uploader folder. Returns
   * { b1, b3, mains: [{name,size}...], esp: {...}, espComplete, viaListing } */
  async scan() {
    let mainEntries = null, cloudEntries = null, viaListing = false;
    try {
      const r = await fetch(this._url("__local_list"), { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        mainEntries = this._asArray(j.main_firmware);
        cloudEntries = this._asArray(j.cloud_firmware);
        viaListing = true;
      }
    } catch (e) { /* static host - fall through */ }

    /* No local server (the phone app, or the plain website): the firmware that
     * SHIPS WITH THE APP is listed in builtin.json. The service worker stores
     * those files on first run, so from then on they are on the device and
     * work with no internet at all - the same files, the same checks, just a
     * listing a static host can serve. */
    if (!mainEntries) {
      try {
        const r = await fetch(this._url("builtin.json"), { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          mainEntries = this._asArray(j.main_firmware);
          cloudEntries = this._asArray(j.cloud_firmware);
          viaListing = true;
        }
      } catch (e) { /* not published with built-in firmware - fall through */ }
    }

    if (!mainEntries) {
      mainEntries = [];
      for (const name of ["system.bin", "controller.bin", "B1.bin", "B3.bin", "M.bin"]) {
        if (await this._exists(this._url(this.MAIN_DIR + "/" + name))) mainEntries.push({ name, size: 0 });
      }
      cloudEntries = [];
      for (const name of ["bootloader.bin", "partitions.bin", "boot_app0.bin", "firmware.bin"]) {
        if (await this._exists(this._url(this.CLOUD_DIR + "/" + name))) cloudEntries.push({ name, size: 0 });
      }
    }

    /* The receipt written when this folder was built: file -> SHA-256. Used
     * to prove the .bin files here are exactly the ones that were put in. */
    let receipt = null;
    try {
      const r = await fetch(this._url("firmware_receipt.json"), { cache: "no-store" });
      if (r.ok) receipt = await r.json();
    } catch (e) { /* folders built before receipts existed - just no proof */ }

    /* The receipt says which company this firmware was prepared for. If that
     * is not the company this app belongs to, someone put the wrong firmware
     * in - it happened for real: the General app was left carrying another
     * company's binaries and nothing said a word, because every file matched
     * its own receipt perfectly. Say it out loud instead. */
    /* Whose app is this? A customer FOLDER is a copy of the shared app plus
     * that company's licence file, so config.js still says "General" while
     * the folder really belongs to whoever the licence names. The licence is
     * the authority; config.js is only the fallback for a hosted company page
     * that has no licence of its own. */
    let owner = APP_CONFIG.customerName;
    try {
      const lic = await License.loadStored();
      if (lic && (lic.customer || lic.company)) owner = lic.customer || lic.company;
    } catch (e) { /* no licence yet - fall back to config.js */ }

    if (receipt && receipt.company && owner &&
        receipt.company.trim().toLowerCase() !== owner.trim().toLowerCase()) {
      Util.warn("This firmware was prepared for " + receipt.company + ", but this uploader belongs to " +
                owner + " - check that it is the right firmware before installing.");
    }

    const m = this.matchNames(mainEntries.map(e => e.name), cloudEntries.map(e => e.name));
    const sizeOf = {};
    for (const e of mainEntries) sizeOf[e.name] = e.size;
    for (const e of cloudEntries) sizeOf[e.name] = e.size;
    const found = {
      viaListing,
      system: m.system,
      mains: m.mains.map(name => ({ name, size: sizeOf[name] || 0 })),
      esp: m.esp,
      espComplete: !!(m.esp.bootloader && m.esp.partitions && m.esp.boot_app0 && m.esp.firmware),
      receipt,
      sizeOf,
      /* When each firmware was BUILT (the compiler's timestamp, recorded when
       * this uploader was prepared) - the useful thing to look at. */
      builtAt: (rel) => (receipt && receipt.built_times) ? receipt.built_times[rel] : null,
    };
    Util.info("Local folder scan (" + (viaListing ? "listing" : "name probe") + "): " +
      "system=" + (found.system || "none") +
      " controller=[" + found.mains.map(x => x.name).join(", ") + "]" +
      " cloud=" + (found.espComplete ? "complete" : (m.esp.firmware ? "firmware-only" : "none")));
    return found;
  },

  /* Firmware the user picked from the device itself (phone or PC). Same file
   * names the uploader folder uses, so a set sent by e-mail/WhatsApp installs
   * without any folder or internet. Files are sorted by name, exactly as the
   * folder scan does, and validated the same way afterwards. */
  async fromFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return null;
    const names = files.map(f => f.name);
    const m = this.matchNames(names, names);          // one pool: classify by name
    const byName = {};
    for (const f of files) byName[f.name] = f;

    const read = async (name) => {
      const f = byName[name];
      if (!f) return null;
      return new Uint8Array(await f.arrayBuffer());
    };

    const found = {
      viaListing: true,
      picked: true,
      system: m.system,
      mains: m.mains.map(n => ({ name: n, size: (byName[n] || {}).size || 0 })),
      esp: m.esp,
      espComplete: !!(m.esp.bootloader && m.esp.partitions && m.esp.boot_app0 && m.esp.firmware),
      receipt: null,
      sizeOf: files.reduce((o, f) => { o[f.name] = f.size; return o; }, {}),
      builtAt: () => null,
      _read: read,
    };
    Util.info("Picked from this device: " +
      (found.system || "no system firmware") + ", " +
      (found.mains.length ? found.mains.map(x => x.name).join(", ") : "no controller software") +
      (found.esp.firmware ? ", cloud module" : ""));
    return found;
  },

  async _fetchBin(url, label, onProgress) {
    let res;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch (e) {
      throw new UploaderError("Could not read " + label + " from the uploader folder (" + e.message + ").");
    }
    if (!res.ok) throw new UploaderError("Missing file in the uploader folder: " + url + " (" + res.status + ")");
    const bytes = new Uint8Array(await res.arrayBuffer());
    Util.info(label + ": loaded from the uploader folder (" + Util.fmtBytes(bytes.length) + ").");
    if (onProgress) onProgress(1);
    return bytes;
  },

  /* Load the files a given action needs.
   * needs = { controller, system, esp: "no"|"optional"|"required" };
   * mainName = the chosen controller file. */
  /* Prove a .bin is EXACTLY the file that was put into this folder.
   *  - listed in the receipt and the hash matches -> "verified"
   *  - listed and the hash differs -> REFUSE. The file was swapped or damaged;
   *    installing it could brick a station, so it never reaches the device.
   *  - no receipt (folder built before receipts, or hand-filled) -> allowed,
   *    but the fingerprint is printed so it can be compared by eye. */
  async _verify(bytes, relPath, receipt) {
    const hash = await Util.sha256Hex(bytes);
    const want = receipt && receipt.files ? receipt.files[relPath] : null;
    if (!want) {
      Util.warn(relPath + ": fingerprint " + hash.slice(0, 16) +
                " (no receipt in this folder - compare it yourself if in doubt)");
      return hash;
    }
    if (want.toLowerCase() !== hash.toLowerCase()) {
      Util.err("REFUSED " + relPath + ": this file is NOT the one delivered with this uploader.");
      Util.err("   delivered: " + want.slice(0, 16) + "     found now: " + hash.slice(0, 16));
      const e = new UploaderError(I18N.t("err.fpMismatch", { f: relPath }), I18N.t("hint.fpMismatch"));
      e.fatal = true;
      throw e;
    }
    Util.ok(relPath + ": verified - exactly the file delivered with this uploader (" +
            hash.slice(0, 16) + ").");
    return hash;
  },

  async load(found, needs, mainName, onProgress) {
    const report = (name, f) => { if (onProgress) onProgress(name, f); };
    const pkg = { controller: null, system: null, esp: null };
    const receipt = found.receipt;

    /* Files chosen from the device are already in hand - read them straight
     * from the picker instead of fetching URLs that do not exist. */
    if (found.picked) {
      if (needs.controller) {
        const chosen = mainName || (found.mains[0] && found.mains[0].name);
        if (!chosen) throw new UploaderError(I18N.t("local.noMain"), I18N.t("local.hintPick"));
        pkg.controller = await found._read(chosen);
        report(chosen, 1);
      }
      if (needs.system) {
        if (!found.system) throw new UploaderError(I18N.t("local.noBoot"), I18N.t("local.hintPick"));
        pkg.system = await found._read(found.system);
        report(found.system, 1);
      }
      if (needs.esp !== "no") {
        if (found.esp.firmware) {
          pkg.esp = {};
          for (const part of ["bootloader", "partitions", "boot_app0", "firmware"]) {
            if (found.esp[part]) pkg.esp[part] = await found._read(found.esp[part]);
          }
        } else if (needs.esp === "required") {
          throw new UploaderError(I18N.t("err.noEspFiles"), I18N.t("local.hintPick"));
        }
      }
      return pkg;
    }

    if (needs.controller) {
      const chosen = mainName || (found.mains[0] && found.mains[0].name);
      if (!chosen) {
        throw new UploaderError(I18N.t("local.noMain"), I18N.t("local.hintFiles"));
      }
      pkg.controller = await this._fetchBin(this._url(this.MAIN_DIR + "/" + chosen),
        "Controller software " + chosen, f => report(chosen, f));
      await this._verify(pkg.controller, this.MAIN_DIR + "/" + chosen, receipt);
    }

    if (needs.system) {
      if (!found.system) {
        throw new UploaderError(I18N.t("local.noBoot"), I18N.t("local.hintFiles"));
      }
      pkg.system = await this._fetchBin(this._url(this.MAIN_DIR + "/" + found.system),
        "System firmware " + found.system, f => report(found.system, f));
      await this._verify(pkg.system, this.MAIN_DIR + "/" + found.system, receipt);
    }

    if (needs.esp !== "no") {
      if (found.esp.firmware) {
        pkg.esp = {};
        for (const part of ["bootloader", "partitions", "boot_app0", "firmware"]) {
          if (found.esp[part]) {
            pkg.esp[part] = await this._fetchBin(this._url(this.CLOUD_DIR + "/" + found.esp[part]),
              "ESP32 " + part, f => report("cloud/" + part, f));
            await this._verify(pkg.esp[part], this.CLOUD_DIR + "/" + found.esp[part], receipt);
          }
        }
      } else if (needs.esp === "required") {
        throw new UploaderError(I18N.t("err.noEspFiles"), I18N.t("local.hintFiles"));
      }
    }
    return pkg;
  },
};
