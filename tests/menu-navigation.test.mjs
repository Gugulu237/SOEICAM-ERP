import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createNavigationSession,menuReturnTarget,navigationScreenKey,navigationLabel,nativeTraversalAllowed} from '../src/lib/navigation-session.js';
const require=createRequire(import.meta.url);

test('Back returns to the immediately preceding section instead of jumping past it to an old menu',()=>{
  let id=0;const session=createNavigationSession({key:'menus',makeId:()=>String(++id)});
  session.commit('/sales');const all=session.commit('/sales?tab=all');const invoices=session.commit('/sales?tab=invoices');
  assert.deepEqual(menuReturnTarget(session.getSnapshot(),'/sales'),{delta:-1});
  session.commit('/sales?tab=all',{kind:'traverse',entryId:all.id});
  assert.equal(session.getSnapshot().canForward,true);assert.equal(session.getSnapshot().entries.length,3);
  session.commit('/sales?tab=all',{kind:'traverse',entryId:all.id});
  assert.deepEqual(menuReturnTarget(session.getSnapshot(),'/sales'),{delta:-1});
  session.commit('/sales?tab=invoices',{kind:'traverse',entryId:invoices.id});
  assert.equal(session.getSnapshot().canForward,false);session.flush();
});

test('direct links replace with their explicit parent, while cross-module Back keeps the actual prior screen',()=>{
  const direct=createNavigationSession({key:'direct'});direct.commit('/cashier?section=expenses');
  assert.deepEqual(menuReturnTarget(direct.getSnapshot(),'/cashier'),{href:'/cashier',replace:true});
  const count=direct.getSnapshot().entries.length;direct.commit('/cashier',{kind:'replace'});
  assert.equal(direct.getSnapshot().entries.length,count);direct.flush();
  const session=createNavigationSession({key:'cross-module'});
  session.commit('/cashier');const previous=session.commit('/sales?tab=invoices');session.commit('/cashier?section=expenses');
  assert.deepEqual(menuReturnTarget(session.getSnapshot(),'/cashier'),{delta:-1});
  session.commit('/sales?tab=invoices',{kind:'traverse',entryId:previous.id});
  assert.equal(session.getSnapshot().canForward,true);session.flush();
  assert.deepEqual(menuReturnTarget(null,'/purchases'),{href:'/purchases',replace:true});
  assert.deepEqual(menuReturnTarget(null,'https://foreign.example'),{href:'/',replace:true});
});

test('changing a menu section resets the screen while filters retain their scrolling context',()=>{
  assert.notEqual(navigationScreenKey('/sales'),navigationScreenKey('/sales?tab=all'));
  assert.notEqual(navigationScreenKey('/cashier?section=expenses'),navigationScreenKey('/cashier?section=payments'));
  assert.equal(navigationScreenKey('/sales?tab=all&search=one'),navigationScreenKey('/sales?search=two&tab=all'));
  assert.equal(navigationLabel('/cashier?section=expenses'),'Cashier / Petty cash');
  assert.equal(navigationLabel('/sales?tab=all'),'Sales / All sales');
  assert.notEqual(navigationScreenKey('/customers?view=list'),navigationScreenKey('/customers?view=list&customer=shop'));
  assert.notEqual(navigationScreenKey('/purchases?section=suppliers'),navigationScreenKey('/purchases?section=suppliers&supplier=vendor'));
  assert.equal(navigationLabel('/customers?view=zones'),'Customers / Delivery zones');
});

test('customer and supplier profile returns traverse their list entries so Forward can reopen the profile',()=>{
  for(const [home,list,profile] of [['/customers','/customers?view=list','/customers?view=list&customer=shop'],['/purchases','/purchases?section=suppliers','/purchases?section=suppliers&supplier=vendor']]){
    const session=createNavigationSession({key:'profiles'});session.commit(home);const entry=session.commit(list);session.commit(profile);
    assert.deepEqual(menuReturnTarget(session.getSnapshot(),list),{delta:-1});session.commit(list,{kind:'traverse',entryId:entry.id});assert.equal(session.getSnapshot().canForward,true);session.flush();
  }
});

