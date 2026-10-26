import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require = createRequire(import.meta.url);

async function renderer() {
  const output = await build({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {AuthProvider,useAuth} from './src/lib/AuthContext.jsx';function Probe(){globalThis.__authUI.value=useAuth();return null}export const render=()=>renderToStaticMarkup(React.createElement(AuthProvider,null,React.createElement(Probe)));`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'auth-fixture', setup(b) {
      b.onResolve({ filter: /^react$/ }, args => args.importer.endsWith('AuthContext.jsx') ? { path: 'hooks', namespace: 'auth-fixture' } : undefined);
      const mocks = {
        '@/api/erpClient': `export const erp={auth:{me:()=>globalThis.__authUI.me(),logout(){},redirectToLogin(){}}};export const invalidateERPReads=()=>globalThis.__authUI.invalidations++;`,
        '@/lib/supabase/browser': `export const supabaseBrowser=()=>globalThis.__authUI.supabase();`,
        '@clerk/nextjs': `export const useAuth=()=>globalThis.__authUI.sdk;export const useClerk=()=>({signOut:async()=>{}});`,
        '@/lib/auth-provider': `export const usesClerk=()=>globalThis.__authUI.provider!=='supabase';`,
        '@/lib/item-lookup-cache': `export const setItemLookupIdentity=()=>{};`,
        '@/lib/localization': `export const activateAccountLanguage=()=>{};`,
        '@/lib/i18n': `export const configureLanguage=()=>{};export const getLanguage=()=> 'en';export const setLanguage=()=>{};export const setLocalLanguage=()=>{};export const defaultLanguage=()=> 'en';export const languageIdentity=()=> 'test-user';`,
      };
      b.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'auth-mock' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'auth-mock' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd() }));
      b.onLoad({ filter: /.*/, namespace: 'auth-fixture' }, () => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};export default React;export const createContext=React.createContext,useContext=React.useContext;export const useState=v=>globalThis.__authUI.state('auth',v);export const useRef=v=>globalThis.__authUI.ref('auth',v);export const useEffect=(f,d)=>globalThis.__authUI.effect('auth',f,d);export const useCallback=(fn,deps)=>{const r=globalThis.__authUI.ref('auth',{fn,deps});if(deps.some((d,i)=>!Object.is(d,r.current.deps[i])))r.current={fn,deps};return r.current.fn;};`, resolveDir: process.cwd() }));
    } }] });
  const module = { exports: {} }; new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports); return module.exports.render;
}

test('server-verified profile opens the ERP when the client sign-in widget never loads; concurrent checks share one request', async () => {
  const render = await renderer(), runtime = hookRuntime(), previous = { window: globalThis.window, document: globalThis.document };
  let resolve, calls = 0;
  runtime.sdk = { isLoaded: false }; runtime.invalidations = 0;
  runtime.me = () => { calls++; return new Promise(done => { resolve = done; }); };
  globalThis.__authUI = runtime; globalThis.window = { setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {} }; globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const draw = () => { runtime.beforeRender(); render(); return runtime.value; };
  const profile = { id: 'test-user', full_name: 'Sample staff', staff_access: true, employee_profile: { id: 'staff', role: 'commercial', status: 'active' } };
  try {
    draw(); await runtime.flush(); assert.equal(calls, 1); assert.equal(draw().isLoadingAuth, true);
    const concurrent = runtime.value.checkUserAuth({ background: true }); assert.equal(calls, 1);
    resolve(profile); await concurrent; await runtime.flush(); let value = draw();
    assert.equal(value.isLoadingAuth, false); assert.equal(value.isAuthenticated, true); assert.equal(value.employee.id, 'staff');
    const user = value.user, invalidations = runtime.invalidations;
    runtime.me = async () => structuredClone(profile); await value.checkUserAuth({ background: true }); value = draw();
    assert.equal(value.user, user); assert.equal(runtime.invalidations, invalidations, 'an unchanged background profile does not invalidate every page data load');
    runtime.me = async () => { throw Object.assign(Error('Offline'), { status: 503 }); };
    await value.checkUserAuth({ background: true }); value = draw();
    assert.equal(value.isAuthenticated, true); assert.equal(value.authError, null); assert.equal(value.profileRefreshError, 'Offline');
    runtime.me = async () => { throw Object.assign(Error('Session expired'), { status: 401 }); };
    await value.checkUserAuth({ background: true }); value = draw();
    assert.equal(value.isAuthenticated, false); assert.equal(value.employee, null);
  } finally { runtime.cleanup(); delete globalThis.__authUI; globalThis.window = previous.window; globalThis.document = previous.document; }
});


