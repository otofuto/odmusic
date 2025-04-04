var CACHE_NAME = "odmusic-20250404-03";
var urlsToCache = [
	"/index.html",
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches
        .open(CACHE_NAME)
        .then(function(cache){
            return cache.addAll(urlsToCache);
        })
    );
});

self.addEventListener('fetch', (event) => {
    try {
        event.respondWith(fetch(event.request));
    } catch {}
});

self.addEventListener('activate', function(event) { 
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.filter(function(cacheName) {
                    return cacheName !== CACHE_NAME;
                }).map(function(cacheName) {
                    console.info("delete cache: " + cacheName);
                    return caches.delete(cacheName);
                })
            );
        }).then(() => {
            self.clients.claim();
        })
    );
});