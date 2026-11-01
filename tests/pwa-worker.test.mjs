import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
const origin='https://erp.example',asset='/_next/static/chunks/app-aabbccdd0011.js';
const photo=i=>`/products/optimized/yola-${i}.aabbccddeeff.256.webp`;
const immutable=(body='asset',type='application/javascript',extra={})=>new Response(body,{headers:{'content-type':type,'cache-control':'public, max-age=31536000, immutable',...extra}});
function worker(){
  const handlers={},stores=new Map(),requests=[];
  const key=value=>new URL(typeof value==='string'?value:value.url,origin).href;
  let network=async()=>immutable(),claims=0,skip=0,storageError=false;
  const caches={
    async open(name){
      if(storageError)throw Error('quota');
      if(!stores.has(name))stores.set(name,new Map());
      const rows=stores.get(name);
      return {match:async request=>rows.get(key(request))?.clone(),put:async(request,response)=>{rows.set(key(request),response.clone());},keys:async()=>[...rows.keys()].map(url=>new Request(url)),delete:async request=>rows.delete(key(request))};
    },
    keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),
  };
  class AbsoluteRequest extends Request {constructor(input,init){super(typeof input==='string'?new URL(input,origin):input,init);}}
  const fetch=async(request,options)=>{requests.push({url:key(request),options});return network(request,options);};
  vm.runInNewContext(source,{self:{location:{origin},addEventListener:(name,fn)=>{handlers[name]=fn;},clients:{claim:async()=>{claims++;}},skipWaiting:()=>{skip++;}},fetch,caches,Request:AbsoluteRequest,Response,URL});
  return {handlers,stores,requests,caches,
    setNetwork:fn=>{network=fn;},breakStorage:()=>{storageError=true;},counts:()=>({claims,skip}),
    async lifecycle(name){let pending;handlers[name]({waitUntil:value=>{pending=value;}});await pending;},
    dispatch(path,{method='GET',mode='cors',headers={},cache='default',settle=true}={}){
      const request={url:new URL(path,origin).href,method,mode,headers:new Headers(headers),cache};
      const background=[];let response;handlers.fetch({request,respondWith:value=>{response=Promise.resolve(value);},waitUntil:value=>background.push(value)});
      return response && (settle?response.then(async result=>{await Promise.all(background);return result;}):response);
    },
  };
}

test('installation stores only static public fallback/icons and never forces activation',async()=>{
  const w=worker();await w.lifecycle('install');assert.equal(w.requests.length,5);
  assert.ok(w.requests.every(r=>r.url.startsWith(origin+'/pwa/')));
  assert.equal(w.counts().skip,0);assert.deepEqual(Object.keys(w.handlers).sort(),['activate','fetch','install','message','notificationclick','push']);
  w.stores.set('soeicam-pwa-old-assets',new Map());w.stores.set('other-app',new Map());
  await w.lifecycle('activate');assert.ok(!w.stores.has('soeicam-pwa-old-assets'));assert.ok(w.stores.has('other-app'));assert.equal(w.counts().claims,1);
});

test('immutable interface files and product photos reuse network responses',async()=>{
  const w=worker();assert.equal(await(await w.dispatch(asset)).text(),'asset');
  w.setNetwork(async()=>{throw Error('offline');});assert.equal(await(await w.dispatch(asset)).text(),'asset');assert.equal(w.requests.length,1);
  w.setNetwork(async()=>immutable('photo','image/webp'));await w.dispatch(photo(1));await w.dispatch(photo(1));assert.equal(w.requests.length,2);
});

test('business reads, every write, RSC, authentication, signed files and external assets bypass the worker',()=>{
  const w=worker();
  for(const path of ['/api/entities/Stock','/api/auth/me','/api/files/sign','/customers?_rsc=secret','/auth/callback?code=secret','/_next/image?url=private','/products/original.jpg','/_next/static/chunks/webpack.js','https://maps.googleapis.com/maps/api/js','https://storage.example/photo.webp?token=private',asset+'?token=private'])assert.equal(w.dispatch(path),undefined,path);
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(w.dispatch('/api/sales',{method}),undefined);
  for(const headers of [{authorization:'Bearer private'},{range:'bytes=0-20'}])assert.equal(w.dispatch(asset,{headers}),undefined);
  assert.equal(w.dispatch(asset,{cache:'no-store'}),undefined);assert.equal(w.requests.length,0);
});

