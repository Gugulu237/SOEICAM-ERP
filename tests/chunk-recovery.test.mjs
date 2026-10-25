import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {isChunkLoadFailure,recoverChunkLoad} from '../src/lib/chunk-recovery.js';
import {verifyLocalInterface} from '../scripts/local-readiness.mjs';
const require=createRequire(import.meta.url);
test('stale chunks reload once per minute, preserve the current URL and never reload business errors',()=>{
  const values=new Map(),visits=[];const browser={sessionStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},location:{pathname:'/sales/new',href:'http://localhost:5175/sales/new?customer=one',reload:()=>visits.push(browser.location.href)}};
  const chunk=Object.assign(Error('Loading chunk app/layout failed.'),{name:'ChunkLoadError'});
  assert.equal(recoverChunkLoad(chunk,browser,100000),true);assert.equal(recoverChunkLoad(chunk,browser,100001),false);assert.equal(visits.length,1);assert.equal(visits[0],browser.location.href);
  assert.equal(recoverChunkLoad(Error('Insufficient stock'),browser,200000),false);assert.equal(recoverChunkLoad(chunk,browser,160001),true);
  assert.equal(isChunkLoadFailure(Error('Failed to fetch dynamically imported module: /_next/static/view.js')),true);
  assert.equal(isChunkLoadFailure(Error('Loading CSS chunk 7 failed.')),true);
});
test('blocked browser storage leaves manual reload available without automatic loops',()=>{
  let reloads=0;const browser={location:{pathname:'/',reload:()=>reloads++},get sessionStorage(){throw Error('Storage blocked');}};
  assert.equal(recoverChunkLoad({name:'ChunkLoadError'},browser),false);assert.equal(reloads,0);assert.equal(recoverChunkLoad({name:'ChunkLoadError'},null),false);
});
test('root error UI renders without the failed provider, authentication SDKs or global styles',async()=>{
  const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import ErrorPage from './src/app/global-error.jsx';export const render=()=>renderToStaticMarkup(React.createElement(ErrorPage,{error:{name:'ChunkLoadError'}}));",loader:'jsx',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,metafile:true});
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
  const html=module.exports.render();assert.match(html,/<html/);assert.match(html,/<body/);assert.match(html,/Reload page/);assert.match(html,/SOEICAM ERP/);
  assert.ok(Object.keys(output.metafile.inputs).every(p=>!/@clerk|@supabase|locales\/fr|providers\.jsx/.test(p)));
});
const health={application:'SOEICAM ERP',configured:true};
const page='<script src="/_next/static/chunks/app/layout.js"></script><link href="/_next/static/css/app/layout.css">';
test('readiness downloads shared layout scripts once and checks real pages as well as health',async()=>{
  const calls=[];const result=await verifyLocalInterface('http://localhost:5175',{pages:['/login','/'],fetcher:async url=>{calls.push(url.pathname);return url.pathname==='/api/health'?Response.json(health):url.pathname.endsWith('.js')?new Response('window.layoutLoaded=true',{headers:{'content-type':'application/javascript'}}):url.pathname.endsWith('.css')?new Response('body{}',{headers:{'content-type':'text/css'}}):new Response(page);}});
  assert.equal(result.pages,2);assert.equal(result.assets,2);assert.deepEqual(calls,['/api/health','/login','/','/_next/static/chunks/app/layout.js','/_next/static/css/app/layout.css']);
});
test('readiness refuses missing chunks and HTML accidentally returned as JavaScript',async()=>{
  for(const response of [()=>new Response('missing',{status:404}),()=>new Response('<html>error</html>',{headers:{'content-type':'text/html'}})]){
    await assert.rejects(verifyLocalInterface('http://localhost:5175',{fetcher:async url=>url.pathname==='/api/health'?Response.json(health):url.pathname==='/login'?new Response(page):response()}),/HTTP 404|did not return JavaScript/);
  }
});
