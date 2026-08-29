const CACHE_NAME = 'zero-trace-command-v1';
const COMMAND_SHELL = [
  '/command/',
  '/command/manifest.webmanifest',
  '/command/icon-192.png',
  '/command/icon-512.png',
  '/command/icon-512-maskable.png',
  '/command/apple-touch-icon.png',
  '/command/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(COMMAND_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('zero-trace-command-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const isCommandNavigation = request.method === 'GET'
    && request.mode === 'navigate'
    && url.origin === self.location.origin
    && url.pathname.startsWith('/command/');

  // This worker's scope is /command/, but retain an explicit guard: no APIs,
  // public-site pages, or non-navigation resources are intercepted.
  if (!isCommandNavigation) return;

  event.respondWith(fetch(request).catch(() => caches.match('/command/')));
});
