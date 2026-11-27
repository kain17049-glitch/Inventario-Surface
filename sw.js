/* Service worker · Inventario Surface v2.4
 * Guarda la app en el celular para abrirla sin señal.
 * Los datos NO pasan por aquí: van directo a Google (Apps Script). */
const VERSION = 'inv-2.7.0';
const APP = ['./', 'index.html', 'offline.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const LIBS = [
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js'
];
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(APP.map(u => new Request(u, {cache: 'reload'})));   /* sin caché del navegador: siempre la versión nueva */
    await Promise.all(LIBS.map(u => c.add(new Request(u, {mode: 'no-cors'})).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                                  /* datos a Google: siempre directo */
  const url = new URL(req.url);
  if (url.hostname.endsWith('google.com') || url.hostname.endsWith('googleusercontent.com')) return;
  const propio = url.origin === self.location.origin;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const guardado = await c.match(req, {ignoreSearch: propio});
    const red = fetch(propio ? new Request(req, {cache: 'no-cache'}) : req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
    if (guardado){ e.waitUntil(red); return guardado; }               /* rápido: lo guardado, y se actualiza por detrás */
    const r = await red;
    if (r) return r;
    if (req.mode === 'navigate') return (await c.match('index.html')) || Response.error();
    return Response.error();
  })());
});
