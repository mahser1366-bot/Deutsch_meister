const CACHE = 'deutsch-meister-v3.7.0';
const RUNTIME_CACHE = 'deutsch-meister-voice-runtime-v1';
const PREFIX = 'deutsch-meister-';
const CORE = [
  './', './index.html', './manifest.json',
  './css/tokens.css', './css/app.css',
  './js/app.js', './js/csv.js', './js/db.js',
  './js/scheduler.js', './js/challenges.js', './js/voice-manager.js',
  './js/voice-worker.js', './js/piper-core.js',
  './assets/icon-192.png', './assets/icon-512.png'
];
const RUNTIME_FILES = Object.freeze({
  'ort.wasm.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/ort.wasm.min.js',
  'ort-wasm-simd.wasm': 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/ort-wasm-simd.wasm',
  'ort-wasm.wasm': 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/ort-wasm.wasm',
  'piper_phonemize.js': 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.js',
  'piper_phonemize.wasm': 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm',
  'piper_phonemize.data': 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data'
});

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(PREFIX) && key !== CACHE && key !== RUNTIME_CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const runtimeName = url.pathname.split('/').pop();
  const runtimeUrl = url.pathname.includes('/runtime/') ? RUNTIME_FILES[runtimeName] : null;
  if (runtimeUrl) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(runtimeUrl, { mode: 'cors', credentials: 'omit' });
        if (response.ok && response.type !== 'opaque') await cache.put(event.request, response.clone());
        return response;
      } catch {
        return new Response('Voice runtime asset is not cached and the device is offline.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch {
      if (event.request.mode === 'navigate') return cache.match('./index.html');
      return new Response('This file is not available offline.', { status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  }));
});
