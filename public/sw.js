// キャッシュ名を変えると、activate時に古いキャッシュが丸ごと削除される。
// v1はページ本体(HTML)まで永久にキャッシュしてしまい、デプロイしても古い画面が
// 出続けていたため、v2に上げて一度すべて捨てる。
const CACHE_NAME = "scorebridge-cache-v2";
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin GET requests; let everything else pass through.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // ビルドごとにファイル名が変わる/_next/static/と、中身が変わらない音源・フォント・
  // アイコンだけはキャッシュ優先にする。それ以外（ページ本体のHTML等）はネットワーク
  // 優先にし、オフラインの時だけキャッシュを返す（新しいデプロイが常に反映されるように）。
  const { pathname } = new URL(request.url);
  const isImmutableAsset =
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/audio/") ||
    pathname.startsWith("/fonts/") ||
    /^\/icon-\d+\.png$/.test(pathname);

  event.respondWith(isImmutableAsset ? cacheFirst(request) : networkFirst(request));
});

function putInCache(request, response) {
  if (response.ok) {
    const responseClone = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
  }
  return response;
}

function cacheFirst(request) {
  return caches.match(request).then((cached) => cached || fetch(request).then((response) => putInCache(request, response)));
}

function networkFirst(request) {
  return fetch(request)
    .then((response) => putInCache(request, response))
    .catch(() => caches.match(request).then((cached) => cached || Response.error()));
}
