// Service worker for tools/tournament-calculator.html ONLY.
// See specs/calculator-pwa-spec.md in the SAGE project folder for the design
// this implements. Scope is bound to the calculator's own page path via the
// registration call in tournament-calculator.html (not the directory), and
// this fetch handler passes everything it doesn't explicitly own straight to
// the network — most importantly scoresheet-generator.html, which lives in
// this same /tools/ directory and must never be served from cache.

const CACHE = 'sage-calc-v1';

// Same-origin shell — precached atomically. If any of these fail to fetch,
// the whole install fails, which is the right behavior for the app's own
// document and icons.
const SHELL = [
  '/tools/tournament-calculator.html',
  '/assets/logo.png',
  '/assets/favicons/android-chrome-192x192.png',
  '/assets/favicons/android-chrome-512x512.png'
];

// Third-party — precached opportunistically. A cdnjs or Google Fonts blip
// must never prevent the app from installing; only the export button (for
// SheetJS) or font rendering degrades, and both get picked up on next fetch.
const OPTIONAL = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  await Promise.allSettled(OPTIONAL.map(u => cache.add(u)));
  self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()));

const CACHE_FIRST_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

function isDocumentRequest(req){
  return req.mode === 'navigate' ||
    (req.destination === 'document') ||
    req.url.endsWith('/tools/tournament-calculator.html');
}

function isOwnedStaticAsset(url){
  if (url.origin === self.location.origin) {
    return url.pathname === '/assets/logo.png' ||
      url.pathname === '/assets/favicons/android-chrome-192x192.png' ||
      url.pathname === '/assets/favicons/android-chrome-512x512.png';
  }
  return CACHE_FIRST_HOSTS.includes(url.hostname);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // The calculator's own document: network-first, cache fallback. This is
  // what lets a pushed fix land on the next launch instead of the one after
  // — see spec §6.1. Everything the app renders lives inline in this file.
  if (isDocumentRequest(req) && url.pathname === '/tools/tournament-calculator.html') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  // Fonts, SheetJS, and this app's own static icons/logo: cache-first,
  // falling back to network and caching the result for next time (this is
  // how the gstatic font FILES get cached, since they aren't in SHELL/
  // OPTIONAL — only the stylesheet that references them is).
  if (isOwnedStaticAsset(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    })());
    return;
  }

  // Everything else — every other page on this site, including
  // scoresheet-generator.html in this same directory, and its POST to Cloud
  // Run — is deliberately left untouched. No respondWith() means the browser
  // handles it exactly as if this service worker did not exist.
});
