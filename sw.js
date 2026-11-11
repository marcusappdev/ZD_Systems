/* =====================================================================
   ZD Licensing - offline support (same approach as the MJE Service Hub).
   Network first: with a connection everything comes fresh from GitHub
   Pages / the CDN and a copy is kept; with no connection the copy is
   used, so the app still opens.
   Microsoft sign-in and SharePoint (Graph) calls are never cached here -
   the app keeps its own copy of the register in the browser database.
   ===================================================================== */
const SCOPE = new URL(self.registration.scope).pathname;
const CACHE_BASE = "zd-licensing:" + SCOPE + ":", CACHE = CACHE_BASE + "v1";
const NEVER = /(^|\.)(graph\.microsoft\.com|login\.microsoftonline\.com|sharepoint\.com|amazonaws\.com|on\.aws)$/i;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith(CACHE_BASE) && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || NEVER.test(url.hostname)) return;
  const isPage = req.mode === "navigate";
  const isAsset = url.origin === self.location.origin ? url.pathname.startsWith(SCOPE) : url.hostname === "cdn.jsdelivr.net";
  if (!isPage && !isAsset) return;
  const key = isPage ? new Request(url.origin + url.pathname) : req;     // one copy of the page, whatever the query
  e.respondWith((async () => {
    try {
      const res = await withTimeout(fetch(req), isPage ? 8000 : 15000);
      if (res && (res.ok || res.type === "opaque")) { const c = await caches.open(CACHE); c.put(key, res.clone()); }
      return res;
    } catch (err) {
      const hit = await caches.match(key, { ignoreSearch: !isPage });
      if (hit) return hit;
      throw err;
    }
  })());
});
