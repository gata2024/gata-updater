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
    } catch (e) { /* static host - fall through to probing */ }

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

    const m = this.matchNames(mainEntries.map(e => e.name), cloudEntries.map(e => e.name));
    const sizeOf = {};
    for (const e of mainEntries) sizeOf[e.name] = e.size;
    const found = {
      viaListing,
      system: m.system,
      mains: m.mains.map(name => ({ name, size: sizeOf[name] || 0 })),
      esp: m.esp,
      espComplete: !!(m.esp.bootloader && m.esp.partitions && m.esp.boot_app0 && m.esp.firmware),
    };
    Util.info("Local folder scan (" + (viaListing ? "listing" : "name probe") + "): " +
      "system=" + (found.system || "none") +
      " controller=[" + found.mains.map(x => x.name).join(", ") + "]" +
      " cloud=" + (found.espComplete ? "complete" : (m.esp.firmware ? "firmware-only" : "none")));
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
  async load(found, needs, mainName, onProgress) {
    const report = (name, f) => { if (onProgress) onProgress(name, f); };
    const pkg = { controller: null, system: null, esp: null };

    if (needs.controller) {
      const chosen = mainName || (found.mains[0] && found.mains[0].name);
      if (!chosen) {
        throw new UploaderError(I18N.t("local.noMain"), I18N.t("local.hintFiles"));
      }
      pkg.controller = await this._fetchBin(this._url(this.MAIN_DIR + "/" + chosen),
        "Controller software " + chosen, f => report(chosen, f));
    }

    if (needs.system) {
      if (!found.system) {
        throw new UploaderError(I18N.t("local.noBoot"), I18N.t("local.hintFiles"));
      }
      pkg.system = await this._fetchBin(this._url(this.MAIN_DIR + "/" + found.system),
        "System firmware " + found.system, f => report(found.system, f));
    }

    if (needs.esp !== "no") {
      if (found.esp.firmware) {
        pkg.esp = {};
        for (const part of ["bootloader", "partitions", "boot_app0", "firmware"]) {
          if (found.esp[part]) {
            pkg.esp[part] = await this._fetchBin(this._url(this.CLOUD_DIR + "/" + found.esp[part]),
              "ESP32 " + part, f => report("cloud/" + part, f));
          }
        }
      } else if (needs.esp === "required") {
        throw new UploaderError(I18N.t("err.noEspFiles"), I18N.t("local.hintFiles"));
      }
    }
    return pkg;
  },
};
