import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {isClerkWidgetRoute} from '../src/lib/clerk-ui-config.js';
const require=createRequire(import.meta.url);

test('shared providers keep optional Clerk themes and languages outside the initial dependency graph',async()=>{
  const imports=[];
  const output=await build({entryPoints:['src/app/providers.jsx'],bundle:true,packages:'external',platform:'browser',format:'esm',write:false,metafile:true,logLevel:'silent',plugins:[{name:'initial-graph',setup(b){b.onResolve({filter:/.*/},a=>{if(a.path.startsWith('@clerk/'))imports.push({path:a.path,kind:a.kind});if(a.kind==='dynamic-import')return {path:a.path,external:true};});}}]});
  assert.ok(imports.some(row=>row.path==='@clerk/nextjs'&&row.kind==='import-statement'),'auth SDK remains synchronous');
  for(const path of ['@clerk/ui/themes','@clerk/localizations/fr-FR','@clerk/localizations/en-US'])assert.ok(imports.some(row=>row.path===path&&row.kind==='dynamic-import'));
  assert.equal(imports.some(row=>/ui\/themes|localizations/.test(row.path)&&row.kind!=='dynamic-import'),false);
  assert.equal(Object.keys(output.metafile.inputs).some(path=>/ClerkAuthScreen|ClerkAccountControl/.test(path)),false);
  for(const path of ['/login','/register','/profile','/login/verify','/profile/'])assert.equal(isClerkWidgetRoute(path),true,path);
  for(const path of ['/','/customers','/inventory','/employees/1','/login-history','/profile-report',null])assert.equal(isClerkWidgetRoute(path),false,path);
});