test('customer navigation always uses fresh network content and offline exposes only the static fallback',async()=>{
  const w=worker();w.setNetwork(async request=>new Response(request.url.endsWith('offline.html')?'Offline instructions':'Icon'));await w.lifecycle('install');
  w.setNetwork(async()=>new Response('Customer Alice private profile'));assert.equal(await(await w.dispatch('/customers?customer=alice',{mode:'navigate'})).text(),'Customer Alice private profile');
  assert.equal(w.requests.at(-1).options.cache,'no-store');
  assert.ok(![...w.stores.values()].some(rows=>[...rows.keys()].some(url=>url.includes('customers'))));
  w.setNetwork(async()=>{throw Error('offline');});assert.equal(await(await w.dispatch('/customers?customer=bob',{mode:'navigate'})).text(),'Offline instructions');
  assert.equal(await(await w.dispatch('/pwa/icon-192.png')).text(),'Icon');
  assert.equal(w.dispatch('/api/sales',{mode:'navigate'}),undefined);assert.equal(w.dispatch('/auth/callback',{mode:'navigate'}),undefined);
});

test('HTTP errors and sign-in redirects are returned intact without caching or showing offline content',async()=>{
  const w=worker();w.setNetwork(async()=>new Response('permission denied',{status:403}));
  assert.equal((await w.dispatch('/inventory',{mode:'navigate'})).status,403);
  w.setNetwork(async()=>Response.redirect(origin+'/login',302));assert.equal((await w.dispatch('/inventory',{mode:'navigate'})).status,302);
  assert.equal(w.stores.size,0);
});

test('private/no-store, wrong content type, oversized files, cookies and error responses never enter the asset cache',async()=>{
  for(const response of [
    immutable('private','application/javascript',{'cache-control':'private, immutable'}),
    immutable('secret','application/javascript',{'cache-control':'no-store, immutable'}),
    immutable('login','text/html'),immutable('secret','application/javascript',{'set-cookie':'session=x'}),
    immutable('variant','application/javascript',{'vary':'*'}),
    new Response('error',{status:500}),Response.redirect(origin+'/login'),
    immutable('x'.repeat(2*1024*1024+1)),
  ]){
    const w=worker();w.setNetwork(async()=>response.clone());await w.dispatch(asset);assert.equal(w.stores.get('soeicam-pwa-v2-assets').size,0);
  }
});

test('concurrent photo loads and script loads enforce their own bounded caches',async()=>{
  const w=worker();w.setNetwork(async()=>immutable('photo','image/webp'));
  await Promise.all(Array.from({length:105},(_,i)=>w.dispatch(photo(i))));
  const photos=w.stores.get('soeicam-pwa-v2-photos');assert.equal(photos.size,96);assert.ok(!photos.has(origin+photo(0)));
  w.setNetwork(async()=>immutable());await Promise.all(Array.from({length:70},(_,i)=>w.dispatch(`/_next/static/chunks/${i}-aabbccdd0011.js`)));
  assert.equal(w.stores.get('soeicam-pwa-v2-assets').size,64);assert.equal(photos.size,96);
});

test('storage failure cannot prevent online loading or a meaningful offline fallback',async()=>{
  const w=worker();w.breakStorage();assert.equal(await(await w.dispatch(asset)).text(),'asset');
  w.setNetwork(async()=>{throw Error('offline');});const response=await w.dispatch('/',{mode:'navigate'});assert.equal(response.status,503);assert.match(await response.text(),/Reconnect/);
});

test('slow storage writes do not delay delivery of network assets to the page',async()=>{
  const w=worker(),open=w.caches.open;let release,delivered=false;
  const blocked=new Promise(resolve=>{release=resolve;});
  w.caches.open=async name=>{const cache=await open(name);return {...cache,put:async(...args)=>{await blocked;return cache.put(...args);}};};
  try{
    const response=w.dispatch(asset,{settle:false}).then(value=>{delivered=true;return value;});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(delivered,true);assert.equal(await(await response).text(),'asset');
  }finally{release();}
});
