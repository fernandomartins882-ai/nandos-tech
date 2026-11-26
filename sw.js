const CACHE='nandos-tech-v2';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.json','./Captura%20de%20Tela%202026-11-25%20a%CC%80s%2020.02.40.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));