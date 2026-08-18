/* GATA Cloud Uploader - demo mode.
 *
 * Simulates the DFU device and the CDC bootloader so the whole update flow
 * (and the UI) can be exercised without hardware. Enabled from Settings.
 */
"use strict";

class MockDfuDevice {
  constructor() { this.transferSize = 1024; }
  async open() { Util.info("[demo] DFU device opened."); }
  async close() { }
  async flash(addr, bytes, onProgress) {
    Util.info("[demo] DFU erase + flash of " + Util.fmtBytes(bytes.length) + " at " + Util.hex(addr));
    if (onProgress) onProgress({ phase: "erase", value: 0 });
    for (let i = 1; i <= 4; i++) { await Util.sleep(180); onProgress && onProgress({ phase: "erase", value: i / 4 }); }
    const blocks = 24;
    for (let i = 1; i <= blocks; i++) { await Util.sleep(50); onProgress && onProgress({ phase: "write", value: i / blocks }); }
    Util.ok("[demo] DFU download complete, device 'restarts'.");
  }
}

class MockTransport {
  constructor(opts) {
    this._onData = null;
    this.kind = "demo";
    this.opts = Object.assign({ hasEsp: true }, opts || {});
    this._state = "idle";
    this._expect = 0;
    this._got = 0;
    this._cmd = "";
  }
  onData(cb) { this._onData = cb; }
  async open() { Util.info("[demo] serial port opened (simulated bootloader)."); }
  async close() { }
  _reply(text, delay) {
    setTimeout(() => { if (this._onData) this._onData(new TextEncoder().encode(text)); }, delay || 30);
  }
  async write(bytes) {
    if (this._state === "write" || this._state === "espwrite") {
      this._got += bytes.length;
      if (this._got % 8192 < 1024) {
        this._reply((this._state === "espwrite" ? "ESP_PROGRESS:" : "PROGRESS:") + this._got + "/" + this._expect + "\r\n");
      }
      if (this._got >= this._expect) {
        if (this._state === "write") this._reply("COMPLETE\r\nOK\r\n", 400);
        else this._reply("ESP_COMPLETE\r\nOK\r\n", 600);
        this._state = "idle";
      }
      await Util.sleep(1);
      return;
    }
    this._cmd += new TextDecoder().decode(bytes);
    let idx;
    while ((idx = this._cmd.search(/[\r\n]/)) >= 0) {
      const line = this._cmd.slice(0, idx).trim();
      this._cmd = this._cmd.slice(idx + 1);
      if (line) this._handle(line);
    }
  }
  _handle(cmd) {
    Util.dev("[demo] device received: " + cmd);
    if (cmd === "INFO") this._reply("MCU:STM32H750VBT6\r\nEXTERNAL_FLASH:16MB@0x90000000\r\nOK\r\n");
    else if (cmd === "FORMAT") this._reply("FORMAT_COMPLETE\r\nOK\r\n", 3500);
    else if (cmd.startsWith("WRITE:")) {
      this._expect = parseInt(cmd.slice(6), 10); this._got = 0; this._state = "write";
      this._reply("READY_FOR_DATA:" + this._expect + "\r\nOK\r\n");
    }
    else if (cmd === "VERIFY") this._reply("VERIFY_OK\r\nOK\r\n");
    else if (cmd === "JUMP") this._reply("JUMPING_TO_APP\r\n");
    else if (cmd === "ESP_DETECT")
      this._reply(this.opts.hasEsp ? "ESP32_FOUND\r\nOK\r\n" : "ESP32_NOT_FOUND\r\nOK\r\n", 900);
    else if (cmd.startsWith("ESP_WRITE:")) {
      const parts = cmd.split(":");
      this._expect = parseInt(parts[parts.length - 1], 10); this._got = 0;
      this._reply("ESP_INIT_STARTED\r\nOK\r\n");
      this._state = "espwrite";
      this._reply("ESP_READY_FOR_DATA:" + this._expect + "\r\nOK\r\n", 2500);
    }
    else if (cmd === "ESP_VERIFY") this._reply("ESP_VERIFY_OK\r\nOK\r\n");
    else if (cmd === "ESP_RESET") this._reply("ESP_RESET_OK\r\nOK\r\n");
    else this._reply("UNKNOWN_COMMAND\r\n");
  }
}
