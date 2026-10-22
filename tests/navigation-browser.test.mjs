import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const chrome = process.env.SOEICAM_TEST_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('real browser Back/Forward, list state, sidebar resume, reload and scrolling', { skip: !chrome, timeout: 60000 }, async () => {
  // The routing adapter uses native history and deliberately drops custom state on
  // push/replace, matching Next. The tested provider, hooks, toolbar and table are real.
  const routerFixture = `import {useSyncExternalStore,useMemo} from 'react';
    const listeners=new Set(); const emit=()=>listeners.forEach(fn=>fn()); addEventListener('popstate',emit);
    const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
    const useUrl=()=>useSyncExternalStore(subscribe,()=>location.href,()=>'/inventory');
    export const fixtureRouter={push(href){history.pushState({__NA:true},'',href);emit()},replace(href){history.replaceState({__NA:true},'',href);emit()},back(){history.back()},forward(){history.forward()}};
    export const useRouter=()=>fixtureRouter;
    export const usePathname=()=>new URL(useUrl()).pathname;
    export function useSearchParams(){const url=useUrl();return useMemo(()=>new URL(url).searchParams,[url])}
    export const useParams=()=>({});`;
  const entry = `import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
    import {NavigationProvider} from './src/lib/navigation-context';
    import {Link,useNavigate,useSearchParams,useBack,useLocation} from './src/lib/router';
    import NavigationHistory from './src/components/layout/NavigationHistory';
    import DataTable from './src/components/shared/DataTable';
    function Page(){const {pathname}=useLocation(),navigate=useNavigate(),back=useBack('/inventory'),[params,setParams]=useSearchParams();const [ready,setReady]=useState(false);
      useEffect(()=>{setReady(false);const timer=setTimeout(()=>setReady(true),200);return()=>clearTimeout(timer)},[pathname]);
      if(pathname==='/commercial')return <h1>Commercial workspace</h1>;
      if(pathname.startsWith('/items/'))return <><h1>Item detail</h1><button id="detail-back" onClick={back}>Back</button></>;
      return <><h1>Warehouse</h1><button id="choose-items" onClick={()=>setParams(q=>{q.set('section','items');return q})}>Items</button><p id="section">{params.get('section')||'warehouses'}</p>{ready?<DataTable columns={[{key:'name',label:'Name'}]} searchFields={['name']} pageSize={5} data={Array.from({length:20},(_,i)=>({id:String(i),name:'Product '+String(i).padStart(2,'0')}))} onRowClick={row=>navigate('/items/'+row.id)}/>:<p>Loading inventory</p>}<div style={{height:ready?2200:0}}>End of list</div></>}
    function App(){const {pathname}=useLocation();return <NavigationProvider identity="browser-test"><NavigationHistory/><Link id="warehouse-link" to="/inventory" resume>Warehouse</Link><Link id="commercial-link" to="/commercial">Commercial</Link><Page key={pathname}/></NavigationProvider>}
    createRoot(document.getElementById('root')).render(<App/>);`;
  const compiled = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'navigation-fixtures', setup(builder) {
    builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:^|\/)hooks\/useCurrentUser$/ }, () => ({ path: 'user', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'jsx', resolveDir: process.cwd(), contents: args.path === 'user' ? "export const useCurrentUser=()=>({role:'admin'});" : args.path === 'next/navigation' ? routerFixture : `import React from 'react';import {fixtureRouter} from 'next/navigation';export default React.forwardRef(function Link({href,replace,onNavigate,onClick,children,...props},ref){return <a {...props} ref={ref} href={href} onClick={e=>{onClick?.(e);if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.shiftKey)return;e.preventDefault();let blocked=false;onNavigate?.({preventDefault(){blocked=true}});if(!blocked)fixtureRouter[replace?'replace':'push'](href)}}>{children}</a>});` }));
  } }] });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? compiled.outputFiles[0].text : '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(path.join(tmpdir(), 'soeicam-navigation-test-'));
  let browser, socket;
  try {
    browser = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-background-networking', '--disable-sync', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Browser did not start')), 12000);
      browser.once('error', error => { clearTimeout(timer); reject(error); });
      browser.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let id = 0; const pending = new Map(), errors = [];
    socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); if (pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(Error(message.error.message)) : resolve(message.result); } });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const request = ++id; pending.set(request, { resolve, reject }); socket.send(JSON.stringify({ id: request, method, params, ...(sessionId ? { sessionId } : {}) })); });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); if (result.exceptionDetails) throw Error(result.exceptionDetails.text); return result.result.value; };
    const until = async expression => { for (let tries = 0; tries < 70; tries++) { if (await evaluate('Boolean(' + expression + ')')) return; if (errors.length) throw Error(errors.join('\n')); await delay(70); } throw Error('Not satisfied: ' + expression + '\n' + await evaluate("JSON.stringify({url:location.href,y:scrollY,height:document.documentElement.scrollHeight,text:document.body.innerText.slice(0,500),saved:JSON.parse(sessionStorage.getItem('soeicam-navigation-v1:browser-test'))})")); };
    await send('Runtime.enable', {}, sessionId);
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/inventory` }, sessionId);
    await until("document.querySelector('[aria-label=\"Next records\"]') && sessionStorage.length > 0");
    await evaluate("document.getElementById('choose-items').click()");
    await until("location.search==='?section=items' && !document.querySelector('[aria-label=\"Previous page\"]').disabled");
    await evaluate(`const input=document.querySelector('[aria-label="Search records"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Product');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label="Next records"]').click();`);
    await until("document.body.textContent.includes('Page 2 of 4')");
    await evaluate("dispatchEvent(new WheelEvent('wheel'));window.scrollTo(0,700)"); await until("scrollY>=690");
    await evaluate("document.querySelector('tbody tr').click()");
    await until("location.pathname.startsWith('/items/') && document.getElementById('detail-back')");
    await evaluate("document.getElementById('detail-back').click()");
    await until("location.pathname==='/inventory' && document.body.textContent.includes('Page 2 of 4') && window.scrollY>=690");
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Search records\"]').value"), 'Product');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Next page\"]').disabled"), false);
    await evaluate("history.forward()"); await until("location.pathname.startsWith('/items/')");
    await evaluate("history.back()"); await until("location.pathname==='/inventory' && document.querySelector('[aria-label=\"Next page\"]').disabled===false");
    await evaluate("document.getElementById('commercial-link').click()");
    await until("location.pathname==='/commercial' && document.querySelector('[aria-label=\"Next page\"]').disabled");
    await evaluate("document.getElementById('warehouse-link').click()");
    await until("location.pathname==='/inventory' && location.search==='?section=items' && document.body.textContent.includes('Page 2 of 4')");
    await evaluate("location.reload()");
    await until("document.querySelector('[aria-label=\"Search records\"]')?.value==='Product' && document.body.textContent.includes('Page 2 of 4')");
    await until("Boolean(history.state?.soeicamNavigation)");
    const marker = await evaluate('history.state.soeicamNavigation.id');
    await evaluate("document.getElementById('warehouse-link').click()");
    assert.equal(await evaluate('history.state.soeicamNavigation.id'), marker);
    assert.deepEqual(errors, []);
  } finally {
    socket?.close(); browser?.kill();
    await new Promise(resolve => server.close(resolve));
    // This is only the fresh, task-owned temporary browser profile.
    assert.equal(path.dirname(profile), tmpdir());
    try { await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); } catch { /* Windows may briefly retain browser file locks. */ }
  }
});
