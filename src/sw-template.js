/* Service worker – generuje ho vite.config.ts (plugin elixir-sw) ze šablony. Neupravuj build/sw.js ručně. */
const VERSION = '__VERSION__';
const CACHE = `elixir-sort-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  // cache: 'reload' obchází HTTP cache: hosting může HTML držet několik minut a stará stránka
  // by po nasazení odkazovala na soubory, které už na serveru nejsou.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('elixir-sort-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Aplikace je jedna stránka: vždy z cache (offline), síť jen jako záloha.
    // Cachuje se jen './': některé hostingy přesměrují /index.html a přesměrovanou odpověď
    // prohlížeč při navigaci odmítne, takže by se hra offline neotevřela.
    event.respondWith(caches.match('./', { ignoreSearch: true }).then((cached) => cached || fetch(req)));
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
