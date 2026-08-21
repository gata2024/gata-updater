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
    const urls = [];
    for (const f of (list.main_firmware || [])) urls.push("main_firmware/" + f.name);
    for (const f of (list.cloud_firmware || [])) urls.push("cloud_firmware/" + f.name);
    urls.push("builtin.json");
    if (list.receipt !== false) urls.push("firmware_receipt.json");
    await Promise.all(urls.map(u =>
      cache.add(new URL(u, self.registration.scope).href).catch(() => {})));
  } catch (e) { /* offline or not published with firmware - ignore */ }
}

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
