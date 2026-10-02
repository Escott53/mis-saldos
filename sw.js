/* Service worker de Mis Saldos.
   IMPORTANTE: incrementa CACHE_VERSION en cada despliegue para que los móviles reciban la nueva versión. */
const CACHE_VERSION = 3;
const CACHE = `mis-saldos-v${CACHE_VERSION}`;
const ASSETS = [
  './', './index.html', './styles.css', './manifest.json',
  './js/app.js', './js/vault.js', './js/providers.js', './js/btc.js', './js/degiro.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('mis-saldos-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Las APIs externas (precios, saldos, VL) nunca se cachean: siempre datos frescos de la red.
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // Archivos propios: caché primero (funciona sin conexión), actualizando en segundo plano.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
