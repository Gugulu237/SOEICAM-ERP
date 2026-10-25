import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import { fixture, date, user } from './helpers/cashier.mjs';
import { cashierAction } from '../src/server/domain/cashier-workspace.js';
import { guardMutation } from '../src/server/access.js';
const require = createRequire(import.meta.url);
async function ui() {
  const output = await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Workspace,{CashActionDialog} from './src/components/cashier/CashierWorkspace.jsx'; export const render=(props,form=false)=>renderToStaticMarkup(React.createElement(form?CashActionDialog:Workspace,props));`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'cashier-ui', setup(b) {
      b.onResolve({ filter: /^react$/ }, args => /(?:CashierWorkspace|CashHandoverPanel|CashDepositorPicker)\.jsx$/.test(args.importer) ? { path: args.importer.endsWith('CashHandoverPanel.jsx')?'panel':args.importer.endsWith('CashDepositorPicker.jsx')?'picker':'workspace', namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path}) => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};
        const key=()=>['panel','picker'].includes(${JSON.stringify(path)})?${JSON.stringify(path)}:new Error().stack.includes('CashActionDialog')?'cashform':'workspace';
        export default {...React,createElement:(tag,props,...children)=>{globalThis.__cashierUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};
        export const useState=v=>globalThis.__cashierUI.state(key(),v); export const useEffect=(fn,deps)=>globalThis.__cashierUI.effect(key(),fn,deps); export const useRef=v=>globalThis.__cashierUI.ref(key(),v);`, resolveDir: process.cwd() }));
      const mocks = {
        '@/api/erpClient': `export const invalidateERPReads=()=>{};export const erp={functions:{invoke:(...args)=>globalThis.__cashierUI.invoke(...args)}};`,
        '@/lib/router': `import React from 'react'; export const Link=({children,to,...props})=>React.createElement('a',{href:to,...props},children); export const useNavigate=()=>path=>globalThis.__cashierUI.navigation.push(path);export const useSearchParams=()=>[new URLSearchParams(globalThis.__cashierUI.query || ''),value=>{const r=globalThis.__cashierUI;r.query=(typeof value==='function'?value(new URLSearchParams(r.query || '')):value).toString();}];`,
        '@/components/ui/use-toast': `export const useToast=()=>({toast:value=>globalThis.__cashierUI.notifications.push(value)});`,
        '@/components/ui/button': `import React from 'react';export function Button({children,...props}){globalThis.__cashierUI.capture('button',props,children);return React.createElement('button',props,children);}`,
        '@/components/ui/input': `import React from 'react';export function Input(props){globalThis.__cashierUI.inputs.push(props);return React.createElement('input',props);}`,
        '@/components/ui/dialog': `import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogFooter=Dialog,DialogDescription=Dialog;`,
      };
      b.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks,args.path) ? { path: args.path, namespace: 'leaf' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'leaf' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd() }));
    } }] });
  const module = { exports: {} }; new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
  return module.exports.render;
}
function runtime() {
  const r = hookRuntime(), capture = r.capture.bind(r), before = r.beforeRender.bind(r);
  r.inputs = []; r.selects = [];
  r.capture = (tag, props, children) => { capture(tag,props,children); if(tag==='form') r.submit=props.onSubmit; if(tag==='select') r.selects.push(props); };
  r.beforeRender = () => { before(); r.inputs=[];r.selects=[]; };
  return r;
}

test('daily cash can be requested by the cashier and received without an agent submission', async () => {
  const render = await ui(), r = runtime(), { client, entities } = await fixture();
  r.query = 'section=handovers&commercial=daily-agent';
  await entities.CashCollection.create({ commercial_id: 'daily-agent', commercial_name: 'Daily Agent', collection_number: 'DAY-01', collection_date: date,
    amount_collected: 2500, received_amount: 0, outstanding_amount: 2500, method: 'cash', status: 'held_by_commercial' });
  const calls = [];
  r.invoke = async (name, body) => { calls.push(body); return { data: await cashierAction(client, user, body) }; };
  globalThis.__cashierUI = r;
  const draw = () => { r.beforeRender(); return render({}); };
  try {
    draw(); await r.flush(); let html = draw();
    assert.match(html, /Daily Commercial cash/);
    await r.buttons.find(b => b.label === 'Request handover').onClick();
    draw(); await r.flush(); html = draw();
    assert.match(html, /Requested by cashier/);
    assert.equal((await entities.TreasuryTransaction.list()).length, 0);
    await r.buttons.find(b => b.label === 'Receive daily cash').onClick();
    draw();
    assert.equal(r.inputs.find(i => i.type === 'number').value, 2500);
    r.selects.find(s => s.value === '').onChange({ target: { value: 'till' } });
    draw(); await r.submit({ preventDefault() {} });
    draw(); await r.flush(); html = draw();
    assert.match(html, /Settled/);
    assert.equal((await entities.TreasuryAccount.get('till')).balance, 102500);
    assert.equal(calls.filter(c => c.action === 'cashierRequestHandover').length, 1);
  } finally { r.cleanup(); delete globalThis.__cashierUI; }
});

