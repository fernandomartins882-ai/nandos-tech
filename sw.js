const CACHE='nandos-tech-v6';
const ASSETS=['./','./index.html','./styles.css','./app.js','./supabase-config.js','./manifest.json','./Captura%20de%20Tela%202026-11-25%20a%CC%80s%2020.02.40.png'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key.startsWith('nandos-tech-')&&key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async cache=>{
      const cached=await cache.match(event.request);
      if(cached) return cached;
      try{
        const response=await fetch(event.request);
        if(response.ok) cache.put(event.request,response.clone());
        return response;
      }catch(error){
        return cached||Response.error();
      }
    })
  );
});
