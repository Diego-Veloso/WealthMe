/* WealthMe offline support (v363).
   - The app's own files: network first, so updates and "Refresh App" always see the live version;
     when there is no connection (or it is very slow) the last saved copy is used.
   - Chart.js and the Inter font: saved on the first visit, then served from the device.
   - Everything else (receipt scanner libraries, the licence server, videos) goes straight to the network. */
const CACHE = 'wealthme-offline-v2';   // v2: fresh start, old saved copies are removed
const CHART = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
const SAVED_PREFIXES = ['https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];
const ROOT = new URL('./', self.location).href;

self.addEventListener('install', (event)=>{
  event.waitUntil((async ()=>{
    const cache = await caches.open(CACHE);
    const add = (u)=> cache.add(new Request(u, {cache: 'reload'})).catch(()=>{});
    await Promise.all([add(ROOT), add(new URL('icon.png', self.location).href), add(CHART)]);
    // Inter: save the stylesheet and the font files it points to
    try{
      const res = await fetch(FONT_CSS, {cache: 'reload'});
      if(res.ok){
        const css = await res.clone().text();
        await cache.put(FONT_CSS, res);
        const urls = Array.from(new Set((css.match(/url\(([^)]+)\)/g) || []).map(m=> m.slice(4, -1).replace(/['"]/g, ''))));
        await Promise.all(urls.map(add));
      }
    }catch(e){}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event)=>{
  event.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=> k.startsWith('wealthme-offline-') && k !== CACHE).map(k=> caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(req, url){
  const cache = await caches.open(CACHE);
  const key = url.origin + url.pathname;                 // ignore ?v=... so the cache never fills with copies
  const cached = await cache.match(key);
  const isNav = req.mode === 'navigate';
  try{
    let res;
    if(isNav && cached){
      const ctrl = new AbortController();
      const timer = setTimeout(()=> ctrl.abort(), 4000);  // slow connection: open the saved copy instead of waiting
      try{ res = await fetch(req.url, {cache: 'no-cache', signal: ctrl.signal}); } finally { clearTimeout(timer); }
    }else{
      // 'no-cache': always ask the server whether the file changed, so a stale copy in the browser's own HTTP cache is never used
      res = isNav ? await fetch(req.url, {cache: 'no-cache'}) : await fetch(req, {cache: 'no-cache'});
    }
    if(res && res.ok && res.type === 'basic') cache.put(key, res.clone());
    return res;
  }catch(e){
    if(cached) return cached;
    if(isNav){ const root = await cache.match(ROOT); if(root) return root; }
    return Response.error();
  }
}

async function savedFirst(req){
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if(hit) return hit;
  const res = await fetch(req);
  if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if(req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if(/\.(mp4|webm|mov)$/i.test(url.pathname)) return;
  if(url.origin === self.location.origin){ event.respondWith(networkFirst(req, url)); return; }
  if(SAVED_PREFIXES.some(p=> req.url.startsWith(p))) event.respondWith(savedFirst(req));
});
