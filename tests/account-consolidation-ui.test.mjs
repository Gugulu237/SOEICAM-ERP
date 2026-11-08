import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';

const require=createRequire(import.meta.url),date='2026-11-08';
let compiled;
async function renderer(){
 if(compiled)return compiled;
 const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Consolidation from './src/components/accounting/AccountConsolidation.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Consolidation,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'cogs-consolidation-ui',setup(b){
  b.onResolve({filter:/^react\/jsx-runtime$/},a=>a.importer.endsWith('AccountConsolidation.jsx')?{path:'jsx',namespace:'capture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`import {jsx as x,jsxs as xs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,props,key)=>{globalThis.__consolidationUI.capture(tag,props,props?.children);return x(tag,props,key);};export const jsxs=(tag,props,key)=>{globalThis.__consolidationUI.capture(tag,props,props?.children);return xs(tag,props,key);};`,resolveDir:process.cwd()}));
  b.onResolve({filter:/^react$/},a=>a.importer.endsWith('AccountConsolidation.jsx')?{path:'component',namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__consolidationUI.state('component',v),useRef=v=>globalThis.__consolidationUI.ref('component',v),useEffect=(fn,deps)=>globalThis.__consolidationUI.effect('component',fn,deps);`,resolveDir:process.cwd()}));
  const mocks={
   '@/api/erpClient':"export const erp={entities:{Account:'Account'},accounting:{saveAccount:body=>globalThis.__consolidationUI.request(body)}};",
   '@/lib/field-pos':"export const readAll=async entity=>{globalThis.__consolidationUI.reads.push(entity);return structuredClone(globalThis.__consolidationUI.accounts);};",
   '@/lib/business-date':`export const businessDate=()=>${JSON.stringify(date)};`,
   '@/lib/localization':'export const useLocaleRender=()=>{};',
   '@/lib/router':"import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);",
   '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__consolidationUI.capture('input',props);return React.createElement('input',props);};",
   '@/components/ui/button':"import React from 'react';export const Button=({children,variant,...props})=>{globalThis.__consolidationUI.capture('button',props,children);return React.createElement('button',props,children);};",
  };
  b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
  b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});
 const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);compiled=module.exports.render;return compiled;
}
const source={id:'old-cogs',account_number:'7000',name:'Direct Material COGS',account_type:'cogs',normal_balance:'debit',is_active:true,is_posting:true};
const target={id:'retained-cogs',account_number:'5100',name:'Cost of Goods Sold',account_type:'cogs',normal_balance:'debit',is_active:true,is_posting:true,is_system:true};
const accounts=[source,target,{...source,id:'inactive',account_number:'7100',is_active:false},{...source,id:'aliased',account_number:'7200',consolidated_into_account_id:target.id},{...source,id:'wrong-type',account_number:'8000',account_type:'expense'}];
const preview=body=>({token:'snapshot-'+body.date+'-'+body.reference,source_account:source,target_account:target,source_balance:50,target_balance:300,combined_balance:350,transfer_lines:[{account_id:target.id,debit:50,credit:0},{account_id:source.id,debit:0,credit:50}],products_count:2,rules_count:1});
const saved={source_account_id:source.id,target_account_id:target.id,journal_id:'transfer-journal',journal_number:'JV-CONSOLIDATED',product_count:2,rule_count:1,reused:false};
const control=(r,label)=>r.controls.find(element=>element['aria-label']===label);
const button=(r,label)=>r.buttons.find(element=>element.label===label);
const change=(r,label,value)=>control(r,label).onChange({target:{value,checked:value}});
async function environment(){
 const render=await renderer(),r=hookRuntime(),capture=r.capture.bind(r);r.accounts=accounts;r.calls=[];r.reads=[];r.corrected=[];r.elements=[];
 r.capture=(tag,props,children)=>{capture(tag,props,children);r.elements.push({tag,props:props||{}});};
 r.request=async body=>{r.calls.push(structuredClone(body));return body.action==='previewConsolidation'?preview(body):saved;};
 globalThis.__consolidationUI=r;
 const draw=()=>{r.beforeRender();r.elements=[];return render({onConsolidated:value=>r.corrected.push(value)});};
 draw();await r.flush();draw();
 return {r,draw,close:()=>{r.cleanup();delete globalThis.__consolidationUI;}};
}
function reference(r,draw,value='  Signed COGS account review  '){change(r,'Review reference',value);return draw();}
async function review(r,draw){reference(r,draw);await button(r,'Preview COGS consolidation').onClick();draw();}

test('COGS consolidation defaults to 7000 into 5100 and only previews after an explicit reference',async()=>{
 const f=await environment(),{r,draw}=f;
 try{
  assert.deepEqual(r.reads,['Account']);assert.equal(r.calls.length,0);
  assert.equal(control(r,'Duplicate COGS account').value,source.id);assert.equal(control(r,'Retained COGS account').value,target.id);assert.equal(control(r,'Consolidation date').value,date);
  const html=draw(),sourceOptions=html.match(/<select aria-label="Duplicate COGS account"[\s\S]*?<\/select>/)[0],targetOptions=html.match(/<select aria-label="Retained COGS account"[\s\S]*?<\/select>/)[0];
  assert.match(sourceOptions,/old-cogs/);assert.match(sourceOptions,/7000 \/ Direct Material COGS/);assert.doesNotMatch(sourceOptions,/retained-cogs|inactive|aliased|wrong-type/);assert.match(targetOptions,/retained-cogs/);assert.doesNotMatch(targetOptions,/inactive|aliased|wrong-type/);
  assert.equal(button(r,'Preview COGS consolidation').disabled,true);reference(r,draw);
  await button(r,'Preview COGS consolidation').onClick();const rendered=draw();
  assert.deepEqual(r.calls,[{action:'previewConsolidation',sourceAccountId:source.id,targetAccountId:target.id,date,reference:'Signed COGS account review'}]);
  assert.match(rendered,/Combined balance/);assert.match(rendered,/350 XAF/);assert.match(rendered,/Total profit, inventory and cash remain unchanged/);
  assert.match(rendered,/7000 Direct Material COGS to 5100 Cost of Goods Sold/);assert.doesNotMatch(rendered,/[\uFFFD\u001A\u00b7\u2192]/);
  assert.match(rendered,/Products to remap: <strong>2<\/strong>/);assert.match(rendered,/Posting rules to remap: <strong>1<\/strong>/);assert.match(rendered,/The duplicate account will become read-only\. Historical journal entries remain available for audit\./);
  assert.equal(button(r,'Confirm COGS consolidation').disabled,true);await button(r,'Confirm COGS consolidation').onClick();assert.equal(r.calls.length,1,'a preview must never post without review');
 }finally{f.close();}
});

test('failed consolidation retains the reviewed token and UUID for a single identical retry',async()=>{
 const f=await environment(),{r,draw}=f;let fail=true;const request=r.request;
 r.request=async body=>{if(body.action==='consolidate'&&fail){r.calls.push(structuredClone(body));throw Error('Connection interrupted');}return request(body);};
 try{
  await review(r,draw);change(r,'Confirm COGS consolidation',true);draw();await button(r,'Confirm COGS consolidation').onClick();assert.match(draw(),/Connection interrupted/);
  assert.equal(r.corrected.length,0);assert.equal(control(r,'Confirm COGS consolidation').checked,true);assert.equal(control(r,'Review reference').value,'  Signed COGS account review  ');
  fail=false;const post=button(r,'Confirm COGS consolidation');await Promise.all([post.onClick(),post.onClick()]);const html=draw();
  const writes=r.calls.filter(call=>call.action==='consolidate');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.match(writes[1].requestKey,/^[a-f\d-]{36}$/);
  assert.deepEqual(writes[1],{action:'consolidate',sourceAccountId:source.id,targetAccountId:target.id,date,reference:'Signed COGS account review',token:'snapshot-'+date+'-Signed COGS account review',requestKey:writes[1].requestKey,confirmed:true});
  assert.deepEqual(r.corrected,[saved]);assert.match(html,/COGS accounts consolidated/);assert.match(html,/href="\/accounting\/journals\/transfer-journal"/);assert.match(html,/JV-CONSOLIDATED/);assert.match(html,/The duplicate account is now read-only\. Historical journal entries remain available for audit\./);assert.equal(button(r,'Confirm COGS consolidation'),undefined);assert.equal(button(r,'Preview COGS consolidation'),undefined);
 }finally{f.close();}
});

test('changing date or review reference discards the old preview and requires another confirmation',async()=>{
 const f=await environment(),{r,draw}=f;
 try{
  await review(r,draw);change(r,'Confirm COGS consolidation',true);draw();
  change(r,'Consolidation date','2026-11-07');assert.doesNotMatch(draw(),/Combined balance/);assert.equal(button(r,'Confirm COGS consolidation'),undefined);
  await button(r,'Preview COGS consolidation').onClick();draw();assert.equal(control(r,'Confirm COGS consolidation').checked,false);
  change(r,'Review reference','Revised account review');draw();assert.equal(button(r,'Confirm COGS consolidation'),undefined);
  await button(r,'Preview COGS consolidation').onClick();draw();change(r,'Confirm COGS consolidation',true);draw();await button(r,'Confirm COGS consolidation').onClick();
  const post=r.calls.at(-1);assert.equal(post.date,'2026-11-07');assert.equal(post.reference,'Revised account review');assert.equal(post.token,'snapshot-2026-11-07-Revised account review');
  assert.equal(r.calls.filter(call=>call.action==='consolidate').length,1);
 }finally{f.close();}
});

test('an in-flight consolidation disables review controls and ignores repeated submissions and edits',async()=>{
 const f=await environment(),{r,draw}=f;const request=r.request;let resolvePost;
 r.request=body=>body.action==='consolidate'?new Promise(resolve=>{r.calls.push(structuredClone(body));resolvePost=resolve;}):request(body);
 try{
  await review(r,draw);change(r,'Confirm COGS consolidation',true);draw();
  const postButton=button(r,'Confirm COGS consolidation'),pending=postButton.onClick();draw();
  assert.equal(r.elements.find(element=>element.tag==='fieldset').props.disabled,true);assert.equal(button(r,'Consolidating accounts...').disabled,true);assert.equal(control(r,'Confirm COGS consolidation').disabled,true);
  change(r,'Review reference','Ignored change');control(r,'Confirm COGS consolidation').onChange({target:{checked:false}});await postButton.onClick();draw();
  assert.equal(control(r,'Review reference').value,'  Signed COGS account review  ');assert.equal(control(r,'Confirm COGS consolidation').checked,true);assert.equal(r.calls.filter(call=>call.action==='consolidate').length,1);
  resolvePost(saved);await pending;assert.match(draw(),/COGS accounts consolidated/);assert.equal(r.corrected.length,1);
 }finally{f.close();}
});

test('unsupported account references remain visible and prevent confirming or posting the preview',async()=>{
 const f=await environment(),{r,draw}=f;
 r.request=async body=>{r.calls.push(structuredClone(body));return {...preview(body),products_count:0,rules_count:0,unsupported_references:[{entity:'ExpenseCategory',id:'legacy-materials',name:'Direct material purchases'},{entity:'JournalTemplate',id:'template-17',name:''}]};};
 try{
  await review(r,draw);const html=draw();
  assert.match(html,/These references must be resolved before consolidation\./);assert.match(html,/ExpenseCategory \/ Direct material purchases/);assert.match(html,/JournalTemplate \/ template-17/);
  assert.match(html,/Products to remap: <strong>0<\/strong>/);assert.match(html,/Posting rules to remap: <strong>0<\/strong>/);
  assert.equal(control(r,'Confirm COGS consolidation').disabled,true);assert.equal(button(r,'Confirm COGS consolidation').disabled,true);
  change(r,'Confirm COGS consolidation',true);draw();assert.equal(control(r,'Confirm COGS consolidation').checked,false);
  await button(r,'Confirm COGS consolidation').onClick();assert.equal(r.calls.length,1);assert.equal(r.corrected.length,0);
 }finally{f.close();}
});
