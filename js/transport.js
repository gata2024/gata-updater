/* GATA Cloud Uploader - serial transports to the CDC bootloader.
 *
 * The flashed bootloader (B1/B3) enumerates as a USB CDC serial port:
 *   VID 0x0483  PID 0x5740  "STM32 Bootloader"
 *
 * Two interchangeable transports expose { open, close, write, onData }:
 *   - SerialTransport : Web Serial API (Chrome/Edge on Windows / macOS / Linux)
 *   - UsbCdcTransport : WebUSB driving the CDC device directly (Chrome on Android,
 *                       where Web Serial is not available and no COM driver exists)
 */
"use strict";

const CDC_VID = APP_CONFIG.cdcVid;
const CDC_PID = APP_CONFIG.cdcPid;

class SerialTransport {
  constructor(port) {
    this.port = port;
    this._reader = null;
    this._writer = null;
    this._onData = null;
    this._closing = false;
    this.kind = "serial";
  }

  static available() { return !!navigator.serial; }

  static async requestPort() {
    const port = await navigator.serial.requestPort({
      filters: [{ usbVendorId: CDC_VID, usbProductId: CDC_PID }]
    });
    return new SerialTransport(port);
  }

  /* Reconnect to an already-authorized port (no user prompt). */
  static async getAuthorizedPort() {
    if (!navigator.serial) return null;
    const ports = await navigator.serial.getPorts();
    for (const p of ports) {
      const inf = p.getInfo();
      if (inf.usbVendorId === CDC_VID && inf.usbProductId === CDC_PID) {
        return new SerialTransport(p);
      }
    }
    return null;
  }

  onData(cb) { this._onData = cb; }

  async open() {
    await this.port.open({ baudRate: 115200 });
    this._closing = false;
    this._writer = this.port.writable.getWriter();
    this._readLoop();
  }

  async _readLoop() {
    while (this.port.readable && !this._closing) {
      this._reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this._reader.read();
          if (done) break;
          if (value && this._onData) this._onData(value);
        }
      } catch (e) {
        if (!this._closing) Util.warn("Serial read stopped: " + e.message);
        break;
      } finally {
        try { this._reader.releaseLock(); } catch (e) { /* ignore */ }
      }
    }
  }

  async write(bytes) {
    await this._writer.write(bytes);
  }

  async close() {
    this._closing = true;
    try { if (this._reader) await this._reader.cancel(); } catch (e) { /* ignore */ }
    try { if (this._writer) { this._writer.releaseLock(); } } catch (e) { /* ignore */ }
    try { await this.port.close(); } catch (e) { /* ignore */ }
  }
}

/* Minimal CDC-ACM host driver over WebUSB (for Android / USB-OTG). */
class UsbCdcTransport {
  constructor(device) {
    this.device = device;
    this._onData = null;
    this._closing = false;
    this._commIface = null;
    this._dataIface = null;
    this._epIn = null;
    this._epOut = null;
    this.kind = "webusb-cdc";
  }

  static available() { return !!navigator.usb; }

  static async requestDevice() {
    const dev = await navigator.usb.requestDevice({
      filters: [{ vendorId: CDC_VID, productId: CDC_PID }]
    });
    return new UsbCdcTransport(dev);
  }

  static async getAuthorizedDevice() {
    if (!navigator.usb) return null;
    const devices = await navigator.usb.getDevices();
    const dev = devices.find(d => d.vendorId === CDC_VID && d.productId === CDC_PID);
    return dev ? new UsbCdcTransport(dev) : null;
  }

  onData(cb) { this._onData = cb; }

  async open() {
    const d = this.device;
    await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);

    for (const iface of d.configuration.interfaces) {
      const alt = iface.alternates[0];
      if (alt.interfaceClass === 0x02) this._commIface = iface;   // CDC control
      if (alt.interfaceClass === 0x0A) {                          // CDC data
        this._dataIface = iface;
        for (const ep of alt.endpoints) {
          if (ep.type === "bulk" && ep.direction === "in") this._epIn = ep.endpointNumber;
          if (ep.type === "bulk" && ep.direction === "out") this._epOut = ep.endpointNumber;
        }
      }
    }
    if (!this._dataIface || this._epIn == null || this._epOut == null) {
      throw new UploaderError("This USB device does not look like the GATA bootloader (no CDC data interface).");
    }