test('native traversal requires the current tab and account marker, including panel Back on a first page',()=>{
  const session=createNavigationSession({key:'this-account'});
  const first=session.commit('/customers?view=list');
  const detail=session.commit('/customers?view=list&customer=shop&tab=sales');
  assert.equal(nativeTraversalAllowed(session,'/customers?view=list&customer=shop&tab=sales',detail),true);
  assert.equal(nativeTraversalAllowed(session,'/customers?view=list&customer=shop&tab=sales',{...detail,owner:'other-account'}),false);
  assert.equal(nativeTraversalAllowed(session,'/customers?view=list&customer=shop&tab=sales',first),false);
  assert.equal(nativeTraversalAllowed(session,'/customers?view=list',detail),false);
  assert.equal(nativeTraversalAllowed(session,'/customers?view=list&customer=shop&tab=sales',undefined),false);
  session.commit('/customers?view=list',{kind:'traverse',entryId:first.id});
  assert.equal(nativeTraversalAllowed(session,'/customers?view=list',first),false);
  assert.equal(nativeTraversalAllowed(session,'/customers?view=list',first,1),true);
  session.setOverlayDepth(1);
  assert.equal(nativeTraversalAllowed(session,'/customers?view=list',first),true);
  assert.equal(nativeTraversalAllowed(session,'/customers?view=list',first,1),false);
  session.flush();
});

test('shared Back hooks traverse one verified entry and replace direct or foreign-history entries with a safe parent',async()=>{
  const result=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {useMenuBack} from './src/hooks/useMenuBack.js';function Harness(){globalThis.__menuBack.action=useMenuBack('/cashier',{currentWorkspace:globalThis.__menuBack.currentWorkspace});return null;}export const render=()=>renderToStaticMarkup(React.createElement(Harness));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'menu-fixture',setup(b){
    const mocks={
      '@/lib/navigation-context':"export const useNavigationSession=()=>globalThis.__menuBack.session;export const useNavigationHistory=()=>globalThis.__menuBack.session.getSnapshot();",
      './navigation-context':"export const useNavigationSession=()=>globalThis.__menuBack.session;export const useNavigationHistory=()=>globalThis.__menuBack.session.getSnapshot();",
      'next/navigation':"export const useRouter=()=>({back:()=>globalThis.__menuBack.calls.push(-1),forward:()=>globalThis.__menuBack.calls.push(1),push:(...args)=>globalThis.__menuBack.calls.push(['push',...args]),replace:(...args)=>globalThis.__menuBack.calls.push(['replace',...args])});export const usePathname=()=>globalThis.window.location.pathname;export const useSearchParams=()=>new URLSearchParams(globalThis.window.location.search);export const useParams=()=>({});",
      'next/link':"export default ()=>null;"
    };
    b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
  const previous=globalThis.window,previousEvent=globalThis.CustomEvent,state={calls:[],currentWorkspace:false};
  const at=(routes,foreign=false)=>{
    state.session=createNavigationSession({key:'hooks'});let marker;
    for(const href of routes)marker=state.session.commit(href);
    const url=new URL(routes.at(-1),'https://erp.local');state.calls=[];
    globalThis.window={location:{pathname:url.pathname,search:url.search,hash:''},history:{state:{soeicamNavigation:foreign?{...marker,owner:'another-tab'}:marker}},dispatchEvent(){}};
  };
  globalThis.__menuBack=state;globalThis.CustomEvent=class CustomEvent{};
  try{
    at(['/cashier','/cashier?section=expenses','/cashier?section=payments']);
    module.exports.render();state.action();assert.deepEqual(state.calls,[-1]);state.session.flush();
    at(['/cashier?section=expenses']);
    module.exports.render();state.action();assert.deepEqual(state.calls,[['replace','/cashier',{scroll:true}]]);state.session.flush();
    at(['/cashier','/sales?tab=invoices','/cashier?section=expenses']);
    module.exports.render();state.action();assert.deepEqual(state.calls,[-1]);state.session.flush();
    at(['/cashier','/cashier?section=expenses'],true);
    module.exports.render();state.action();assert.deepEqual(state.calls,[['replace','/cashier',{scroll:true}]]);state.session.flush();
    state.currentWorkspace=true;at(['/?section=expenses']);
    module.exports.render();state.action();assert.deepEqual(state.calls,[['replace','/',{scroll:true}]]);state.session.flush();
  }finally{globalThis.window=previous;globalThis.CustomEvent=previousEvent;delete globalThis.__menuBack;}
});
