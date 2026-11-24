import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const compiled=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Income from './src/components/accounting/IncomeStatement.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Income,props));export {computeActivity} from './src/lib/statements.js';",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'income-basis-ui',setup(b){
 const owned=/(IncomeStatement|StatementSection|MobileIncomeStatementBody)\.jsx$/;
 b.onResolve({filter:/^react$/},a=>owned.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
 b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({resolveDir:process.cwd(),contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__incomeBasisUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__incomeBasisUI.state("+JSON.stringify(key)+",v);"}));
 b.onResolve({filter:/useRecurringExpenseReview$/},()=>({path:'recurring',namespace:'review'}));
 b.onLoad({filter:/.*/,namespace:'review'},()=>({contents:"export const useRecurringExpenseReview=()=>({loading:false,error:'',count:0,total:0,canReview:false});"}));
 const mocks={
  '@/hooks/usePhoneLayout':"export const usePhoneLayout=()=>globalThis.__incomeBasisUI.phone;",
  '@/lib/localization':"export const useLocaleRender=()=>{};",
  '@/lib/recurring-expense-client':"export const recurringExpenseRequest=async(_body,query)=>{globalThis.__incomeBasisUI.charges.push(query);return {pending_total:0};};",
  '@/components/shared/ReportExport':"import React from 'react';export default props=>{globalThis.__incomeBasisUI.export=props;return React.createElement('div',{'data-export-disabled':String(props.disabled)},'Export');};",
  '@/lib/router':"import React from 'react';export const Link=({to,children})=>React.createElement('a',{href:to},children);",
 };
 b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
 b.onLoad({filter:/.*/,namespace:'leaf'},a=>({resolveDir:process.cwd(),contents:mocks[a.path]}));
}}]});
const mod={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,mod,mod.exports);
function source(net=1000,cost=600){
 const accounts=[{id:'ar',account_number:'1100',name:'Receivables',account_type:'asset'},{id:'sales',account_number:'4100',name:'Product sales',account_type:'revenue',normal_balance:'credit'},{id:'tax',account_number:'4300',name:'Output VAT',account_type:'liability',normal_balance:'credit',currency:'XAF'},{id:'cost',account_number:'5100',name:'Cost of goods sold',account_type:'cogs'},{id:'stock',account_number:'1300',name:'Finished inventory',account_type:'asset'},{id:'expense',account_number:'6100',name:'Operating costs',account_type:'expense'},{id:'cash',account_number:'1000',name:'Cash',account_type:'asset'}];
 const tax=Math.round(net*19.25)/100;
 const journalsById={sale:{id:'sale',journal_number:'JV-1',status:'posted',entry_date:'2026-11-10',source_module:'sales',source_document_type:'Invoice'},expense:{id:'expense',journal_number:'JV-2',status:'posted',entry_date:'2026-11-11',source_module:'manual',source_document_type:'manual_journal'}};
 const lines=[['sale','ar',net+tax,0],['sale','sales',0,net],['sale','tax',0,tax],['sale','cost',cost,0],['sale','stock',0,cost],['expense','expense',100,0],['expense','cash',0,100]].map(([journal_id,account_id,debit,credit],i)=>({id:'line-'+i,journal_id,account_id,debit,credit}));
 const input={accounts,journalsById,lines,postingRules:[{rule_key:'tax_payable',account_id:'tax',is_active:true}],fromDate:'2026-11-01',toDate:'2026-11-30'};
 return {...input,activity:mod.exports.computeActivity(input)};
}
const section=(report,title)=>report.sections.find(s=>s.title===title);
const revenue=report=>section(report,'Revenue').totals[0][2];
const profit=(report,label)=>section(report,'Profit and loss').rows.find(r=>r[0]===label)[1];
function fixture(input=source(),phone=false){
 const r=hookRuntime();r.phone=phone;r.charges=[];r.opened=[];globalThis.__incomeBasisUI=r;
 const props={...input,onAccountOpen:row=>r.opened.push(row)};
 const draw=()=>{r.beforeRender();return mod.exports.render(props);};
 const basis=()=>r.controls.find(c=>c['aria-label']==='Revenue basis');
 return {r,props,draw,basis,close:()=>{r.cleanup();delete globalThis.__incomeBasisUI;}};
}