    try {
      if (this._commIface) await d.claimInterface(this._commIface.interfaceNumber);
      await d.claimInterface(this._dataIface.interfaceNumber);
    } catch (e) {
      throw new UploaderError("Could not claim the USB interface: " + e.message,
        I18N.t("hint.portBusy"));
    }

    const ctrlIdx = this._commIface ? this._commIface.interfaceNumber : 0;

    // SET_LINE_CODING: 115200 8N1 (the bootloader ignores it, but be a good citizen).
    const coding = new Uint8Array(7);
    new DataView(coding.buffer).setUint32(0, 115200, true);
    coding[4] = 0; coding[5] = 0; coding[6] = 8;
    await d.controlTransferOut({
      requestType: "class", recipient: "interface",
      request: 0x20, value: 0, index: ctrlIdx
    }, coding).catch(() => {});

    // SET_CONTROL_LINE_STATE with DTR|RTS. IMPORTANT: the bootloader only starts
    // USB reception when it sees this request (= "host opened the COM port").
    await d.controlTransferOut({
      requestType: "class", recipient: "interface",
      request: 0x22, value: 0x0003, index: ctrlIdx
    });

    this._closing = false;
    this._readLoop();
  }

  async _readLoop() {
    while (!this._closing) {
      let res;
      try {
        res = await this.device.transferIn(this._epIn, 512);
      } catch (e) {
        if (!this._closing) Util.warn("USB read stopped: " + e.message);
        return;
      }
      if (res.status === "stall") {
        await this.device.clearHalt("in", this._epIn).catch(() => {});
        continue;
      }
      if (res.data && res.data.byteLength && this._onData) {
        this._onData(new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength));
      }
    }
  }

  async write(bytes) {
    // transferOut waits while the device NAKs -> natural flow control during flash writes.
    const res = await this.device.transferOut(this._epOut, bytes);
    if (res.status === "stall") {
      await this.device.clearHalt("out", this._epOut).catch(() => {});
      throw new UploaderError("USB write stalled.");
    }
  }

  async close() {
    this._closing = true;
    try {
      const ctrlIdx = this._commIface ? this._commIface.interfaceNumber : 0;
      await this.device.controlTransferOut({
        requestType: "class", recipient: "interface",
        request: 0x22, value: 0x0000, index: ctrlIdx
      });
    } catch (e) { /* ignore */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

/* Pick the best transport for this platform. */
const Transport = {
  preferred() {
    if (SerialTransport.available()) return "serial";
    if (UsbCdcTransport.available()) return "webusb-cdc";
    return null;
  },
  /* Log plug/unplug events so sudden cable problems are visible in the log. */
  watchDisconnects() {
    try {
      if (navigator.serial && navigator.serial.addEventListener) {
        navigator.serial.addEventListener("disconnect", () => Util.warn("Serial device unplugged."));
        navigator.serial.addEventListener("connect", () => Util.info("Serial device plugged in."));
      }
      if (navigator.usb && navigator.usb.addEventListener) {
        navigator.usb.addEventListener("disconnect", e => {
          const d = e.device || {};
          Util.warn("USB device unplugged (" + (d.productName || "unknown") + ").");
        });
        navigator.usb.addEventListener("connect", e => {
          const d = e.device || {};
          Util.info("USB device plugged in (" + (d.productName || "unknown") + ").");
        });
      }
    } catch (e) { /* purely informational */ }
  },
  async request() {
    if (SerialTransport.available()) return SerialTransport.requestPort();
    if (UsbCdcTransport.available()) return UsbCdcTransport.requestDevice();
    throw new UploaderError("Neither Web Serial nor WebUSB is available.",
      "Use Chrome/Edge on a computer or Chrome on Android.");
  },
  async reconnect() {
    if (SerialTransport.available()) {
      const t = await SerialTransport.getAuthorizedPort();
      if (t) return t;
    }
    if (UsbCdcTransport.available()) {
      const t = await UsbCdcTransport.getAuthorizedDevice();
      if (t) return t;
    }
    return null;
  }
};
