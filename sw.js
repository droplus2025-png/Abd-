// Service worker: works offline, and always prefers the NEWEST files when online
// (network first, cache as fallback) so a new publication is picked up automatically.
const CACHE = 'pos-shell-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'version.js', 'logo.png', 'icon-192.png', 'icon-512.png',
  'manifest.webmanifest', 'idb-persist.js', 'index.js', 'errors.js', 'money.js', 'phone.js', 'invoice-number.js',
  'memory-store.js', 'permissions.js', 'auth.js', 'post.js', 'parties.js', 'products.js', 'sales.js', 'purchases.js',
  'returns.js', 'payments.js', 'cash.js', 'queries.js', 'settings.js', 'invoice-text.js', 'share.js', 'admin.js',
  'ui-core.js', 'ui-login.js', 'ui-home.js', 'ui-sale.js', 'ui-purchase.js', 'ui-returns.js', 'ui-invoices.js', 'ui-debts.js', 'quick-detail.js', 'ui-stock.js', 'ui-admin.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    fetch(r, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); }
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then((m) => m || caches.match('index.html')))
  );
});
