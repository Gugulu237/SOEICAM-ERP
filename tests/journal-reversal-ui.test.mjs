import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {businessDate} from '../src/lib/business-date.js';
const require=createRequire(import.meta.url);
async function compiled(){
 const out=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Dialog from './src/components/accounting/JournalReversalDialog.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Dialog,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'reversal-ui',setup(b){
  b.onResolve({filter:/^react$/},a=>/JournalReversalDialog\.jsx$/.test(a.importer)?{path:'hooks',namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'import React from '+JSON.stringify(require.resolve('react'))+';export default {...React,createElement:(tag,props,...children)=>{if(tag==="form")globalThis.__reversal.form=props;return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__reversal.state("dialog",v),useRef=v=>globalThis.__reversal.ref("dialog",v),useEffect=(fn,d)=>globalThis.__reversal.effect("dialog",fn,d);',resolveDir:process.cwd()}));
  const mocks={
   '@/api/erpClient':'export const erp=new Proxy({},{get:(_,k)=>globalThis.__reversal.client[k]});',
   '@/components/ui/button':'import React from "react";export const Button=({children,...p})=>{globalThis.__reversal.capture("button",p,children);return React.createElement("button",p,children);};',
   '@/components/ui/input':'import React from "react";export const Input=p=>{globalThis.__reversal.capture("input",p);return React.createElement("input",p);};',
   '@/components/ui/textarea':'import React from "react";export const Textarea=p=>{globalThis.__reversal.capture("input",p);return React.createElement("textarea",p);};',
   '@/components/ui/dialog':'import React from "react";export const Dialog=({children,open})=>open?React.createElement("div",null,children):null,DialogContent=({children})=>React.createElement("div",null,children),DialogHeader=DialogContent,DialogTitle=DialogContent,DialogDescription=DialogContent,DialogFooter=DialogContent;'
  };b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});const m={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,m,m.exports);return m.exports;
}
test('reversal dialog sends the selected date and reason, blocks known closed dates, preserves failures and prevents duplicate submissions',async()=>{
 const ui=await compiled(),r=hookRuntime(),requests=[];let fail=true,closed=0,saved;
 r.client={entities:{AccountingPeriod:{filter:async()=>({items:[{id:'closed',start_date:'2020-01-01',end_date:'2020-12-31',status:'closed'}],has_more:false})}},accounting:{saveJournal:async body=>{requests.push(body);if(fail)throw Error('The accounting period is closed or locked.');return {id:'mirror',journal_number:'JV-REV'};}}};
 globalThis.__reversal=r;const props={journal:{id:'original',journal_number:'JV-OLD',entry_date:'2020-01-01'},onClose:()=>closed++,onReversed:value=>{saved=value;}},draw=()=>{r.beforeRender();return ui.render(props);},change=(label,value)=>r.controls.find(c=>c['aria-label']===label).onChange({target:{value}});
 try{
  draw();await r.flush();draw();change('Reversal date','2020-01-01');change('Reason for reversal','Correct capital entered twice');draw();
  assert.equal(r.buttons.find(b=>b.label==='Confirm reversal').disabled,true);
  change('Reversal date',businessDate());draw();assert.equal(r.buttons.find(b=>b.label==='Confirm reversal').disabled,false);
  await r.form.onSubmit({preventDefault(){}});assert.match(draw(),/closed or locked/);assert.equal(closed,0);assert.equal(r.controls.find(c=>c['aria-label']==='Reason for reversal').value,'Correct capital entered twice');
  fail=false;await Promise.all([r.form.onSubmit({preventDefault(){}}),r.form.onSubmit({preventDefault(){}})]);
  assert.equal(requests.length,2);assert.deepEqual(requests[1],{action:'reverse',journalId:'original',reversalDate:businessDate(),reason:'Correct capital entered twice'});assert.equal(closed,1);assert.equal(saved.id,'mirror');
 }finally{r.cleanup();delete globalThis.__reversal;}
});
