const CACHE_NAME = 'zero-trace-command-v3';
const COMMAND_SHELL = [
  '/command/manifest.webmanifest?v=approved-20260829',
  '/command/icon-192.png?v=approved-20260829',
  '/command/icon-512.png?v=approved-20260829',
  '/command/icon-512-maskable.png?v=approved-20260829',
  '/command/apple-touch-icon.png?v=approved-20260829'
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
  // Authenticated HTML and the login page are never cached. This worker keeps
  // install metadata offline without retaining an authenticated Command page.
  if (request.method !== 'GET' || request.mode === 'navigate' || url.origin !== self.location.origin || url.pathname.includes('/login/')) return;
});
