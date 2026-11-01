import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createNavigationSession,menuReturnTarget,navigationScreenKey,navigationLabel} from '../src/lib/navigation-session.js';
const require=createRequire(import.meta.url);

test('returning from nested menu sections preserves Back and Forward without adding a duplicate menu',()=>{
  let id=0;const session=createNavigationSession({key:'menus',makeId:()=>String(++id)});
  const home=session.commit('/sales');const all=session.commit('/sales?tab=all');const invoices=session.commit('/sales?tab=invoices');
  assert.deepEqual(menuReturnTarget(session.getSnapshot(),'/sales'),{delta:-2});
  session.commit('/sales',{kind:'traverse',entryId:home.id});
  assert.equal(session.getSnapshot().canForward,true);assert.equal(session.getSnapshot().entries.length,3);
  session.commit('/sales?tab=all',{kind:'traverse',entryId:all.id});
  assert.deepEqual(menuReturnTarget(session.getSnapshot(),'/sales'),{delta:-1});
  session.commit('/sales?tab=invoices',{kind:'traverse',entryId:invoices.id});
  assert.equal(session.getSnapshot().canForward,false);session.flush();
});

test('menu returns from direct links replace the current screen and never jump through another workspace',()=>{
  for(const paths of [['/cashier?section=expenses'],['/cashier','/sales','/cashier?section=expenses']]){
    const session=createNavigationSession({key:'direct'});
    for(const href of paths)session.commit(href);
    assert.deepEqual(menuReturnTarget(session.getSnapshot(),'/cashier'),{href:'/cashier',replace:true});
    const count=session.getSnapshot().entries.length;session.commit('/cashier',{kind:'replace'});
    assert.equal(session.getSnapshot().entries.length,count);session.flush();
  }
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

test('the menu-return hook traverses native history and replaces direct-link screens',async()=>{
  const result=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {useMenuBack} from './src/hooks/useMenuBack.js';function Harness(){globalThis.__menuBack.action=useMenuBack('/cashier',{currentWorkspace:globalThis.__menuBack.currentWorkspace});return null;}export const render=()=>renderToStaticMarkup(React.createElement(Harness));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'menu-fixture',setup(b){
    const mocks={
      '@/lib/navigation-context':"export const useNavigationSession=()=>({getSnapshot:()=>globalThis.__menuBack.snapshot});",
      '@/lib/router':"export const useNavigate=()=>(...args)=>globalThis.__menuBack.calls.push(args);"
    };
    b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
  const previous=globalThis.window,state={calls:[],snapshot:{entries:[{href:'/cashier'},{href:'/cashier?section=expenses'},{href:'/cashier?section=payments'}],cursor:2}};
  globalThis.__menuBack=state;globalThis.window={history:{go:delta=>state.calls.push(delta)}};
  try{
    module.exports.render();state.action();assert.deepEqual(state.calls,[-2]);
    state.snapshot={entries:[{href:'/cashier?section=expenses'}],cursor:0};state.calls=[];
    module.exports.render();state.action();assert.deepEqual(state.calls,[['/cashier',{replace:true}]]);
    state.currentWorkspace=true;globalThis.window.location={pathname:'/'};state.snapshot={entries:[{href:'/'},{href:'/?section=expenses'}],cursor:1};state.calls=[];
    module.exports.render();state.action();assert.deepEqual(state.calls,[-1]);
  }finally{globalThis.window=previous;delete globalThis.__menuBack;}
});
