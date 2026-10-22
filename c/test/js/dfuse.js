/* GATA Cloud Uploader - DfuSe (ST extended USB DFU) client over WebUSB.
 *
 * Replaces:  dfu-util -d 0483:df11 -a 0 -s 0x08000000:leave -D <B1|B3>.bin
 * Target  :  STM32 ROM bootloader ("DFU in FS Mode", VID 0x0483 PID 0xDF11).
 *
 * Protocol references: USB DFU 1.1 spec + ST AN3156 (DfuSe).
 */
"use strict";

const DFU = {
  // bRequest
  DETACH: 0, DNLOAD: 1, UPLOAD: 2, GETSTATUS: 3, CLRSTATUS: 4, GETSTATE: 5, ABORT: 6,
  // bState
  appIDLE: 0, appDETACH: 1, dfuIDLE: 2, dfuDNLOAD_SYNC: 3, dfuDNBUSY: 4,
  dfuDNLOAD_IDLE: 5, dfuMANIFEST_SYNC: 6, dfuMANIFEST: 7, dfuMANIFEST_WAIT_RESET: 8,
  dfuUPLOAD_IDLE: 9, dfuERROR: 10,
  STATUS_OK: 0,
};

class DfuSeDevice {
  constructor(usbDevice) {
    this.device = usbDevice;
    this.ifaceNum = 0;
    this.altNum = 0;
    this.transferSize = 1024;           // default for STM32 ROM DFU, refined from descriptor
    this.memMap = null;                 // [{start, sectorSize, count}]
  }

  static get filters() { return [{ vendorId: APP_CONFIG.dfuVid, productId: APP_CONFIG.dfuPid }]; }

  /* Ask the user to pick the DFU device (must run from a user gesture). */
  static async requestDevice() {
    if (!navigator.usb) {
      throw new UploaderError("WebUSB is not available in this browser.",
        "Use Chrome or Edge on a computer, or Chrome on Android.");
    }
    const dev = await navigator.usb.requestDevice({ filters: DfuSeDevice.filters });
    return new DfuSeDevice(dev);
  }

  /* Reuse a previously authorized device without a new permission prompt. */
  static async getAuthorizedDevice() {
    if (!navigator.usb) return null;
    const devices = await navigator.usb.getDevices();
    const dev = devices.find(d => d.vendorId === APP_CONFIG.dfuVid && d.productId === APP_CONFIG.dfuPid);
    return dev ? new DfuSeDevice(dev) : null;
  }

  async open() {
    const d = this.device;
    try {
      await d.open();
      if (d.configuration === null) await d.selectConfiguration(1);
      // DFU devices expose a single interface (0); alt settings select memories.
      const iface = d.configuration.interfaces.find(i =>
        i.alternates.some(a => a.interfaceClass === 0xFE && a.interfaceSubclass === 0x01));
      this.ifaceNum = iface ? iface.interfaceNumber : 0;
      await d.claimInterface(this.ifaceNum);
      await d.selectAlternateInterface(this.ifaceNum, this.altNum); // alt 0 = Internal Flash
    } catch (e) {
      throw new UploaderError("Could not open the DFU device: " + e.message, I18N.t("hint.driver"));
    }
    await this._readTransferSize();
    await this._readMemoryMap();
    Util.info("DFU device open. Transfer size " + this.transferSize +
      " bytes, memory map: " + JSON.stringify(this.memMap));
  }

