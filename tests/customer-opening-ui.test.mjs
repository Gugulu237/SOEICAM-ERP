import {loadedMobileTasks} from './helpers/mobile-task-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const bundle=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Action,{OpeningDialog} from './src/components/customers/CustomerOpeningBalance.jsx';export const render=(props,action=false)=>renderToStaticMarkup(React.createElement(action?Action:OpeningDialog,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[loadedMobileTasks(),{name:'opening-ui',setup(b){
 b.onResolve({filter:/^react$/},a=>a.importer.endsWith('CustomerOpeningBalance.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({resolveDir:process.cwd(),contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__openingUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__openingUI.state('opening',v),useRef=v=>globalThis.__openingUI.ref('opening',v),useEffect=(fn,deps)=>globalThis.__openingUI.effect('opening',fn,deps);`}));
 const mocks={
  '@/lib/localization':'export const useLocaleRender=()=>{};',
  '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__openingUI.session;',
  '@/api/erpClient':'export const invalidateERPReads=()=>globalThis.__openingUI.invalidated++;',
  '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__openingUI.capture('input',props,[]);return React.createElement('input',props);};",
  '@/components/ui/button':"import React from 'react';export const Button=({children,...props})=>{globalThis.__openingUI.capture('button',props,children);return React.createElement('button',props,children);};",
  '@/components/ui/dialog':"import React from 'react';export const Dialog=({children,onOpenChange})=>{globalThis.__openingUI.dismiss=onOpenChange;return React.createElement('div',null,children);};export const DialogContent=({children})=>React.createElement('div',null,children),DialogHeader=DialogContent,DialogTitle=DialogContent,DialogDescription=DialogContent;",
 };
 b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);b.onLoad({filter:/.*/,namespace:'leaf'},a=>({resolveDir:process.cwd(),contents:mocks[a.path]}));
}}]});const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
const setup={can_enter:true,recorded:false,date:'2026-01-01',max_date:'2026-11-03',mode:'post',account_id:'ar',offsets:[{id:'equity',name:'Opening equity',number:'100'}],entries:[]};
function fixture(data=setup){
 const r=hookRuntime(),priorFetch=globalThis.fetch,calls=[];let done=0,closed=0;
 r.session={role:'admin',allowedModules:['customers','accounting']};r.invalidated=0;r.data=data;globalThis.__openingUI=r;
 globalThis.fetch=async(url,options)=>{calls.push({url,...options});if(options.method==='GET')return {ok:true,json:async()=>r.data};return r.post?await r.post(options):{ok:true,json:async()=>({amount:25000,date:'2026-01-01'})};};
 const props={customer:{id:'customer-a',business_name:'Customer A'},onClose:()=>closed++,onSaved:()=>done++};
 return {r,calls,draw(action=false){r.beforeRender();return module.exports.render(props,action);},get done(){return done;},get closed(){return closed;},close(){r.cleanup();globalThis.fetch=priorFetch;delete globalThis.__openingUI;}};
}
test('customer opening action is restricted to administrators with Accounting access',()=>{
 const f=fixture();try{assert.match(f.draw(true),/Customer opening balance/);f.r.session.role='commercial';assert.equal(f.draw(true),'');f.r.session={role:'admin',allowedModules:['customers']};assert.equal(f.draw(true),'');assert.equal(f.calls.length,0);}finally{f.close();}
});
test('review and acknowledgement are required; failures keep values and retry key, double-clicks and busy dismissal are blocked',async()=>{
 const f=fixture();try{
  f.draw();await f.r.flush();f.draw();
  const enter=(label,value)=>f.r.controls.find(c=>c['aria-label']===label).onChange({target:{value}});
  enter('Amount customer owes (XAF)','25000');enter('Previous system reference','OLD-AR');enter('Opening counterpart account','equity');enter('Payment due date','2025-12-15');f.draw();
  f.r.buttons.find(b=>b.label==='Review before posting').onClick();assert.match(f.draw(),/Payment due date<!-- -->: <!-- -->2025-12-15|Payment due date: 2025-12-15/);
  assert.equal(f.r.buttons.find(b=>b.label==='Record opening balance').disabled,true);await f.r.buttons.find(b=>b.label==='Record opening balance').onClick();assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
  f.r.controls.find(c=>c.type==='checkbox').onChange({target:{checked:true}});f.draw();f.r.post=async()=>{throw Error('Connection interrupted');};await f.r.buttons.find(b=>b.label==='Record opening balance').onClick();assert.match(f.draw(),/Connection interrupted/);
  assert.equal(f.r.controls.find(c=>c['aria-label']==='Amount customer owes (XAF)').value,'25000');
  let release;f.r.post=()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({amount:25000,date:'2026-01-01'})});});
  const button=f.r.buttons.find(b=>b.label==='Record opening balance'),pending=button.onClick();button.onClick();f.draw();f.r.dismiss(false);assert.equal(f.closed,0);release();await pending;
  assert.match(f.draw(),/Opening balance recorded/);assert.equal(f.done,1);assert.equal(f.r.invalidated,1);
  const writes=f.calls.filter(c=>c.method==='POST');assert.equal(writes.length,2);const first=JSON.parse(writes[0].body),second=JSON.parse(writes[1].body);assert.equal(first.requestKey,second.requestKey);assert.equal(second.confirmed,true);assert.equal(second.account_id,'ar');assert.equal(second.offset_account_id,'equity');assert.equal(second.due_date,'2025-12-15');
 }finally{f.close();}
});
test('an existing opening balance is read-only, and linking a GL opening cannot exceed its remainder',async()=>{
 let f=fixture({...setup,recorded:true,can_enter:false,amount:25000});try{f.draw();await f.r.flush();assert.match(f.draw(),/Opening balance already recorded/);assert.equal(f.r.controls.length,0);assert.equal(f.r.buttons.some(b=>b.label==='Record opening balance'),false);}finally{f.close();}
 f=fixture({...setup,mode:'attach',available:10000,date_locked:true});try{f.draw();await f.r.flush();assert.match(f.draw(),/without posting it again/);assert.equal(f.r.controls.some(c=>c.tag==='select'),false);assert.equal(f.r.controls.find(c=>c['aria-label']==='Opening date').disabled,true);f.r.controls.find(c=>c['aria-label']==='Amount customer owes (XAF)').onChange({target:{value:'10001'}});f.r.controls.find(c=>c['aria-label']==='Previous system reference').onChange({target:{value:'OLD'}});f.draw();assert.equal(f.r.buttons.find(b=>b.label==='Review before posting').disabled,true);}finally{f.close();}
});
