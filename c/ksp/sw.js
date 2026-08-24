/* GATA Cloud Uploader - service worker.
 *
 * The app shell is served CACHE-FIRST from one versioned cache that is filled
 * atomically at install (addAll: all files of one version or none). This makes
 * mixed old/new page loads impossible - the failure mode where index.html and
 * some scripts come from different versions. Updates flow through the service
 * worker itself: the browser re-checks sw.js on navigation, a bumped
 * APP_CONFIG.version installs a fresh complete cache, and app.js reloads the
 * page when the new worker activates.
 *
 * Everything that is NOT app shell (firmware/, __local_list, tests/) goes
 * straight to the network - firmware files must never come from a stale cache.
 */
importScripts("js/config.js");

/* Cache storage is per-ORIGIN, and every company's app shares this origin
 * (/gata-updater/ and /gata-updater/c/<id>/). The channel has to be part of
 * the name: without it, activating one company's app deleted every cache that
 * was not its own - including the OTHER company's app shell and the firmware
 * stored on the phone for offline use. */
const CHANNEL = APP_CONFIG.channel || "default";
const CACHE = "gata-uploader-" + CHANNEL + "-" + APP_CONFIG.version;
const CACHE_PREFIX = "gata-uploader-" + CHANNEL + "-";
const SHELL = [
  ".", "index.html", "css/app.css", "icon.svg", "icon-maskable.svg", "app.webmanifest",
  "icon-192.png", "icon-512.png", "icon-512-maskable.png", "icon-180.png",
  "img/boot-buttons.svg",
  "js/config.js", "js/i18n.js", "js/util.js", "js/validate.js",
  "js/license.js", "js/dfuse.js", "js/transport.js", "js/gata.js",
  "js/esp.js", "js/cloud.js", "js/localsource.js", "js/mock.js", "js/flows.js", "js/app.js",
];

const SHELL_URLS = new Set(SHELL.map(u => new URL(u, self.registration.scope).href));

/* The firmware that ships WITH the app. builtin.json lists it; storing those
 * files here is what puts the binaries on the phone, so the updater can work
 * with no internet after the first start. A missing/partial list is not fatal
 * - the app simply has no built-in firmware and still works from the cloud. */