  async close() {
    try { await this.device.releaseInterface(this.ifaceNum); } catch (e) { /* device may be gone */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------ descriptors */

  async _readTransferSize() {
    try {
      // Raw configuration descriptor -> find the DFU functional descriptor (type 0x21).
      const res = await this.device.controlTransferIn({
        requestType: "standard", recipient: "device",
        request: 0x06 /* GET_DESCRIPTOR */, value: 0x0200, index: 0
      }, 512);
      const b = new Uint8Array(res.data.buffer);
      let off = 0;
      while (off + 2 <= b.length) {
        const len = b[off], type = b[off + 1];
        if (len < 2) break;
        if (type === 0x21 && len >= 9) {
          this.transferSize = b[off + 5] | (b[off + 6] << 8);
          return;
        }
        off += len;
      }
    } catch (e) {
      Util.warn("Could not read DFU functional descriptor (" + e.message + "), using 1024.");
    }
  }

  async _getStringDescriptor(index) {
    if (!index) return "";
    const langRes = await this.device.controlTransferIn({
      requestType: "standard", recipient: "device",
      request: 0x06, value: 0x0300, index: 0
    }, 255);
    const langId = langRes.data.byteLength >= 4 ? langRes.data.getUint16(2, true) : 0x0409;
    const res = await this.device.controlTransferIn({
      requestType: "standard", recipient: "device",
      request: 0x06, value: 0x0300 | index, index: langId
    }, 255);
    const d = res.data;
    let s = "";
    for (let i = 2; i + 1 < d.byteLength; i += 2) s += String.fromCharCode(d.getUint16(i, true));
    return s;
  }

  async _readMemoryMap() {
    // The alt-setting name encodes the layout, e.g. "@Internal Flash  /0x08000000/01*128Kg"
    let name = "";
    try {
      const iface = this.device.configuration.interfaces.find(i => i.interfaceNumber === this.ifaceNum);
      const alt = iface.alternates.find(a => a.alternateSetting === this.altNum);
      name = alt && alt.interfaceName ? alt.interfaceName : "";
      if (!name) {
        // Fall back to reading the string descriptor manually.
        const res = await this.device.controlTransferIn({
          requestType: "standard", recipient: "device",
          request: 0x06, value: 0x0200, index: 0
        }, 512);
        const b = new Uint8Array(res.data.buffer);
        let off = 0;
        while (off + 2 <= b.length) {
          const len = b[off], type = b[off + 1];
          if (len < 2) break;
          if (type === 0x04 /* INTERFACE */ && b[off + 2] === this.ifaceNum &&
              b[off + 3] === this.altNum) {
            name = await this._getStringDescriptor(b[off + 8]); // iInterface
            break;
          }
          off += len;
        }
      }
    } catch (e) { /* fall through to default map */ }

    this.memMap = DfuSeDevice.parseMemoryMap(name);
    if (!this.memMap) {
      // STM32H750: a single 128 KB internal-flash sector at 0x08000000.
      Util.warn("Could not parse DFU memory map ('" + name + "'), assuming STM32H750 layout.");
      this.memMap = [{ start: 0x08000000, sectorSize: 128 * 1024, count: 1 }];
    }
  }

  static parseMemoryMap(name) {
    // "@Internal Flash  /0x08000000/01*128Kg,07*128Kg" -> segments
    if (!name || name.indexOf("/") < 0) return null;
    try {
      const parts = name.split("/");
      const segs = [];
      for (let i = 1; i + 1 < parts.length; i += 2) {
        let addr = parseInt(parts[i].trim(), 16);
        for (const spec of parts[i + 1].split(",")) {
          const m = spec.trim().match(/^(\d+)\s*\*\s*(\d+)\s*([KM]?)/i);
          if (!m) continue;
          let size = parseInt(m[2], 10);
          const unit = m[3].toUpperCase();
          if (unit === "K") size *= 1024;
          if (unit === "M") size *= 1024 * 1024;
          const count = parseInt(m[1], 10);
          segs.push({ start: addr, sectorSize: size, count });
          addr += size * count;
        }
      }
      return segs.length ? segs : null;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------ raw requests */

  async _out(request, value, data) {
    const res = await this.device.controlTransferOut({
      requestType: "class", recipient: "interface",
      request, value, index: this.ifaceNum
    }, data);
    if (res.status !== "ok") throw new UploaderError("DFU control transfer failed: " + res.status);
    return res;
  }

  async _in(request, length, value) {
    const res = await this.device.controlTransferIn({
      requestType: "class", recipient: "interface",
      request, value: value || 0, index: this.ifaceNum
    }, length);
    if (res.status !== "ok") throw new UploaderError("DFU control read failed: " + res.status);
    return res.data;
  }

  async getStatus() {
    const d = await this._in(DFU.GETSTATUS, 6);
    return {
      status: d.getUint8(0),
      pollTimeout: d.getUint8(1) | (d.getUint8(2) << 8) | (d.getUint8(3) << 16),
      state: d.getUint8(4),
    };
  }

  clearStatus() { return this._out(DFU.CLRSTATUS, 0); }
  abort() { return this._out(DFU.ABORT, 0); }
  dnload(blockNum, data) { return this._out(DFU.DNLOAD, blockNum, data); }

  /* Poll GETSTATUS until the device leaves the busy state. */
  async _pollIdle(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 30000);
    for (;;) {
      const s = await this.getStatus();
      if (s.state === DFU.dfuDNBUSY || s.state === DFU.dfuDNLOAD_SYNC) {
        if (Date.now() > deadline) throw new UploaderError("DFU operation timed out.");
        await Util.sleep(Math.max(s.pollTimeout, 5));
        continue;
      }
      if (s.state === DFU.dfuERROR || s.status !== DFU.STATUS_OK) {
        const code = s.status;
        await this.clearStatus().catch(() => {});
        throw new UploaderError("DFU error (status " + code + ", state " + s.state + ").",
          I18N.t("hint.boot"));
      }
      return s;
    }
  }

  async _ensureIdle() {
    let s;
    try { s = await this.getStatus(); }
    catch (e) { s = null; }
    if (s && s.state === DFU.dfuERROR) { await this.clearStatus(); s = await this.getStatus(); }
    if (s && s.state !== DFU.dfuIDLE && s.state !== DFU.dfuDNLOAD_IDLE) {
      await this.abort().catch(() => {});
      await Util.sleep(10);
    }
  }

  /* --------------------------------------------------------- DfuSe commands */

  async setAddress(addr) {
    const cmd = new Uint8Array(5);
    cmd[0] = 0x21;
    new DataView(cmd.buffer).setUint32(1, addr, true);
    await this.dnload(0, cmd);
    await this._pollIdle(5000);
  }

  async eraseSector(addr) {
    const cmd = new Uint8Array(5);
    cmd[0] = 0x41;
    new DataView(cmd.buffer).setUint32(1, addr, true);
    await this.dnload(0, cmd);
    await this._pollIdle(60000);          // sector erase on H7 can take a few seconds
  }

  /* Erase every sector that overlaps [startAddr, startAddr+size). */
  async eraseRange(startAddr, size, onProgress) {
    const sectors = [];
    for (const seg of this.memMap) {
      for (let i = 0; i < seg.count; i++) {
        const s = seg.start + i * seg.sectorSize;
        if (s < startAddr + size && s + seg.sectorSize > startAddr) sectors.push(s);
      }
    }
    if (!sectors.length) sectors.push(startAddr);
    for (let i = 0; i < sectors.length; i++) {
      Util.info("Erasing sector at " + Util.hex(sectors[i]) + " ...");
      await this.eraseSector(sectors[i]);
      if (onProgress) onProgress((i + 1) / sectors.length);
    }
  }

  /* Full download: erase + write + verify-free manifest ("leave" = run the firmware). */
  /* Stamp "I have just been installed" into the system firmware before it is
   * written. The image carries a signature followed by four spare bytes; a
   * fresh random number there makes THIS install unlike any that ran on the
   * board before, so the controller waits for the updater instead of starting
   * its old software - even when the very same file is installed again.
   *
   * Why not send a command instead: on a fast start the controller does not
   * bring up USB at all, so there is nothing listening to receive one. Riding
   * inside the image needs no listening window, and only something that
   * rewrites the flash can set it - noise on a wire cannot.
   *
   * System firmware without the signature (older builds) is left untouched.
   * Returns the id that was written, or null. */
  static stampSession(bytes) {
    const sig = "GATASESS";
    const at = (i) => {
      for (let k = 0; k < sig.length; k++) if (bytes[i + k] !== sig.charCodeAt(k)) return false;
      return true;
    };
    let found = -1, count = 0;
    for (let i = 0; i + sig.length + 4 <= bytes.length; i++) {
      if (at(i)) { if (found < 0) found = i; count++; }
    }
    if (found < 0) return null;                     // older system firmware
    if (count > 1) {                                // ambiguous: never guess
      Util.warn("System firmware carries " + count + " session marks - leaving them alone.");
      return null;
    }
    const id = new Uint32Array(1);
    crypto.getRandomValues(id);
    let v = id[0] >>> 0;
    if (v === 0 || v === 0xFFFFFFFF) v = 1;         // those two mean "not stamped"
    const p = found + sig.length;
    bytes[p] = v & 0xFF; bytes[p + 1] = (v >>> 8) & 0xFF;
    bytes[p + 2] = (v >>> 16) & 0xFF; bytes[p + 3] = (v >>> 24) & 0xFF;
    return v;
  }

  async flash(startAddr, bytes, onProgress) {
    await this._ensureIdle();
    if (onProgress) onProgress({ phase: "erase", value: 0 });
    await this.eraseRange(startAddr, bytes.length, v => {
      if (onProgress) onProgress({ phase: "erase", value: v });
    });

    await this.setAddress(startAddr);
    const xfer = this.transferSize;
    const blocks = Math.ceil(bytes.length / xfer);
    for (let i = 0; i < blocks; i++) {
      const chunk = bytes.subarray(i * xfer, Math.min((i + 1) * xfer, bytes.length));
      await this.dnload(2 + i, chunk);
      await this._pollIdle(10000);
      if (onProgress) onProgress({ phase: "write", value: (i + 1) / blocks });
    }
    Util.ok("DFU download complete (" + bytes.length + " bytes at " + Util.hex(startAddr) + ").");
    await this.leave(startAddr);
  }

  /* Tell the ROM bootloader to jump to the new firmware (dfu-util ':leave'). */
  async leave(startAddr) {
    try {
      await this.setAddress(startAddr);
      await this.dnload(0, new Uint8Array(0));   // zero-length download => manifest
      const s = await this.getStatus();          // triggers the jump; device drops off USB
      Util.info("DFU manifest state " + s.state + " - device is starting the firmware.");
    } catch (e) {
      // The device resets during this step - a stall/disconnect here is EXPECTED.
      Util.info("Device left DFU mode (USB disconnect is normal here).");
    }
    await this.close();
  }
}
