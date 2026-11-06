import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
  if(compiled)return compiled;
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Correction from './src/components/accounting/SetupStockCorrection.jsx';import Integrity from './src/components/accounting/AccountingIntegrityCheck.jsx';export const render=(props,kind)=>renderToStaticMarkup(React.createElement(kind==='integrity'?Integrity:Correction,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'setup-stock-review-ui',setup(b){
    const component=/(SetupStockCorrection|AccountingIntegrityCheck)\.jsx$/;
    b.onResolve({filter:/^react\/jsx-runtime$/},a=>component.test(a.importer)?{path:'jsx',namespace:'capture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`import {jsx as x,jsxs as xs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,props,key)=>{globalThis.__setupUI.capture(tag,props,props?.children);return x(tag,props,key);};export const jsxs=(tag,props,key)=>{globalThis.__setupUI.capture(tag,props,props?.children);return xs(tag,props,key);};`,resolveDir:process.cwd()}));
    b.onResolve({filter:/^react$/},a=>component.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(key)};export default React;export const useState=v=>globalThis.__setupUI.state(key,v),useRef=v=>globalThis.__setupUI.ref(key,v),useEffect=(fn,deps)=>globalThis.__setupUI.effect(key,fn,deps);`,resolveDir:process.cwd()}));
    const mocks={
      '@/lib/accounting-controls-client':'export const accountingControlRequest=(area,body)=>globalThis.__setupUI.request(area,body);',
      '@/lib/localization':'export const useLocaleRender=()=>{};',
      '@/lib/router':`import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);`,
      '@/components/ui/input':`import React from 'react';export const Input=props=>{globalThis.__setupUI.capture('input',props);return React.createElement('input',props);};`,
      '@/components/ui/button':`import React from 'react';export const Button=({children,variant,size,...props})=>{globalThis.__setupUI.capture('button',props,children);return React.createElement('button',props,children);};`,
    };
    b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);compiled=module.exports.render;return compiled;
}
const equity={id:'equity',account_number:'3990',name:'Opening equity'};
const original=[{account_id:'stock',account_number:'1300',account_name:'Inventory',account_type:'asset',debit:300,credit:0},{account_id:'gain',account_number:'7590',account_name:'Other operating income',account_type:'other_income',debit:0,credit:300}];
const workspace={date:'2026-11-06',equity_accounts:[equity],candidates:[
  {journal_id:'setup-1',journal_number:'JV-SETUP-1',date:'2026-10-01',description:'Stock starting position',source_reference:'Count sheet A',profit_effect:300,eligible:true,blocked_reasons:[],corrected:false,lines:original},
  {journal_id:'setup-2',journal_number:'JV-SETUP-2',date:'2026-10-01',description:'Second starting position',profit_effect:200,eligible:true,blocked_reasons:[],corrected:false,lines:original},
  {journal_id:'blocked',journal_number:'JV-BLOCKED',date:'2026-10-01',description:'Closed period',profit_effect:100,eligible:false,blocked_reasons:['The accounting period is closed.'],corrected:false,lines:original},
  {journal_id:'done',journal_number:'JV-DONE',date:'2026-10-01',description:'Already reviewed',profit_effect:50,eligible:false,blocked_reasons:[],corrected:true,lines:original},
]};
const result=body=>({token:'token-'+body.reference,accounting_start_date:body.accountingStartDate,reference:body.reference,offset_account:equity,journals:body.journalIds.map(id=>({source_journal_id:id,journal_number:'JV-SETUP-1',date:'2026-10-01',profit_effect:300,profit_adjustment:-300,lines:[{account_id:'gain',account_number:'7590',account_name:'Other operating income',debit:300,credit:0},{account_id:'equity',account_number:'3990',account_name:'Opening equity',debit:0,credit:300}]})),total_profit_adjustment:-300,stock_change:0,cash_change:0});
const saved={correction_id:'correction-1',journals:[{source_journal_id:'setup-1',journal_id:'corrected-1',journal_number:'JV-CORRECTION-1',date:'2026-10-01',profit_adjustment:-300}],total_profit_adjustment:-300,reused:false};
const control=(r,label)=>r.controls.find(c=>c['aria-label']===label);
const button=(r,label)=>r.buttons.find(b=>b.label===label);
const change=(r,label,value)=>control(r,label).onChange({target:{value,checked:value}});
async function environment(kind='correction'){
  const render=await renderer(),r=hookRuntime();r.calls=[];r.elements=[];r.corrected=[];
  const capture=r.capture.bind(r);r.capture=(tag,props,children)=>{capture(tag,props,children);r.elements.push({tag,props:props||{}});};
  r.request=async(area,body)=>{r.calls.push({area,body});return body?body.action==='preview'?result(body):saved:structuredClone(workspace);};
  globalThis.__setupUI=r;
  const draw=()=>{r.beforeRender();r.elements=[];return render({onCorrected:value=>r.corrected.push(value)},kind);};
  draw();await r.flush();draw();
  return {r,draw,close:()=>{r.cleanup();delete globalThis.__setupUI;}};
}
function fill(r,draw,date='2026-10-01'){
  change(r,'Select setup journal JV-SETUP-1',true);draw();
  if(date){change(r,'Accounting start date',date);draw();}
  change(r,'Opening equity counterpart','equity');draw();
  change(r,'Setup evidence reference','  Signed opening count  ');draw();
  change(r,'Confirm these are opening setup entries',true);draw();
}

test('setup correction starts with no selection, shows blocked entries and requires exact reviewed journals before posting',async()=>{
  const f=await environment(),{r,draw}=f;
  try{
    assert.equal(r.calls.length,1);assert.equal(r.calls[0].body,undefined);
    assert.equal(control(r,'Select setup journal JV-SETUP-1').checked,false);
    assert.equal(control(r,'Select setup journal JV-BLOCKED').disabled,true);
    assert.equal(control(r,'Select setup journal JV-DONE').disabled,true);
    assert.match(draw(),/The accounting period is closed/);assert.match(draw(),/Already corrected/);
    assert.equal(control(r,'Accounting start date').value,'');
    assert.equal(button(r,'Preview correction').disabled,true);fill(r,draw,null);
    assert.equal(button(r,'Preview correction').disabled,true,'Selecting journals and certifying setup still requires an explicit cutoff date');
    change(r,'Accounting start date','2026-10-01');draw();
    await button(r,'Preview correction').onClick();const html=draw();
    assert.deepEqual(r.calls[1].body,{action:'preview',journalIds:['setup-1'],accountingStartDate:'2026-10-01',offsetAccountId:'equity',reference:'Signed opening count',confirmSetup:true});
    assert.match(html,/Change in inventory/);assert.match(html,/Change in cash/);assert.match(html,/-300 XAF/);assert.match(html,/3990 Opening equity/);
    assert.equal(button(r,'Confirm and post correction').disabled,true);
    await button(r,'Confirm and post correction').onClick();assert.equal(r.calls.length,2);
    change(r,'Setup evidence reference','Different evidence');assert.doesNotMatch(draw(),/Review the correction before posting/);
    assert.equal(control(r,'Confirm reviewed correction'),undefined);assert.equal(control(r,'Select setup journal JV-SETUP-1').checked,true);
  }finally{f.close();}
});

test('failed posting retains its exact reviewed payload and retry key, and duplicate clicks cannot post twice',async()=>{
  const f=await environment(),{r,draw}=f;let fail=true;const originalRequest=r.request;
  r.request=async(area,body)=>{if(body?.action==='post'&&fail){r.calls.push({area,body});throw Error('Connection interrupted');}return originalRequest(area,body);};
  try{
    fill(r,draw);await button(r,'Preview correction').onClick();draw();change(r,'Confirm reviewed correction',true);draw();
    await button(r,'Confirm and post correction').onClick();assert.match(draw(),/Connection interrupted/);
    assert.equal(control(r,'Setup evidence reference').value,'  Signed opening count  ');assert.equal(control(r,'Confirm reviewed correction').checked,true);assert.equal(r.corrected.length,0);
    fail=false;const post=button(r,'Confirm and post correction');await Promise.all([post.onClick(),post.onClick()]);const html=draw();
    const posts=r.calls.filter(call=>call.body?.action==='post');assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);
    assert.match(posts[1].body.requestKey,/^[a-f\d-]{36}$/);assert.equal(posts[1].body.confirmed,true);
    assert.equal(r.corrected.length,1);assert.match(html,/Setup correction posted/);assert.match(html,/href="\/accounting\/journals\/corrected-1"/);
    assert.equal(control(r,'Select setup journal JV-SETUP-1').disabled,true);assert.equal(control(r,'Select setup journal JV-SETUP-1').checked,false);
    assert.equal(button(r,'Confirm and post correction'),undefined);
  }finally{f.close();}
});

test('stale review errors preserve inputs and changing the cutoff requires a fresh preview and confirmation',async()=>{
  const f=await environment(),{r,draw}=f;const originalRequest=r.request;let stale=true;
  r.request=async(area,body)=>{if(body?.action==='post'&&stale){r.calls.push({area,body});throw Error('The ledger changed. Refresh the preview.');}return originalRequest(area,body);};
  try{
    fill(r,draw);await button(r,'Preview correction').onClick();draw();change(r,'Confirm reviewed correction',true);draw();
    await button(r,'Confirm and post correction').onClick();assert.match(draw(),/The ledger changed/);
    assert.equal(control(r,'Opening equity counterpart').value,'equity');assert.equal(control(r,'Select setup journal JV-SETUP-1').checked,true);
    const firstKey=r.calls.at(-1).body.requestKey;
    change(r,'Accounting start date','2026-10-02');draw();assert.equal(button(r,'Confirm and post correction'),undefined);
    await button(r,'Preview correction').onClick();draw();assert.equal(control(r,'Confirm reviewed correction').checked,false);
    change(r,'Confirm reviewed correction',true);draw();stale=false;await button(r,'Confirm and post correction').onClick();draw();
    const posted=r.calls.at(-1).body;assert.notEqual(posted.requestKey,firstKey);assert.equal(posted.accountingStartDate,'2026-10-02');
  }finally{f.close();}
});

test('integrity section loads correction candidates only when opened and keeps the review mounted when collapsed',async()=>{
  const f=await environment('integrity'),{r,draw}=f;
  const toggle=()=>r.elements.find(element=>element.tag==='details'&&element.props.onToggle).props.onToggle;
  try{
    assert.equal(r.calls.length,0);assert.match(draw(),/Correct setup inventory entries/);
    toggle()({currentTarget:{open:true}});draw();await r.flush();draw();assert.equal(r.calls.length,1);
    fill(r,draw);await button(r,'Preview correction').onClick();draw();
    toggle()({currentTarget:{open:false}});draw();toggle()({currentTarget:{open:true}});draw();await r.flush();
    assert.match(draw(),/Review the correction before posting/);assert.equal(r.calls.length,2);
  }finally{f.close();}
});

test('supplier mismatch review exposes source journals and exact proposed accounts without posting or classifying advances as errors',async()=>{
  const f=await environment('integrity'),{r,draw}=f;
  r.request=async(area,body)=>{
    r.calls.push({area,body});assert.equal(area,'integrity');assert.equal(body,undefined);
    return {issue_count:2,counts:{supplier_payment_account_mismatch:1,supplier_payment_evidence_unverified:1},issues:[{code:'supplier_payment_account_mismatch',reference:'PAY-41'},{code:'supplier_payment_evidence_unverified',reference:'PAY-42'}],totals:{debit:800,credit:800,difference:0},supplier_payable_mismatches:{
      mismatches:[{payment_id:'payment-41',payment_number:'PAY-41',bill_id:'bill-41',bill_number:'BILL-41',payment_journal_id:'payment-journal',payment_journal_number:'JV-PAY-41',receipt_journal_id:'receipt-journal',receipt_journal_number:'JV-RECEIPT-41',supplier_id:'supplier',amount:400,original_payable:{id:'old-ap',account_number:'2100',name:'Supplier Payables'},payment_payable:{id:'new-ap',account_number:'2200',name:'Accounts payable - suppliers'},proposed_lines:[{account_id:'old-ap',debit:400,credit:0},{account_id:'new-ap',debit:0,credit:400}],review_required:true}],
      blocked:[{payment_id:'payment-42',payment_number:'PAY-42',bill_id:'bill-42',reason:'The payment journal is missing.'}],excluded_advances:3,
    }};
  };
  try{
    await button(r,'Check accounting').onClick();const html=draw();
    assert.match(html,/Supplier payable account review/);assert.match(html,/href="\/accounting\/journals\/receipt-journal"/);assert.match(html,/href="\/accounting\/journals\/payment-journal"/);
    assert.match(html,/2100 Supplier Payables<\/td><td[^>]*>400 XAF<\/td><td[^>]*>0 XAF/);
    assert.match(html,/2200 Accounts payable - suppliers<\/td><td[^>]*>0 XAF<\/td><td[^>]*>400 XAF/);
    assert.match(html,/Proposed correcting entry - review only/);assert.match(html,/The payment journal is missing/);assert.match(html,/Supplier advances excluded from this comparison: 3/);
    assert.equal(button(r,'Confirm and post correction'),undefined);assert.equal(r.calls.length,1);
  }finally{f.close();}
});
