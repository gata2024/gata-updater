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
      if (!["controller", "system", "esp"].includes(k)) {
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
    Util.ok("Package validation passed (" + parts.join(" + ") + ").");
  },
};
