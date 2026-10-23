import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
  if(compiled)return compiled;
  const mocks={
    '@/hooks/useCurrentUser':`export const useCurrentUser=()=>globalThis.__removalUI.session;`,
    '@/components/ui/button':`import React from 'react';export const Button=({children,...props})=>{globalThis.__removalUI.capture('button',props,children);return React.createElement('button',props,children);};`,
    '@/components/ui/input':`import React from 'react';export const Input=props=>{globalThis.__removalUI.input=props;return React.createElement('input',props);};`,
    '@/components/ui/dialog':`import React from 'react';export const Dialog=({open,children,onOpenChange})=>{globalThis.__removalUI.dialog={open,onOpenChange};return open?children:null;};export const DialogContent=({children})=>React.createElement('div',null,children),DialogHeader=DialogContent,DialogTitle=DialogContent,DialogDescription=DialogContent;`,
  };
  const result=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Removal from './src/components/employees/EmployeeRemovalAction.jsx';export const render=p=>renderToStaticMarkup(React.createElement(Removal,p));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'removal-controls',setup(b){
    b.onResolve({filter:/^react$/},a=>a.importer.endsWith('EmployeeRemovalAction.jsx')?{path:'hooks',namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__removalUI.state('removal',v),useRef=v=>globalThis.__removalUI.ref('removal',v);`,resolveDir:process.cwd()}));
    b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});const m={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);compiled=m.exports.render;return compiled;
}
const person={id:'worker',user_id:'worker-user',full_name:'Worker',employee_lifecycle_revision:3};
async function fixture(employee=person){
  const runtime=hookRuntime(),render=await renderer();runtime.session={role:'admin',user:{id:'manager-user'},employee:{id:'manager'}};globalThis.__removalUI=runtime;
  const saved=[];const draw=()=>{runtime.beforeRender();return render({employee,onSaved:value=>saved.push(value)});};
  const click=label=>{const button=runtime.buttons.find(row=>row.label===label);assert.ok(button,label);return button.onClick();};
  return {runtime,draw,click,saved};
}
test('removal requires confirmation and reason, keeps errors visible and reuses the request key on retry',async()=>{
  const f=await fixture(),original=globalThis.fetch,calls=[];let resolveRequest;
  globalThis.fetch=(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return new Promise(resolve=>{resolveRequest=resolve;});};
  try{
    f.draw();f.click('Remove employee');let html=f.draw();assert.match(html,/Payroll and transaction history will be retained/);assert.equal(calls.length,0);assert.equal(f.runtime.buttons.find(row=>row.label==='Confirm removal').disabled,true);
    f.runtime.input.onChange({target:{value:'Employment ended'}});f.draw();const pending=f.click('Confirm removal');f.click('Confirm removal');assert.equal(calls.length,1);assert.equal(calls[0].body.revision,3);assert.equal(calls[0].body.action,'remove');
    f.runtime.dialog.onOpenChange(false);f.draw();assert.equal(f.runtime.dialog.open,true);
    resolveRequest(Response.json({error:'Connection failed'},{status:503}));await pending;html=f.draw();assert.match(html,/Connection failed/);assert.equal(f.runtime.input.value,'Employment ended');
    const retry=f.click('Confirm removal');assert.equal(calls[1].body.requestKey,calls[0].body.requestKey);resolveRequest(Response.json({employee:{...person,status:'inactive',employee_removed_at:'now'}}));await retry;f.draw();assert.equal(f.runtime.dialog.open,false);assert.equal(f.saved.length,1);
  }finally{globalThis.fetch=original;delete globalThis.__removalUI;}
});
test('restore explains inactive status; staff and the manager’s own profile have no removal control',async()=>{
  const f=await fixture({...person,employee_removed_at:'now'});try{
    f.draw();f.click('Restore employee');assert.match(f.draw(),/directory as inactive/);assert.ok(f.runtime.buttons.some(b=>b.label==='Confirm restore'));
    f.runtime.session.role='cashier';assert.equal(f.draw(),'');f.runtime.session.role='admin';f.runtime.session.employee={id:'worker'};assert.equal(f.draw(),'');
  }finally{delete globalThis.__removalUI;}
});