async function cacheBuiltinFirmware(cache) {
  try {
    const res = await fetch(new URL("builtin.json", self.registration.scope).href, { cache: "no-store" });
    if (!res.ok) return;
    const list = await res.json();
    const want = [];   // {url, size} - size is what builtin.json says it should be
    for (const f of (list.main_firmware || [])) want.push({ dir: "main_firmware/", f });
    for (const f of (list.cloud_firmware || [])) want.push({ dir: "cloud_firmware/", f });
    const wanted = new Set();

    /* Has the firmware CHANGED, not just its size?
     *
     * Comparing sizes was not enough and hid a nasty one: two builds of the
     * same firmware are very often byte-for-byte the same LENGTH - system
     * firmware 1.0.15 and 1.0.16 are both 121,036 bytes - so a replaced
     * binary looked unchanged and the device kept serving the old one for
     * ever, under the new name. The app then refused to install it, because
     * the delivery receipt no longer matched what it had been handed.
     *
     * The receipt is the authority: it carries a SHA-256 for every file, so
     * its content changes whenever any binary does. If it differs from the
     * copy on this device, everything stored here is stale - throw it away
     * and fetch the set again. */
    const recUrl = new URL("firmware_receipt.json", self.registration.scope).href;
    let receiptChanged = false;
    let complete = true;          // did every listed file end up on the device?
    try {
      const fresh = await fetch(recUrl, { cache: "no-store" });
      if (fresh.ok) {
        const freshText = await fresh.clone().text();
        const held = await cache.match(recUrl);
        const heldText = held ? await held.text() : null;
        receiptChanged = (heldText !== freshText);
        if (receiptChanged) {
          for (const req of await cache.keys()) {
            if (/\/(main_firmware|cloud_firmware)\//.test(req.url)) await cache.delete(req);
          }
        }
      }
    } catch (e) { /* no receipt in this app - the size check below still applies */ }

    for (const w of want) {
      const url = new URL(w.dir + w.f.name, self.registration.scope).href;
      wanted.add(url);
      /* Re-download only what actually differs: the stored copy is compared
       * with the size builtin.json declares, so replacing the firmware inside
       * the app reaches phones that already have an older copy, while an
       * unchanged file costs nothing. */
      let ok = false;
      const have = await cache.match(url);
      if (have && w.f.size) {
        const len = Number(have.headers.get("content-length"));
        if (len === w.f.size) ok = true;
        else if (!len) ok = (await have.clone().arrayBuffer()).byteLength === w.f.size;
      }
      if (ok) continue;
      try {
        const r = await fetch(url, { cache: "reload" });
        if (r.ok) await cache.put(url, r.clone());
        else complete = false;
      } catch (e) { complete = false; /* offline: keep whatever is stored */ }
    }

    /* Firmware that is no longer part of the app must not linger on the phone,
     * or a renamed binary would leave both versions installable. */
    for (const req of await cache.keys()) {
      if (!/\/(main_firmware|cloud_firmware)\//.test(req.url)) continue;
      if (!wanted.has(req.url)) await cache.delete(req);
    }

    /* Store the receipt ONLY once the firmware it describes is really here.
     * Saving it after a failed download would say "this device holds that
     * set" when it does not, and the next start would compare equal and never
     * try again - the stale-copy trap, one level up. */
    const meta = ["builtin.json"];
    if (list.receipt !== false && complete) meta.push("firmware_receipt.json");
    await Promise.all(meta.map(async u => {
      const url = new URL(u, self.registration.scope).href;
      try {
        const r = await fetch(url, { cache: "reload" });
        if (r.ok) await cache.put(url, r.clone());
      } catch (e) { /* ignore */ }
    }));
  } catch (e) { /* offline or not published with firmware - ignore */ }
}

/* The page asks for this on every start (see app.js): a deploy that changes
 * only a .bin leaves sw.js identical, so no install/activate would ever run
 * again and nothing would notice the new firmware. */
self.addEventListener("message", e => {
  if (e.data && e.data.type === "refresh-builtin") {
    e.waitUntil(caches.open(CACHE).then(c => cacheBuiltinFirmware(c)));
  }
});

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // "no-cache": fill the new version's cache from the SERVER, never from
      // the browser's HTTP cache, so one deploy = one consistent set.
      .then(async c => {
        await c.addAll(SHELL.map(u => new Request(u, { cache: "no-cache" })));
        await cacheBuiltinFirmware(c);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    /* Only OUR channel's older caches - never another company's app. The bare
     * "gata-uploader-<version>" names written before channels existed are
     * ours too when we are the shared app, so clean those up as well. */
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE)
        .filter(k => k.startsWith(CACHE_PREFIX) ||
                     (CHANNEL === "default" && /^gata-uploader-\d/.test(k)))
        .map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* The built-in firmware lives in these folders; serve it from the phone's copy
 * first so it keeps working with no internet, and fall back to the network. */
const OFFLINE_PREFIXES = ["main_firmware/", "cloud_firmware/", "builtin.json", "firmware_receipt.json"]
  .map(p => new URL(p, self.registration.scope).href);

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  url.search = "";
  const isShell = SHELL_URLS.has(url.href);
  const isBuiltinFirmware = OFFLINE_PREFIXES.some(p => url.href.startsWith(p));
  if (!isShell && !isBuiltinFirmware) return;   // cloud firmware, listing, tests: network
  e.respondWith(
    caches.open(CACHE)
      .then(c => c.match(e.request, { ignoreSearch: true }))
      .then(r => r || fetch(e.request).then(resp => {
        /* Keep whatever built-in firmware we successfully fetched, so the
         * second start works offline even if the install-time copy missed it. */
        if (isBuiltinFirmware && resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      }))
  );
});