test('Cashier has two main actions and opens a depositor menu without navigating or creating a sale',async()=>{
 const render=await ui(),r=runtime(),{client,entities}=await fixture();
 await entities.Invoice.create({invoice_number:'INV-01',customer_id:'customer-a',customer_name:'Customer A',payment_type:'credit',balance:1000,status:'posted',invoice_date:date});
 r.invoke=async(name,body)=>({data:await cashierAction(client,user,body)});globalThis.__cashierUI=r;
 const draw=()=>{r.beforeRender();return render({});};
 try{
  draw();await r.flush();const html=draw();assert.match(html,/Receive payments/);assert.doesNotMatch(html,/Daily Commercial cash|Customer ledger balances|HOV-01/);
  assert.ok(r.buttons.find(b=>b.label==='Receive cash'));assert.ok(r.buttons.find(b=>b.label==='Small expense'));
  assert.deepEqual(r.buttons.filter(b=>b.role==='tab').map(b=>b.label),['Receive payments','Petty cash','Daily savings','Approved payments']);
  r.buttons.find(b=>b.label==='Receive cash').onClick();assert.match(draw(),/Who is depositing the cash/);assert.match(draw(),/INV-01/);
  r.buttons.find(b=>b['aria-label']==='Receive cash from Agent A').onClick();draw();assert.equal(r.inputs.find(i=>i.type==='number').value,1000);
  assert.equal((await entities.TreasuryTransaction.list()).length,0);assert.deepEqual(r.navigation,[]);
  const source=await cashierAction(client,user,{action:'cashierWorkspace',date});
  r.beforeRender();render({data:{...source,isExample:true},preview:true});assert.equal(r.buttons.find(b=>b.label==='Small expense').disabled,true);
 }finally{r.cleanup();delete globalThis.__cashierUI;}
});

test('Receive cash prepares and receives a daily collection only when the cashier confirms the amount',async()=>{
 const render=await ui(),r=runtime(),{client,entities}=await fixture(),calls=[];
 await entities.CashCollection.create({commercial_id:'daily-agent',commercial_name:'Daily Agent',collection_number:'DAY-02',customer_name:'Customer A',collection_date:date,amount_collected:2500,received_amount:0,outstanding_amount:2500,method:'cash',status:'held_by_commercial'});
 r.invoke=async(name,body)=>{calls.push(body);return {data:await cashierAction(client,user,body)};};globalThis.__cashierUI=r;
 const draw=()=>{r.beforeRender();return render({});};
 try{
  draw();await r.flush();draw();r.buttons.find(b=>b.label==='Receive cash').onClick();draw();r.buttons.find(b=>b['aria-label']==='Receive cash from Daily Agent').onClick();draw();
  assert.equal((await entities.CashHandover.list()).length,1);assert.equal(r.inputs.find(i=>i.type==='number').value,2500);
  r.selects.find(s=>s.value==='').onChange({target:{value:'till'}});draw();await r.submit({preventDefault(){}});draw();await r.flush();draw();
  assert.equal(calls.filter(b=>b.action==='cashierReceiveDailyCash').length,1);assert.equal(calls.some(b=>b.action==='cashierRequestHandover'),false);
  assert.equal((await entities.TreasuryAccount.get('till')).balance,102500);assert.equal((await entities.FieldSale.list()).length,0);assert.equal((await entities.Invoice.list()).length,0);
 }finally{r.cleanup();delete globalThis.__cashierUI;}
});

test('the real transfer form retains a failed draft and request key, then saves through the checked handler', async () => {
  const render=await ui(),r=runtime(),{client,entities}=await fixture(),source=await cashierAction(client,user,{action:'cashierWorkspace',date});
  const calls=[];let done=0,fail=true;
  r.invoke=async(name,body)=>{calls.push(body);if(fail)throw Error('Connection interrupted');return {data:await cashierAction(client,user,body)};};
  globalThis.__cashierUI=r;
  const props={kind:'transfer',requestKey:'retained-key',source,onClose:()=>{},onDone:()=>done++};
  const draw=()=>{r.beforeRender();return render(props,true);};
  try {
    draw();r.selects[0].onChange({target:{value:'till'}});r.selects[1].onChange({target:{value:'float'}});
    r.inputs.find(i=>i.type==='number').onChange({target:{value:'2500'}});
    r.inputs.find(i=>i.value===''&&!i.type).onChange({target:{value:'Cash float replenishment'}});
    draw();r.inputs.find(i=>i['aria-label']==='Receipt / transaction reference').onChange({target:{value:'DEP-01'}});
    draw();await r.submit({preventDefault(){}});assert.match(draw(),/Connection interrupted/);assert.equal(done,0);
    assert.equal(r.inputs.find(i=>i.type==='number').value,'2500');
    fail=false;await r.submit({preventDefault(){}});assert.equal(done,1);
    assert.equal(calls.length,2);assert.equal(calls[0].requestKey,calls[1].requestKey);
    assert.equal((await entities.TreasuryAccount.get('till')).balance,97500);
    assert.equal((await entities.TreasuryAccount.get('float')).balance,102500);
  } finally {r.cleanup();delete globalThis.__cashierUI;}
});

