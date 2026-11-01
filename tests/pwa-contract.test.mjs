import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import manifest from '../src/app/manifest.js';
import config from '../next.config.mjs';
import {queryClientInstance as client} from '../src/lib/query-client.js';
import {onlineManager} from '@tanstack/react-query';
const require=createRequire(import.meta.url);

test('manifest has stable identity, standalone display, real square icons and no role-specific launch bypass',()=>{
  const data=manifest();assert.equal(data.id,'/');assert.equal(data.start_url,'/');assert.equal(data.scope,'/');assert.equal(data.display,'standalone');
  assert.ok(data.icons.some(icon=>icon.purpose==='maskable'));
  for(const icon of data.icons){const png=fs.readFileSync(new URL('../public'+icon.src,import.meta.url));const [width,height]=icon.sizes.split('x').map(Number);assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),height);}
});

test('worker update headers prevent stale worker code while API responses remain private',async()=>{
  const headers=await config.headers();const worker=Object.fromEntries(headers.find(row=>row.source==='/sw.js').headers.map(h=>[h.key,h.value]));
  assert.match(worker['Cache-Control'],/no-store/);assert.match(worker['Content-Type'],/javascript/);assert.equal(worker['Service-Worker-Allowed'],'/');
  assert.equal(headers.find(row=>row.source==='/api/:path*').headers.find(h=>h.key==='Cache-Control').value,'private, no-store');
});

test('public PWA files bypass auth proxy while ERP pages and APIs still pass through authentication',async()=>{
  const compiled=await build({entryPoints:['src/proxy.js'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'auth-isolated',setup(b){
    b.onResolve({filter:/^@supabase\/ssr$|^@clerk\/nextjs\/server$|^next\/server$|^\.\/lib\/auth-provider$|^\.\/server\/clerk-response$/},a=>({path:a.path,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const createServerClient=()=>{},NextResponse={},clerkMiddleware=()=>()=>{},usesClerk=()=>false,resumeClerkRequest=()=>{};'}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,module,module.exports);
  const matcher=new RegExp('^'+module.exports.config.matcher[0]+'$');
  for(const path of ['/sw.js','/manifest.webmanifest','/pwa/icon-192.png','/pwa/offline.html'])assert.equal(matcher.test(path),false,path);
  for(const path of ['/customers','/api/auth/me','/sales/new','/inventory','/sw.js-secret','/manifest.webmanifest-private'])assert.equal(matcher.test(path),true,path);
});

test('an offline mutation fails immediately and never executes automatically after reconnection',async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');let calls=0;
  try{
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});onlineManager.setOnline(false);client.mount();
    const mutation=client.getMutationCache().build(client,{mutationFn:async()=>{calls++;return 'posted';}});
    await assert.rejects(mutation.execute({receipt:'fixture-only'}),/offline/);assert.equal(calls,0);assert.equal(mutation.state.isPaused,false);
    globalThis.navigator.onLine=true;onlineManager.setOnline(true);await client.resumePausedMutations();assert.equal(calls,0);
    const online=client.getMutationCache().build(client,{mutationFn:async()=>{calls++;return 'posted';}});assert.equal(await online.execute({}),'posted');assert.equal(calls,1);
  }finally{client.unmount();client.clear();onlineManager.setOnline(true);if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
});

test('network failure is not retried and cannot look like a successful business submission',async()=>{
  let calls=0;const mutation=client.getMutationCache().build(client,{mutationFn:async()=>{calls++;throw Error('connection lost');}});
  try{await assert.rejects(mutation.execute({}),/connection lost/);assert.equal(calls,1);assert.equal(mutation.state.status,'error');assert.equal(mutation.state.isPaused,false);}finally{client.clear();}
});
