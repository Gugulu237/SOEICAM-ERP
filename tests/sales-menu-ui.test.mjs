import {loadedMobileTasks} from './helpers/mobile-task-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Sales from './src/views/Sales.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Sales));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[loadedMobileTasks(),{name:'sales-menu',setup(b){
  b.onResolve({filter:/^react$/},a=>a.importer.endsWith('Sales.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({resolveDir:process.cwd(),contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__salesMenu.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__salesMenu.state('orders',v),useEffect=(fn,deps)=>globalThis.__salesMenu.effect('orders',fn,deps);"}));
  const mocks={
    '@/hooks/useCurrentUser':"export const useCurrentUser=()=>globalThis.__salesMenu.session;",
    '@/lib/router':"export const Link=()=>null;export const useLocation=()=>({pathname:'/sales',search:globalThis.__salesMenu.query?'?'+globalThis.__salesMenu.query:''});export const useNavigate=()=>path=>{globalThis.__salesMenu.navigation.push(path);globalThis.__salesMenu.query=path.split('?')[1]||'';},useSearchParams=()=>[new URLSearchParams(globalThis.__salesMenu.query||''),value=>{const current=new URLSearchParams(globalThis.__salesMenu.query||'');globalThis.__salesMenu.query=new URLSearchParams(typeof value==='function'?value(current):value).toString();}];",
    '@/api/erpClient':"export const erp={entities:{SalesOrder:'orders'}};",
    '@/lib/field-pos':"export const readAll=async()=>{globalThis.__salesMenu.reads++;return [];};",
    '@/components/sales/CompanySalesRegister':"import React from 'react';export default props=>{globalThis.__salesMenu.register=props;return React.createElement('p',null,'Company register');};",
    'next/dynamic':"import React from 'react';export default factory=>{const label=factory.toString().includes('InvoiceWorkspace')?'Invoice workspace':factory.toString().includes('FieldSalesPanel')?'Field workspace':'Outlet workspace';return ()=>React.createElement('p',null,label);};",
    '@/components/ui/button':"import React from 'react';export const Button=({children,...props})=>{globalThis.__salesMenu.capture('button',props,children);return React.createElement('button',props,children);};"
  };
  b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mocks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mocks'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});
const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
const render=module.exports.render;
function state(role='admin'){const r=hookRuntime();r.session={role,loading:false};r.reads=0;globalThis.__salesMenu=r;return r;}

test('Sales starts with action tiles and mounts only the chosen register',async()=>{
  const r=state(),draw=()=>{r.beforeRender();return render();};
  try{
    const html=draw();await r.flush();assert.doesNotMatch(html,/Company register|Invoice workspace/);assert.equal(r.reads,0);
    assert.deepEqual(r.buttons.map(b=>b['aria-label']),['New sale','All sales','Sales orders','Invoices','Field sales','Outlet reports']);
    r.buttons.find(b=>b['aria-label']==='All sales').onClick();assert.match(draw(),/Company register/);assert.equal(r.register.readOnly,false);
    r.buttons.find(b=>b["aria-label"]==='Sales menu').onClick();draw();assert.equal(r.query,'');
    r.buttons.find(b=>b['aria-label']==='Sales orders').onClick();draw();await r.flush();draw();assert.equal(r.reads,1);
    r.buttons.find(b=>b["aria-label"]==='Sales menu').onClick();draw();r.buttons.find(b=>b['aria-label']==='New sale').onClick();assert.equal(r.navigation.at(-1),'/sales/new');
    r.query='tab=invoices';assert.match(draw(),/Invoice workspace/);assert.doesNotMatch(draw(),/Company register/);
  }finally{r.cleanup();delete globalThis.__salesMenu;}
});

test('Sales menus preserve management reporting and employee permissions',()=>{
  for(const role of ['production_manager','warehouse_manager','employee']){
    const r=state(role),draw=()=>{r.beforeRender();return render();};
    try{
      draw();assert.ok(!r.buttons.some(b=>['Field sales','Outlet reports'].includes(b['aria-label'])));
      if(role!=='employee'){
        assert.deepEqual(r.buttons.map(b=>b['aria-label']),['Company sales']);
        r.query='tab=invoices';assert.doesNotMatch(draw(),/Invoice workspace/);
        r.query='tab=all';assert.match(draw(),/Company register/);assert.equal(r.register.readOnly,true);
        assert.ok(!r.buttons.some(b=>b.label==='New sale'));
      }else assert.ok(r.buttons.some(b=>b['aria-label']==='New sale'));
    }finally{r.cleanup();delete globalThis.__salesMenu;}
  }
});

test('Sales waits for the signed-in role before exposing any action',()=>{
  const r=state();r.session.loading=true;
  try{r.beforeRender();assert.match(render(),/Loading sales/);assert.equal(r.buttons.length,0);assert.equal(r.reads,0);}
  finally{r.cleanup();delete globalThis.__salesMenu;}
});

