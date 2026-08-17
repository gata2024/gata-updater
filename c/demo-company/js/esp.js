/* GATA Cloud Uploader - ESP32 combined-image builder.
 *
 * Identical to create_combined_esp32_binary() in the Python tool: the four
 * PlatformIO artifacts are merged into ONE image based at 0x1000 so a single
 * ESP_WRITE covers a brand-new (blank) ESP32 chip.
 *
 *   0x01000 bootloader.bin      (offset 0x0000 in the image)
 *   0x08000 partitions.bin      (offset 0x7000)
 *   0x0E000 boot_app0.bin       (offset 0xD000)
 *   0x10000 firmware.bin        (offset 0xF000)
 */
"use strict";

const Esp32 = {
  BASE_ADDR: 0x1000,
  APP_ONLY_ADDR: 0x10000,

  LAYOUT: [
    { key: "bootloader", flashAddr: 0x1000 },
    { key: "partitions", flashAddr: 0x8000 },
    { key: "boot_app0", flashAddr: 0xE000 },
    { key: "firmware", flashAddr: 0x10000 },
  ],

  /* files = { bootloader, partitions, boot_app0, firmware } as Uint8Array. */
  buildCombinedImage(files) {
    for (const part of this.LAYOUT) {
      if (!files[part.key]) throw new UploaderError("Missing ESP32 file: " + part.key + ".bin");
    }
    let end = 0;
    for (const part of this.LAYOUT) {
      end = Math.max(end, (part.flashAddr - this.BASE_ADDR) + files[part.key].length);
    }
    const image = new Uint8Array(end).fill(0xFF);
    for (const part of this.LAYOUT) {
      const off = part.flashAddr - this.BASE_ADDR;
      image.set(files[part.key], off);
      Util.info("ESP32 image: " + part.key + ".bin (" + Util.fmtBytes(files[part.key].length) +
        ") at flash " + Util.hex(part.flashAddr, 5));
    }
    Util.info("Combined ESP32 image: " + Util.fmtBytes(image.length) +
      " based at " + Util.hex(this.BASE_ADDR, 5));
    return image;
  },

  hasCompleteSet(files) {
    return this.LAYOUT.every(p => files && files[p.key] && files[p.key].length > 0);
  }
};