for(const phone of [false,true])test(`the ${phone?'phone':'desktop'} P&L defaults to clearly labelled VAT-inclusive sales, profit and margin`,()=>{
 const input=source(),before=structuredClone(input),f=fixture(input,phone);
 try{
  const html=f.draw(),report=f.r.export.report;
  assert.equal(f.basis().value,'vat_included');assert.match(html,/VAT-inclusive management P/);assert.match(html,/Sales including VAT/);assert.match(html,/VAT on sales/);assert.match(html,/Gross Profit \(VAT included\)/);assert.match(html,/Result including VAT/);assert.match(html,/49\.7%/);
  assert.equal(revenue(report),1192.5);assert.equal(profit(report,'Gross profit'),592.5);assert.equal(profit(report,'Operating profit'),492.5);assert.equal(profit(report,'Net profit / loss'),492.5);assert.equal(profit(report,'Accounting net profit / loss'),300);
  assert.deepEqual(section(report,'Revenue').rows.find(r=>r[1]==='VAT on sales'),['','VAT on sales',192.5]);assert.equal(f.r.export.disabled,false);assert.deepEqual(input,before);
  assert.deepEqual(report.metadata.find(row=>row[0]==='Gross margin'),['Gross margin','49.69%']);assert.ok(section(report,'Profit and loss').rows.every(row=>typeof row[1]==='number'));
 }finally{f.close();}
});

test('switching to accounting basis removes the VAT supplement while real revenue account drilldowns retain their ledger amounts',()=>{
 const f=fixture();try{
  f.draw();const ledger=f.r.buttons.find(b=>b['aria-label']==='View journal entries for Product sales');assert.ok(ledger);ledger.onClick();assert.equal(f.r.opened[0].expectedAmount,1000);assert.deepEqual(f.r.opened[0].accountIds,['sales']);assert.equal(f.r.buttons.some(b=>b['aria-label']==='View journal entries for VAT on sales'),false);
  f.basis().onChange({target:{value:'accounting'}});const html=f.draw(),report=f.r.export.report;
  assert.equal(revenue(report),1000);assert.equal(profit(report,'Gross profit'),400);assert.equal(profit(report,'Net profit / loss'),300);assert.equal(section(report,'Revenue').rows.some(r=>r[1]==='VAT on sales'),false);assert.match(html,/Accounting P&amp;L \(VAT excluded\)/);assert.match(html,/40\.0%/);assert.equal(f.r.export.disabled,false);
 }finally{f.close();}
});

test('an export captures basis and dates before awaiting a fresh ledger and recomputes VAT from that fresh snapshot',async()=>{
 const f=fixture();let complete,captured;
 f.props.refreshStatement=range=>{captured=range;return new Promise(resolve=>{complete=resolve;});};
 try{
  f.draw();const pending=f.r.export.getReport();assert.deepEqual(captured,{fromDate:'2026-11-01',toDate:'2026-11-30'});
  f.basis().onChange({target:{value:'accounting'}});f.props.fromDate='2026-12-01';f.props.toDate='2026-12-31';f.draw();complete(source(2000,1200));
  const report=await pending;assert.deepEqual(report.metadata.slice(0,3),[['From','2026-11-01'],['To','2026-11-30'],['Basis','VAT-inclusive management view']]);assert.equal(revenue(report),2385);assert.equal(profit(report,'Gross profit'),1185);assert.equal(profit(report,'Net profit / loss'),1085);assert.deepEqual(f.r.charges,[{from:'2026-11-01',to:'2026-11-30',summary:'1'}]);
 }finally{f.close();}
});

test('missing VAT evidence displays unavailable results and disables VAT-inclusive export while allowing the accounting view',()=>{
 const input=source();input.postingRules=[];const f=fixture(input);
 try{
  const html=f.draw();assert.match(html,/role="alert"/);assert.match(html,/unmapped liability/);assert.equal(f.r.export.report,undefined);assert.equal(f.r.export.disabled,true);
  f.basis().onChange({target:{value:'accounting'}});f.draw();assert.equal(f.r.export.disabled,false);assert.equal(revenue(f.r.export.report),1000);assert.equal(profit(f.r.export.report,'Net profit / loss'),300);
 }finally{f.close();}
});

test('a refreshed export rejects missing VAT evidence instead of silently reusing the displayed supplement',async()=>{
 const f=fixture();const invalid=source(2000,1200);invalid.postingRules=[];f.props.refreshStatement=async()=>invalid;
 try{f.draw();await assert.rejects(f.r.export.getReport(),/unmapped liability/);}
 finally{f.close();}
});
