/* GATA Cloud Uploader - firmware image validation.
 *
 * Guards against flashing the WRONG file (e.g. picking M*.bin as a system
 * firmware, or a random file as an ESP32 image). The rules mirror the checks
 * the bootloader itself performs (IsApplicationValid in main.c) plus the
 * standard image signatures.
 */
"use strict";

const Validate = {
  _word(bytes, off) {
    return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
  },

  /* Controller application (M*.bin) - runs from external flash 0x90000000.
   * word0 = initial stack pointer in RAM (0x2xxxxxxx / 0x3xxxxxxx),
   * word1 = reset handler inside 0x90xxxxxx. */
  isValidApp(bytes) {
    if (!bytes || bytes.length < 8 || bytes.length > APP_CONFIG.appFlashMax) return false;
    const sp = this._word(bytes, 0);
    const reset = this._word(bytes, 4);
    if (sp === 0xFFFFFFFF || reset === 0xFFFFFFFF) return false;
    // ">>> 0" keeps the masked values unsigned (JS bitwise ops are signed 32-bit).
    if (((sp & 0xE0000000) >>> 0) !== 0x20000000) return false;       // same test as the bootloader
    if (((reset & 0xFF000000) >>> 0) !== 0x90000000) return false;
    return true;
  },

  /* System firmware (B1/B3) - runs from internal flash 0x08000000. */
  isValidSystem(bytes) {
    if (!bytes || bytes.length < 8 || bytes.length > APP_CONFIG.systemFlashMax) return false;
    const sp = this._word(bytes, 0);
    const reset = this._word(bytes, 4);
    if (((sp & 0xE0000000) >>> 0) !== 0x20000000) return false;
    if (((reset & 0xFF000000) >>> 0) !== 0x08000000) return false;
    return true;
  },

  /* Expansion board firmware (2026-11-06) - the expansion's own STM32H750,
   * internal flash 0x08000000, one 128 KB sector. Its vector table looks just
   * like the main board's system firmware, so that one is recognised by the
   * text its INFO answer carries and refused. */
  _has(bytes, str) {
    const k = new TextEncoder().encode(str);
    outer: for (let i = 0; i + k.length <= bytes.length; i++) {
      if (bytes[i] !== k[0]) continue;
      for (let j = 1; j < k.length; j++) if (bytes[i + j] !== k[j]) continue outer;
      return i;
    }
    return -1;
  },
  isValidExpansion(bytes) {
    if (!bytes || bytes.length < 8 || bytes.length > APP_CONFIG.systemFlashMax) return false;
    const sp = this._word(bytes, 0);
    const reset = this._word(bytes, 4);
    const spOk = (sp >= 0x20000000 && sp <= 0x20020000) || (sp >= 0x24000000 && sp <= 0x24080000);
    if (!spOk) return false;
    if (!(reset & 1) || reset < 0x08000000 || reset >= 0x08020000) return false;
    if (this._has(bytes, "EXTERNAL_FLASH:16MB@") >= 0) return false;      // main-board system firmware
    return true;
  },
  /* "GATA_BL_VERSION:1.0.18" in a system firmware (update program 1.0.18+)
   * -> 0x010012 (the number INFO's BL: line gives); 0 = no mark (older) */
  blVersionMark(bytes) {
    const i = bytes ? this._has(bytes, "GATA_BL_VERSION:") : -1;
    if (i < 0) return 0;
    let t = "";
    for (let k = i + 16; k < bytes.length && k < i + 30 && bytes[k] >= 0x2E && bytes[k] <= 0x39; k++) t += String.fromCharCode(bytes[k]);
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(t);
    return m ? (Number(m[1]) * 65536 + Number(m[2]) * 256 + Number(m[3])) : 0;
  },

  /* "GATA_EXP_BUILD:<date> <time>" stamped by the expansion firmware, or "" */
  expansionBuild(bytes) {
    const i = bytes ? this._has(bytes, "GATA_EXP_BUILD:") : -1;
    if (i < 0) return "";
    let e = i;
    while (e < bytes.length && e - i < 64 && bytes[e] !== 0) e++;
    return new TextDecoder().decode(bytes.subarray(i, e));
  },

  /* ESP32 app/bootloader images start with the 0xE9 image magic. */
  isValidEspImage(bytes) {
    return !!bytes && bytes.length > 16 && bytes[0] === 0xE9;
  },

  /* ESP32 partition table: 32-byte entries beginning with magic AA 50. */
  isValidEspPartitions(bytes) {
    return !!bytes && bytes.length >= 32 && bytes[0] === 0xAA && bytes[1] === 0x50;
  },

  /* Validate a whole package; throws UploaderError with a translated message.
   * pkg = { controller, system, esp:{bootloader,partitions,boot_app0,firmware}|null }
   * needs = { controller: bool, system: bool, esp: bool } - what this run uses. */
  checkPackage(pkg, needs) {
    /* A misspelt or renamed key would silently fall back to its default and
     * demand (or skip) the wrong file - that is how "update cloud module"
     * once started asking for a controller image it never downloads. */
    for (const k of Object.keys(needs || {})) {
      if (!["controller", "system", "esp", "expansion"].includes(k)) {
        throw new UploaderError("Internal error: unknown package requirement '" + k + "'.");
      }
    }
    const n = Object.assign({ controller: true, system: true, esp: false }, needs || {});
    const bad = (key, fname) => {
      throw new UploaderError(I18N.t(key, { f: fname }), I18N.t("hint.retry"));
    };
    const parts = [];
    if (n.controller) {
      if (!this.isValidApp(pkg.controller)) bad("val.main", "controller software");
      parts.push("controller software");
    }
    if (n.system) {
      if (!this.isValidSystem(pkg.system)) bad("val.boot", "system firmware");
      parts.push("system firmware");
    }
    if (n.esp && (!pkg.esp || !pkg.esp.firmware)) {
      throw new UploaderError(I18N.t("err.noEspFiles"));
    }
    if (pkg.esp) {
      if (pkg.esp.firmware && !this.isValidEspImage(pkg.esp.firmware)) bad("val.esp", "firmware.bin");
      if (pkg.esp.bootloader && !this.isValidEspImage(pkg.esp.bootloader)) bad("val.esp", "bootloader.bin");
      if (pkg.esp.partitions && !this.isValidEspPartitions(pkg.esp.partitions)) bad("val.esp", "partitions.bin");
      parts.push("ESP32");
    }
    if (n.expansion && !pkg.expansion) {
      throw new UploaderError(I18N.t("err.noExpFile"));
    }
    if (pkg.expansion) {
      if (!this.isValidExpansion(pkg.expansion)) bad("val.exp", "expansion firmware");
      parts.push("expansion board");
    }
    Util.ok("Package validation passed (" + parts.join(" + ") + ").");
  },
};
