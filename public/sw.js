/* SOEICAM: cache public assets only. Never store ERP records or replay writes. */
const PREFIX = 'soeicam-pwa-';
const VERSION = 'v2';
const SHELL = `${PREFIX}${VERSION}-shell`;
const ASSETS = `${PREFIX}${VERSION}-assets`;
const PHOTOS = `${PREFIX}${VERSION}-photos`;
const OFFLINE = '/pwa/offline.html';
const SHELL_FILES = [OFFLINE, '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/maskable-512.png', '/pwa/apple-touch-icon.png'];
const CURRENT = [SHELL, ASSETS, PHOTOS];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    for (const url of SHELL_FILES) {
      const response = await fetch(new Request(url, {cache: 'reload', credentials: 'omit'}));
      if (!response.ok || response.redirected) throw new Error('PWA assets unavailable');
      await cache.put(url, response);
    }
    // Do not skipWaiting: other windows may contain unfinished transactions.
  })());
});

// Device metadata is separate from asset caches and contains no ERP records.
const DEVICE_CACHE='soeicam-device-notifications-v1';
const BINDING='/__soeicam_notification_binding__';
const SEEN='/__soeicam_notification_seen__';
self.addEventListener('message',event=>{
  if(event.data?.type==='SOEICAM_PUSH_CAPABILITY')event.ports?.[0]?.postMessage({push:1});
});
async function deviceBinding() {
  try{return await(await(await caches.open(DEVICE_CACHE)).match(BINDING))?.json();}catch{return null;}
}
let pushWork=Promise.resolve();
self.addEventListener('push',event=>{
  pushWork=pushWork.catch(()=>{}).then(async()=>{
    let data;try{data=event.data?.json();}catch{return;}
    const binding=await deviceBinding();
    if(!binding?.deviceId || data?.deviceId!==binding.deviceId || data.version!==1 || !['production','test'].includes(data.kind)
      || typeof data.eventId!=='string' || !/^[a-zA-Z0-9-]{1,100}$/.test(data.eventId) || typeof data.sound!=='boolean'
      || !Number.isFinite(data.expiresAt) || data.expiresAt<Date.now() || data.expiresAt>Date.now()+600000)return;
    const cache=await caches.open(DEVICE_CACHE),previous=await cache.match(SEEN);
    const ids=previous?await previous.json().catch(()=>[]):[];
    const key=data.deviceId+':'+data.eventId;if(Array.isArray(ids)&&ids.includes(key))return;
    const latest=await deviceBinding();if(latest?.deviceId!==binding.deviceId)return;
    const sound=data.sound&&latest.sound!==false;
    const fr=data.language!=='en',test=data.kind==='test';
    await self.registration.showNotification('SOEICAM',{
      body:test?(fr?'Les notifications de cet appareil fonctionnent.':'Device notifications are working.'):(fr?'Nouvelle alerte de production. Ouvrez SOEICAM pour la consulter.':'New production alert. Open SOEICAM to review.'),
      icon:'/pwa/icon-192.png',tag:'soeicam-'+key,renotify:false,silent:!sound,
      ...(sound?{vibrate:[180,80,180]}:{}),
      data:{deviceId:data.deviceId,path:test?'/profile':'/manufacturing'},
    });
    if((await deviceBinding())?.deviceId!==binding.deviceId){
      const shown=await self.registration.getNotifications({tag:'soeicam-'+key});shown.forEach(notification=>notification.close());return;
    }
    await cache.put(SEEN,new Response(JSON.stringify([...(Array.isArray(ids)?ids:[]),key].slice(-100)),{headers:{'Content-Type':'application/json'}}));
  });
  event.waitUntil(pushWork.catch(()=>{}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const binding=await deviceBinding(),data=event.notification.data;
    if(!binding || binding.deviceId!==data?.deviceId || !['/profile','/manufacturing'].includes(data.path))return;
    const target=new URL(data.path,self.location.origin).href;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>client.url===target);
    if(existing)return existing.focus();
    // Do not navigate an unrelated window that may contain an unfinished sale.
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && !CURRENT.includes(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function publicAsset(url, request) {
  if (url.search || request.headers.has('authorization') || request.headers.has('range') || request.cache === 'no-store') return null;
  if (/^\/products\/optimized\/[a-z0-9-]+\.[a-f0-9]{12}\.\d+\.webp$/.test(url.pathname)) {
    return {name: PHOTOS, limit: 96, bytes: 384 * 1024, mime: /^image\/webp\b/};
  }
  if (url.pathname.startsWith('/_next/static/') && /[a-f0-9]{8,}/.test(url.pathname) && /\.(?:js|css|woff2?)$/.test(url.pathname)) {
    return {name: ASSETS, limit: 64, bytes: 2 * 1024 * 1024, mime: /^(?:application\/(?:javascript|x-javascript|font-woff)|text\/(?:javascript|css)|font\/(?:woff2?|ttf))\b/};
  }
  return null;
}

// Serialize only cache writes, keeping size limits reliable during concurrent loads.
let writes = Promise.resolve();
async function assetResponse(request, policy, event) {
  let cache;
  try {
    cache = await caches.open(policy.name);
    const hit = await cache.match(request);
    if (hit) return hit;
  } catch { /* Storage can be unavailable; network still works. */ }
  const response = await fetch(request);
  const control = response.headers.get('cache-control') || '';
  if (!cache || response.status !== 200 || response.redirected || !['basic', 'default'].includes(response.type)
    || /private|no-store|no-cache/i.test(control) || !/immutable/i.test(control)
    || response.headers.has('set-cookie') || response.headers.get('vary') === '*'
    || !policy.mime.test(response.headers.get('content-type') || '')) return response;
  const copy = response.clone();
  writes = writes.catch(() => {}).then(async () => {
    const bytes = await copy.arrayBuffer();
    if (bytes.byteLength > policy.bytes) return;
    await cache.put(request, new Response(bytes, {status: 200, headers: copy.headers}));
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - policy.limit)).map(key => cache.delete(key)));
  }).catch(() => { /* A full cache must never stop the app loading. */ });
  // Keep the worker alive for the write without delaying the page's response.
  event.waitUntil(writes);
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Auth routes, API, RSC requests, signed files and third-party content bypass caching.
  if (request.mode === 'navigate') {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
    event.respondWith(fetch(request, {cache: 'no-store'}).catch(async () => {
      try {
        const offline = await (await caches.open(SHELL)).match(OFFLINE);
        if (offline) return offline;
      } catch { /* Fall back even when browser storage is unavailable. */ }
      return new Response('SOEICAM is offline. Reconnect and try again. / Reconnectez-vous puis réessayez.', {
        status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'},
      });
    }));
    return;
  }
  const policy = publicAsset(url, request);
  if (policy) event.respondWith(assetResponse(request, policy, event));
  else if (!url.search && SHELL_FILES.includes(url.pathname)) {
    event.respondWith(caches.open(SHELL).then(cache => cache.match(url.pathname)).then(hit => hit || fetch(request)).catch(() => fetch(request)));
  }
});
