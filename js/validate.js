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
   * pkg = { main, b1, b3, esp:{bootloader,partitions,boot_app0,firmware}|null }
   * needs = { main: bool, system: bool, esp: bool } - which parts this run uses. */
  checkPackage(pkg, needs) {
    const n = Object.assign({ main: true, system: true, esp: false }, needs || {});
    const bad = (key, fname) => {
      throw new UploaderError(I18N.t(key, { f: fname }), I18N.t("hint.retry"));
    };
    const parts = [];
    if (n.main) {
      if (!this.isValidApp(pkg.main)) bad("val.main", "M*.bin");
      parts.push("app");
    }
    if (n.system) {
      if (!this.isValidSystem(pkg.b1)) bad("val.boot", "B1.bin");
      if (!this.isValidSystem(pkg.b3)) bad("val.boot", "B3.bin");
      parts.push("B1+B3");
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
