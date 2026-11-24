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
 return {r,props,draw,close:()=>{r.cleanup();delete globalThis.__incomeBasisUI;}};
}

const noTaxPresentation=(html,report)=>{
 assert.doesNotMatch(html,/VAT|TVA|Revenue basis|Accounting revenue|Accounting net profit|Result including/i);
 assert.doesNotMatch(JSON.stringify(report??{}),/VAT|TVA|Accounting revenue|Accounting net profit|Sales including/i);
};

for(const phone of [false,true])test(`the ${phone?'phone':'desktop'} P&L presents clean sales, profit and margin without changing the approved totals`,()=>{
 const input=source(),before=structuredClone(input),f=fixture(input,phone);
 try{
  const html=f.draw(),report=f.r.export.report;
  assert.match(html,/Total Sales Revenue/);assert.match(html,/Gross Profit/);assert.match(html,/Net profit \/ loss/);assert.match(html,/49\.7%/);assert.equal(f.r.controls.some(control=>control.tag==='select'),false);noTaxPresentation(html,report);
  assert.equal(report.title,'Profit and loss');assert.equal(revenue(report),1192.5);assert.equal(profit(report,'Gross profit'),592.5);assert.equal(profit(report,'Operating profit'),492.5);assert.equal(profit(report,'Net profit / loss'),492.5);
  assert.deepEqual(section(report,'Revenue').rows,[['','Total Sales Revenue',1192.5]]);assert.deepEqual(section(report,'Revenue').totals,[['','Total Sales Revenue',1192.5]]);assert.equal(section(report,'Revenue').rows.reduce((sum,row)=>sum+row[2],0),revenue(report));assert.equal(f.r.export.disabled,false);assert.deepEqual(input,before);
  assert.deepEqual(section(report,'Profit and loss').rows.map(row=>row[0]),['Gross profit','Operating profit','Net profit / loss']);assert.deepEqual(report.metadata.find(row=>row[0]==='Basis'),['Basis','Recorded sales and expenses']);
  assert.deepEqual(report.metadata.find(row=>row[0]==='Gross margin'),['Gross margin','49.69%']);assert.ok(section(report,'Profit and loss').rows.every(row=>typeof row[1]==='number'));
 }finally{f.close();}
});

test('the fixed sales presentation keeps real revenue account drilldowns in separate collapsed ledger details',()=>{
 for(const phone of [false,true]){
  const f=fixture(source(),phone);try{
   const html=f.draw();assert.match(html,/<details\b(?![^>]*\bopen(?:=|\s|>))[^>]*>\s*<summary[^>]*>Ledger account details<\/summary>/);assert.equal(f.r.controls.some(control=>control.tag==='select'),false);
   const ledger=f.r.buttons.find(button=>button['aria-label']==='View journal entries for Product sales');assert.ok(ledger);ledger.onClick();assert.equal(f.r.opened[0].expectedAmount,1000);assert.deepEqual(f.r.opened[0].accountIds,['sales']);
   assert.equal(f.r.buttons.some(button=>button['aria-label']==='View journal entries for Total Sales Revenue'),false);assert.equal(revenue(f.r.export.report),1192.5);assert.equal(profit(f.r.export.report,'Net profit / loss'),492.5);noTaxPresentation(html,f.r.export.report);
  }finally{f.close();}
 }
});

test('an export captures dates before awaiting a fresh ledger and recomputes the approved sales totals from that snapshot',async()=>{
 const f=fixture();let complete,captured;
 f.props.refreshStatement=range=>{captured=range;return new Promise(resolve=>{complete=resolve;});};
 try{
  f.draw();const pending=f.r.export.getReport();assert.deepEqual(captured,{fromDate:'2026-11-01',toDate:'2026-11-30'});
  f.props.fromDate='2026-12-01';f.props.toDate='2026-12-31';f.draw();complete(source(2000,1200));
  const report=await pending;assert.deepEqual(report.metadata.slice(0,3),[['From','2026-11-01'],['To','2026-11-30'],['Basis','Recorded sales and expenses']]);assert.equal(revenue(report),2385);assert.equal(profit(report,'Gross profit'),1185);assert.equal(profit(report,'Net profit / loss'),1085);assert.deepEqual(f.r.charges,[{from:'2026-11-01',to:'2026-11-30',summary:'1'}]);noTaxPresentation('',report);
 }finally{f.close();}
});

test('missing sales evidence displays unavailable results and blocks export without exposing tax details or fake zero totals',()=>{
 const input=source();input.postingRules=[];const f=fixture(input);
 try{
  const html=f.draw(),text=html.replace(/<[^>]*>/g,'');assert.match(html,/role="alert"/);assert.match(html,/Sales totals are unavailable\. Refresh the report before exporting\./);assert.equal(f.r.export.report,undefined);assert.equal(f.r.export.disabled,true);assert.equal(f.r.controls.some(control=>control.tag==='select'),false);noTaxPresentation(html,undefined);
  assert.match(text,/Total Sales Revenue\s*[-−–—]/);assert.match(text,/Gross Profit\s*[-−–—]/);assert.match(text,/Net profit \/ loss\s*[-−–—]/);assert.doesNotMatch(html,/NaN|unmapped liability/);
 }finally{f.close();}
});

test('a refreshed export rejects unavailable sales evidence instead of silently reusing the displayed totals',async()=>{
 const f=fixture();const invalid=source(2000,1200);invalid.postingRules=[];f.props.refreshStatement=async()=>invalid;
 try{f.draw();await assert.rejects(f.r.export.getReport(),/^Error: Sales totals are unavailable\. Refresh the report before exporting\.$/);}
 finally{f.close();}
});
