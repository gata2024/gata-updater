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

const CACHE = "gata-uploader-" + APP_CONFIG.version;
const SHELL = [
  ".", "index.html", "css/app.css", "icon.svg", "icon-maskable.svg", "app.webmanifest",
  "icon-192.png", "icon-512.png", "icon-512-maskable.png", "icon-180.png",
  "img/boot-buttons.svg",
  "js/config.js", "js/i18n.js", "js/util.js", "js/validate.js",
  "js/license.js", "js/dfuse.js", "js/transport.js", "js/gata.js",
  "js/esp.js", "js/cloud.js", "js/localsource.js", "js/mock.js", "js/flows.js", "js/app.js",
];

const SHELL_URLS = new Set(SHELL.map(u => new URL(u, self.registration.scope).href));

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // "no-cache": fill the new version's cache from the SERVER, never from
      // the browser's HTTP cache, so one deploy = one consistent set.
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "no-cache" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  url.search = "";
  if (!SHELL_URLS.has(url.href)) return;      // firmware, listing, tests: network
  e.respondWith(
    caches.open(CACHE)
      .then(c => c.match(e.request, { ignoreSearch: true }))
      .then(r => r || fetch(e.request))
  );
});