test('optional UI loader evaluates only the requested locale and reuses downloaded theme and language modules',async()=>{
  const output=await build({entryPoints:['src/lib/clerk-ui-config.js'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'options-modules',setup(b){
    b.onResolve({filter:/^@clerk\//},a=>({path:a.path,namespace:'optional'}));
    b.onLoad({filter:/.*/,namespace:'optional'},a=>({contents:`globalThis.__clerkImports.push(${JSON.stringify(a.path)});export const shadcn={name:'theme'},frFR={locale:'fr-FR'},enUS={locale:'en-US'};`}));
  }}]});
  globalThis.__clerkImports=[];
  try{
    const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
    assert.deepEqual(globalThis.__clerkImports,[]);
    const [first,overlap]=await Promise.all([module.exports.loadClerkUiOptions('fr'),module.exports.loadClerkUiOptions('fr')]);
    assert.equal(first.localization.locale,'fr-FR');assert.equal(first.appearance,overlap.appearance);
    assert.deepEqual(globalThis.__clerkImports.sort(),['@clerk/localizations/fr-FR','@clerk/ui/themes']);
    const english=await module.exports.loadClerkUiOptions('en');assert.equal(english.localization.locale,'en-US');assert.equal(english.appearance,first.appearance);
    assert.equal(globalThis.__clerkImports.length,3);assert.equal((await module.exports.loadClerkUiOptions('fr')).localization,first.localization);
  }finally{delete globalThis.__clerkImports;}
});

async function renderer(){
 const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Providers from './src/app/providers.jsx';import Auth from './src/components/ClerkAuthScreen.jsx';import Account from './src/components/ClerkAccountControl.jsx';import {useClerkUiStatus} from './src/lib/clerk-ui-options.js';function Probe(){globalThis.__clerkUi.status=useClerkUiStatus();return React.createElement('span',null,'Persistent page content');}export const render=()=>renderToStaticMarkup(React.createElement(Providers,null,React.createElement(Probe),globalThis.__clerkUi.path==='/profile'?React.createElement(Account):globalThis.__clerkUi.path.startsWith('/login')||globalThis.__clerkUi.path==='/register'?React.createElement(Auth,{signUp:globalThis.__clerkUi.path==='/register'}):null));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,plugins:[{name:'provider-fixture',setup(b){
   b.onResolve({filter:/^react$/},a=>a.importer.endsWith('clerk-ui-options.js')?{path:'hooks',namespace:'fixture'}:undefined);
   b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export const createContext=React.createContext,useContext=React.useContext,useState=v=>globalThis.__clerkUi.state('options',v),useEffect=(fn,deps)=>globalThis.__clerkUi.effect('options',fn,deps);`,resolveDir:process.cwd()}));
   const mocks={
    'next/navigation':"export const usePathname=()=>globalThis.__clerkUi.path;",
    '@tanstack/react-query':"export const QueryClientProvider=({children})=>children;",
    '@/lib/query-client':"export const queryClientInstance={};",
    '@/lib/AuthContext':"import React from 'react';export const AuthProvider=({children})=>React.createElement('section',{'data-auth-provider':'present'},children);",
    '@/components/ui/toaster':"export const Toaster=()=>null;",
    '@/components/SetupScreen':"export default ()=>null;",
    '@/lib/localization':"export const LanguageProvider=({children})=>children,useLocaleRender=()=>globalThis.__clerkUi.language;",
    '@/lib/i18n':"export const ui=text=>text;",
    '@/lib/auth-provider':"export const isAuthConfigured=()=>true,usesClerk=()=>globalThis.__clerkUi.clerk;",
    '@/components/pwa/PwaProvider':"export default ({children})=>children;",
    '@/components/pwa/DeviceNotificationBridge':"export default ()=>null;",
    '@/lib/clerk-ui-config':"export {isClerkWidgetRoute} from './src/lib/clerk-ui-config.js';export const loadClerkUiOptions=language=>globalThis.__clerkUi.load(language);",
    '@clerk/nextjs':"import React from 'react';export const ClerkProvider=props=>{globalThis.__clerkUi.provider=props;return props.children;};export const SignIn=()=>React.createElement('form',{'data-widget':'sign-in'}),SignUp=()=>React.createElement('form',{'data-widget':'sign-up'}),UserButton=props=>{globalThis.__clerkUi.userButton=props;return React.createElement('button',{'data-widget':'account'},'Account actions');};",
   };
   b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
   b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});
 const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);return module.exports.render;
}

async function setup(path='/inventory'){
 const r=hookRuntime();r.path=path;r.language='fr';r.clerk=true;r.requests=[];
 r.load=language=>new Promise((resolve,reject)=>r.requests.push({language,resolve,reject}));
 globalThis.__clerkUi=r;const render=await renderer();
 return {r,draw:()=>{r.beforeRender();return render();},close:()=>{r.cleanup();delete globalThis.__clerkUi;}};
}
const options=language=>({appearance:{theme:'theme'},localization:{locale:language}});

test('operational routes load no optional options; auth waits only at widget slot and preserves provider children during language changes',async()=>{
 const {r,draw,close}=await setup();
 try{
  assert.match(draw(),/Persistent page content/);await r.flush();assert.equal(r.requests.length,0);
  r.path='/login';let html=draw();assert.match(html,/Welcome back/);assert.match(html,/role="status"/);assert.match(html,/Persistent page content/);assert.match(html,/data-auth-provider/);assert.doesNotMatch(html,/data-widget/);
  const providerChildType=r.provider.children.type,authType=r.provider.children.props.children.props.children.props.children.type;
  await r.flush();assert.equal(r.requests.length,1);assert.equal(r.requests[0].language,'fr');r.requests[0].resolve(options('fr'));await r.flush();assert.match(draw(),/data-widget="sign-in"/);assert.equal(r.provider.localization.locale,'fr');
  r.language='en';assert.match(draw(),/data-widget="sign-in"/);await r.flush();assert.equal(r.requests[1].language,'en');r.requests[1].resolve(options('en'));await r.flush();html=draw();assert.match(html,/data-widget="sign-in"/);assert.equal(r.provider.localization.locale,'en');
  assert.equal(r.provider.children.type,providerChildType);assert.equal(r.provider.children.props.children.props.children.props.children.type,authType);
  r.path='/sales';draw();await r.flush();r.language='fr';draw();await r.flush();assert.equal(r.requests.length,2);
 }finally{close();}
});

test('failed optional options leave sign-up usable with retry and ignore stale route/language completions',async()=>{
 const {r,draw,close}=await setup('/register');
 try{
  draw();await r.flush();r.requests[0].reject(Error('Network'));await r.flush();let html=draw();assert.match(html,/data-widget="sign-up"/);assert.match(html,/You can still use your account/);assert.equal(r.provider.localization,undefined);
  r.status.retry();draw();await r.flush();assert.equal(r.requests.length,2);assert.match(draw(),/data-widget="sign-up"/);
  r.language='en';draw();await r.flush();assert.equal(r.requests.length,3);r.requests[2].resolve(options('en'));await r.flush();draw();r.requests[1].resolve(options('fr'));await r.flush();draw();assert.equal(r.provider.localization.locale,'en');
  r.language='fr';draw();await r.flush();assert.equal(r.requests.length,4);r.path='/inventory';draw();await r.flush();r.requests[3].resolve(options('fr'));await r.flush();draw();assert.equal(r.provider.localization.locale,'en','a completed request cannot apply after leaving the widget route');assert.equal(r.status.ready,true);assert.equal(r.status.error,false);
 }finally{close();}
});

test('profile retains named Clerk account/security menu and custom page content while its optional display assets load',async()=>{
 const {r,draw,close}=await setup('/profile');
 try{
  let html=draw();assert.match(html,/Persistent page content/);assert.match(html,/>Account<\/h2>/);assert.match(html,/role="status"/);assert.doesNotMatch(html,/data-widget="account"/);
  await r.flush();assert.equal(r.requests.length,1);r.requests[0].resolve(options('fr'));await r.flush();html=draw();assert.match(html,/data-widget="account"/);assert.equal(r.userButton.showName,true);
 }finally{close();}
});

test('Supabase auth routes do not request Clerk display assets',async()=>{
 const {r,draw,close}=await setup('/login');r.clerk=false;
 try{draw();await r.flush();assert.equal(r.requests.length,0);assert.equal(r.provider,undefined);}finally{close();}
});