test('deferred Supabase subscription preserves server authority and unsubscribes on unmount',async()=>{
  const render=await renderer(),runtime=hookRuntime(),previous={window:globalThis.window,document:globalThis.document};let resolveSdk,eventHandler,unsubscribed=0;
  runtime.provider='supabase';runtime.invalidations=0;runtime.supabase=()=>new Promise(resolve=>{resolveSdk=resolve;});
  const profile={id:'test-user',staff_access:true,employee_profile:{id:'staff',role:'commercial',status:'active'}};
  runtime.me=async()=>profile;globalThis.__authUI=runtime;
  globalThis.window={setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}};
  globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
  const draw=()=>{runtime.beforeRender();render();return runtime.value;};
  try{draw();await runtime.flush();assert.equal(draw().isAuthenticated,true);resolveSdk({auth:{onAuthStateChange:callback=>{eventHandler=callback;return {data:{subscription:{unsubscribe(){unsubscribed++;}}}};}}});await runtime.flush();assert.equal(typeof eventHandler,'function');
    runtime.me=async()=>{throw Object.assign(Error('Expired'),{status:401});};eventHandler('SIGNED_OUT');await new Promise(resolve=>setTimeout(resolve,5));await runtime.flush();assert.equal(draw().isAuthenticated,false);
  }finally{runtime.cleanup();delete globalThis.__authUI;globalThis.window=previous.window;globalThis.document=previous.document;}
  assert.equal(unsubscribed,1);
});

test('unmounting before the Supabase SDK arrives never registers a late subscription',async()=>{
  const render=await renderer(),runtime=hookRuntime(),previous={window:globalThis.window,document:globalThis.document};let resolveSdk,registered=0,cleaned=false;
  runtime.provider='supabase';runtime.invalidations=0;runtime.supabase=()=>new Promise(resolve=>{resolveSdk=resolve;});runtime.me=async()=>({id:'test-user',staff_access:true});
  globalThis.__authUI=runtime;globalThis.window={setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}};globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
  try{runtime.beforeRender();render();await runtime.flush();runtime.cleanup();cleaned=true;resolveSdk({auth:{onAuthStateChange(){registered++;}}});await Promise.resolve();assert.equal(registered,0);}finally{if(!cleaned)runtime.cleanup();delete globalThis.__authUI;globalThis.window=previous.window;globalThis.document=previous.document;}
});

test('a role save supersedes an older in-flight profile and storage events refresh permissions across tabs',async()=>{
 const render=await renderer(),runtime=hookRuntime(),previous={window:globalThis.window,document:globalThis.document};
 runtime.sdk={isLoaded:false};runtime.invalidations=0;const requests=[];
 runtime.me=()=>new Promise(resolve=>requests.push(resolve));
 const win=new EventTarget();win.setInterval=()=>1;win.clearInterval=()=>{};globalThis.window=win;globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 globalThis.__authUI=runtime;const draw=()=>{runtime.beforeRender();render();return runtime.value;};
 const before={id:'test-user',staff_access:true,employee_profile:{id:'staff',role:'cashier',status:'active',allowed_modules:['cashier']}},after={...before,employee_profile:{...before.employee_profile,allowed_modules:['cashier','sales_reports']}};
 try{
  draw();await runtime.flush();assert.equal(requests.length,1);
  win.dispatchEvent(new Event('soeicam:roles-changed'));assert.equal(requests.length,2,'a save cannot reuse the request started before the save');
  requests[1](after);await runtime.flush();assert.deepEqual(draw().employee.allowed_modules,['cashier','sales_reports']);
  requests[0](before);await runtime.flush();assert.deepEqual(draw().employee.allowed_modules,['cashier','sales_reports'],'the older response cannot undo newly saved permissions');
  const event=new Event('storage');Object.defineProperty(event,'key',{value:'soeicam:role-permissions-changed'});win.dispatchEvent(event);assert.equal(requests.length,3);
  requests[2](before);await runtime.flush();assert.deepEqual(draw().employee.allowed_modules,['cashier'],'revocations also reach an open employee tab');
 }finally{runtime.cleanup();delete globalThis.__authUI;globalThis.window=previous.window;globalThis.document=previous.document;}
});
