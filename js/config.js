/* GATA Cloud Uploader - central configuration.
 * Also loaded by the service worker (sw.js) via importScripts, so keep it
 * dependency-free and side-effect-free.
 */
"use strict";

const APP_CONFIG = {
  version: "1.6.2",                       // bump on every deploy (drives the offline cache)
  productName: "GATA",

  /* Where firmware comes from, tried in this order (first one that answers):
   *  1. "__fw/manifest.json"  - the local server's proxy to the company
   *     firmware repository (installed app; no CORS setup, token stays local);
   *  2. cloudManifestUrl      - direct download (hosted copy / Android; the
   *     firmware server must send Access-Control-Allow-Origin);
   *  3. defaultManifestUrl    - the copy bundled in this folder (offline).
   * A BAD SIGNATURE is always fatal - it never falls through to the next one. */
  proxyManifestUrl: "__fw/manifest.json",
  cloudManifestUrl: "https://git.gatasys.com/Software/gata-firmware/raw/branch/main/manifest.json",
  defaultManifestUrl: "firmware/manifest.json",

  // USB identities (from USBupdaterCode descriptors / STM32 ROM)
  dfuVid: 0x0483, dfuPid: 0xDF11,         // "DFU in FS Mode" (ROM bootloader)
  cdcVid: 0x0483, cdcPid: 0x5740,         // "STM32 Bootloader" (update firmware)

  // Memory layout
  systemFlashAddr: 0x08000000,            // internal flash (B1/B3)
  systemFlashMax: 128 * 1024,             // STM32H750: single 128 KB sector
  appFlashAddr: 0x90000000,               // external QSPI flash (M*.bin)
  appFlashMax: 16 * 1024 * 1024,          // W25Q128 = 16 MB

  // Behaviour
  historyMax: 20,                         // update-history entries kept
  cacheMaxFiles: 30,                      // firmware files kept in IndexedDB

  // Firmware-list signing (anti-tamper): the ECDSA P-256 PUBLIC key is pinned
  // here; manifest.json must carry a valid manifest.json.sig or the app
  // refuses the list. The matching PRIVATE key lives ONLY in
  // tools/signing_key.json on the release PC - never publish that file.
  // Managed by tools/make_signing_key.ps1 - keep this on ONE line.
  signingPublicKey: {"kty":"EC","crv":"P-256","x":"rxMOSG5w5UB7vQF8Zxo56Fa1jBTSVl5MZIO4CH6eGso","y":"hYEieTzrcSaFGoP4OhibV5VplLgv4bLGxVfJbILPdtE"},
};