test('Cashier cannot edit approved amounts or approve their own expense via generic table writes',()=>{
  const context={user,employee:{id:'cashier',role:'cashier',status:'active'}};
  const pending={status:'pending_approval',requester_id:'cashier',amount:5000},expense={status:'approved',requester_id:'cashier',amount:5000},payment={status:'approved',amount:5000};
  const before=structuredClone([pending,expense,payment]);
  assert.throws(()=>guardMutation(context,'ExpenseRequest','update',{status:'approved'},pending),{status:403});
  assert.throws(()=>guardMutation(context,'ExpenseRequest','update',{amount:999999},expense),{status:403});
  assert.throws(()=>guardMutation(context,'Payment','update',{amount:999999},payment),{status:403});
  assert.deepEqual([pending,expense,payment],before);
  assert.doesNotThrow(()=>guardMutation(context,'ExpenseRequest','update',{receipt_url:'private/receipt'},{status:'paid'}));
});

test('Cashier handover history loads only when opened and retains the selected Commercial without exposing receipt actions on completed records',async()=>{
  const render=await ui(),r=runtime(),{client}=await fixture(),calls=[];r.query='section=handovers&commercial=agent-a';
  r.invoke=async(name,body)=>{calls.push(body);if(body.action==='cashierHandoverHistory')return {data:{records:[{id:'closed',handover_number:'HOV-CLOSED',commercial_id:'agent-a',commercial_name:'Agent A',handover_date:date,received_date:date,status:'received',received_amount:1000,acknowledgement_reference:'ACK-CLOSED',treasury_account_name:'Till',cashier_name:'Cashier'}],next_cursor:null}};return {data:await cashierAction(client,user,body)};};globalThis.__cashierUI=r;
  const draw=()=>{r.beforeRender();return render({});};
  try{draw();await r.flush();draw();assert.equal(calls.some(c=>c.action==='cashierHandoverHistory'),false);r.buttons.find(b=>b.label==='Received history').onClick();draw();await r.flush();const html=draw();assert.match(html,/HOV-CLOSED/);assert.match(html,/ACK-CLOSED/);assert.match(html,/Till/);assert.equal(r.buttons.filter(b=>b.label==='Receive cash').length,1);const request=calls.find(c=>c.action==='cashierHandoverHistory');assert.equal(request.commercialId,'agent-a');assert.equal(new URLSearchParams(r.query).get('section'),'handovers');assert.equal(new URLSearchParams(r.query).get('handover_view'),'history');}finally{r.cleanup();delete globalThis.__cashierUI;}
});

test('receiving a handover inside Cashier retains failed input and posts its exact cash amount once on retry',async()=>{
  const render=await ui(),r=runtime(),{client,entities}=await fixture(),source=await cashierAction(client,user,{action:'cashierWorkspace',date}),requests=[];let fail=true,done=0;
  r.invoke=async(name,body)=>{requests.push(body);if(fail)throw Error('Cash receipt connection interrupted');return {data:await cashierAction(client,user,body)};};globalThis.__cashierUI=r;
  const props={kind:'handover',document:source.handovers[0],requestKey:'cashier-handover-retained',source,onClose:()=>{},onDone:()=>done++},draw=()=>{r.beforeRender();return render(props,true);};
  try{draw();r.selects[0].onChange({target:{value:'till'}});r.inputs.find(i=>i.type==='number').onChange({target:{value:'600'}});draw();r.inputs.find(i=>i.placeholder==='Required if the cash received is short').onChange({target:{value:'Agent still holds 400 XAF'}});draw();await r.submit({preventDefault(){}});assert.match(draw(),/Cash receipt connection interrupted/);assert.equal(done,0);assert.equal(r.inputs.find(i=>i.type==='number').value,'600');fail=false;await r.submit({preventDefault(){}});assert.equal(done,1);assert.equal(requests[0].requestKey,requests[1].requestKey);assert.equal(requests[1].handoverId,'handover');assert.equal(requests[1].receivedAmount,600);assert.equal((await entities.TreasuryAccount.get('till')).balance,100600);assert.equal((await entities.CashHandover.get('handover')).status,'partially_received');assert.equal((await entities.FieldSale.list()).length,0);assert.equal((await entities.Invoice.list()).length,0);}finally{r.cleanup();delete globalThis.__cashierUI;}
});
