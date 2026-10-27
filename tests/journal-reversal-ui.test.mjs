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
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'import React from '+JSON.stringify(require.resolve('react'))+';export default {...React,createElement:(tag,props,...children)=>{if(tag==="form")globalThis.__reversal.form=props;if(tag==="input")globalThis.__reversal.capture(tag,props);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__reversal.state("dialog",v),useRef=v=>globalThis.__reversal.ref("dialog",v),useEffect=(fn,d)=>globalThis.__reversal.effect("dialog",fn,d);',resolveDir:process.cwd()}));
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
 r.client={entities:{AccountingPeriod:{filter:async()=>({items:[{id:'closed',start_date:'2020-01-01',end_date:'2020-12-31',status:'closed'}],has_more:false})}},accounting:{previewJournalReversal:async()=>({snapshot:'a'.repeat(64),requires_review:false,accounts:[],treasury:[],blocked:[]}),saveJournal:async body=>{requests.push(body);if(fail)throw Error('The accounting period is closed or locked.');return {id:'mirror',journal_number:'JV-REV'};}}};
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

const reviewedPreview=()=>({snapshot:'a'.repeat(64),requires_review:true,accounts:[{id:'cash',name:'Till GL',account_number:'5700',stored_balance:1000,ledger_balance:1000,balance_after:0,mismatch:false}],treasury:[{id:'till',name:'Factory till',account_type:'cash',stored_balance:0,ledger_balance:1000,balance_after:0,mismatch:true,retains_treasury_balance:true}],blocked:[]});
test('treasury differences require an explicitly entered verified amount and consent; failed saves retain the reviewed values',async()=>{
 const ui=await compiled(),r=hookRuntime(),requests=[];let fail=true,closed=0;
 r.client={entities:{AccountingPeriod:{filter:async()=>({items:[],has_more:false})}},accounting:{previewJournalReversal:async()=>reviewedPreview(),saveJournal:async body=>{requests.push(body);if(fail)throw Error('Audit unavailable');return {id:'inverse'};}}};
 globalThis.__reversal=r;const props={journal:{id:'original',journal_number:'JV-OLD',entry_date:'2020-01-01'},onClose:()=>closed++,onReversed:()=>{}},draw=()=>{r.beforeRender();return ui.render(props);},change=(label,value)=>r.controls.find(c=>c['aria-label']===label).onChange({target:{value}});
 try{
  draw();await r.flush();assert.match(draw(),/Review treasury differences/);assert.match(draw(),/Factory till/);change('Reason for reversal','Correct the duplicated manual receipt');draw();
  assert.equal(r.buttons.find(b=>b.label==='Confirm reversal').disabled,true);change('Verified balance for Factory till','0');draw();assert.equal(r.buttons.find(b=>b.label==='Confirm reversal').disabled,true);
  r.controls.find(c=>c['aria-label']==='Confirm verified ledger and treasury balances').onChange({target:{checked:true}});draw();assert.equal(r.buttons.find(b=>b.label==='Confirm reversal').disabled,false);
  await r.form.onSubmit({preventDefault(){}});assert.match(draw(),/Audit unavailable/);assert.equal(closed,0);assert.equal(r.controls.find(c=>c['aria-label']==='Verified balance for Factory till').value,'0');assert.equal(r.controls.find(c=>c['aria-label']==='Confirm verified ledger and treasury balances').checked,true);
  fail=false;await r.form.onSubmit({preventDefault(){}});assert.equal(closed,1);assert.deepEqual(requests[1].treasuryReview,{snapshot:'a'.repeat(64),confirmed:true,verifiedBalances:[{treasuryId:'till',balance:'0'}]});
 }finally{r.cleanup();delete globalThis.__reversal;}
});
test('a failed or refreshed balance preview prevents blind reversal and preserves the correction reason',async()=>{
 const ui=await compiled(),r=hookRuntime();let fail=true,posted=0;
 r.client={entities:{AccountingPeriod:{filter:async()=>({items:[],has_more:false})}},accounting:{previewJournalReversal:async()=>{if(fail)throw Error('Balances unavailable');return reviewedPreview();},saveJournal:async()=>{posted++;}}};globalThis.__reversal=r;
 const props={journal:{id:'original',journal_number:'JV-OLD',entry_date:'2020-01-01'},onClose:()=>{},onReversed:()=>{}},draw=()=>{r.beforeRender();return ui.render(props);};
 try{
  draw();await r.flush();assert.match(draw(),/Balances unavailable/);r.controls.find(c=>c['aria-label']==='Reason for reversal').onChange({target:{value:'Correct the original cash entry'}});draw();await r.form.onSubmit({preventDefault(){}});assert.equal(posted,0);
  fail=false;r.buttons.find(b=>b.label==='Reload balance review').onClick();draw();await r.flush();draw();assert.equal(r.controls.find(c=>c['aria-label']==='Reason for reversal').value,'Correct the original cash entry');assert.equal(r.buttons.find(b=>b.label==='Confirm reversal').disabled,true);
  r.controls.find(c=>c['aria-label']==='Verified balance for Factory till').onChange({target:{value:'0'}});r.controls.find(c=>c['aria-label']==='Confirm verified ledger and treasury balances').onChange({target:{checked:true}});draw();
  r.buttons.find(b=>b.label==='Refresh review').onClick();draw();await r.flush();draw();assert.equal(r.controls.find(c=>c['aria-label']==='Verified balance for Factory till').value,'');assert.equal(r.controls.find(c=>c['aria-label']==='Confirm verified ledger and treasury balances').checked,false);assert.equal(r.controls.find(c=>c['aria-label']==='Reason for reversal').value,'Correct the original cash entry');assert.equal(posted,0);
 }finally{r.cleanup();delete globalThis.__reversal;}
});
