import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
  if(compiled)return compiled;
  const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Ledger from './src/views/GeneralLedger.jsx';import Trial from './src/views/TrialBalance.jsx';export const render=kind=>renderToStaticMarkup(React.createElement(kind==='ledger'?Ledger:Trial));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'ledger-report-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>/(GeneralLedger|TrialBalance)\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;const key=${JSON.stringify(key)};export const useState=v=>globalThis.__ledgerUI.state(key,v),useEffect=(f,d)=>globalThis.__ledgerUI.effect(key,f,d),useMemo=f=>f();`,resolveDir:process.cwd()}));
    const mocks={
      '@/lib/localization':'export const useLocaleRender=()=>{};',
      '@/lib/business-date':"export const businessDate=()=> '2026-11-15';",
      '@/lib/field-pos':'export const readAll=(...args)=>globalThis.__ledgerUI.read(...args);',
      '@/api/erpClient':'export const erp={entities:{Account:"accounts",JournalEntry:"journals",JournalLine:"lines"}};',
      '@/lib/router':'export const useNavigate=()=>()=>{};',
      '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({role:"admin"});',
      '@/components/shared/PageHeader':"import React from 'react';export default p=>React.createElement('header',null,p.actions);",
      '@/components/shared/ReportExport':'export default p=>{globalThis.__ledgerUI.exportProps=p;return null;};',
      '@/components/ui/input':"import React from 'react';export const Input=p=>{globalThis.__ledgerUI.capture('input',p);return React.createElement('input',p);};",
      '@/components/ui/button':"import React from 'react';export const Button=({children,onClick,variant,...p})=>React.createElement('button',p,children);",
      '@/components/ui/select':"import React from 'react';export const Select=p=>{globalThis.__ledgerUI.select=p;return React.createElement('div',null,p.children);};const Box=({children})=>React.createElement('div',null,children);export const SelectContent=Box,SelectItem=Box,SelectTrigger=Box,SelectValue=()=>null;",
    };
    b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);compiled=module.exports.render;return compiled;
}
const fixtures=()=>({
  accounts:[{id:'ap',account_number:'4010',name:'Supplier payable',account_type:'liability',normal_balance:'credit'},{id:'cost',account_number:'6100',name:'Operating expense',account_type:'expense',normal_balance:'debit'}],
  journals:[{id:'original',status:'reversed',entry_date:'2026-10-01',journal_number:'J-1',total_debit:300,total_credit:300},{id:'reversal',status:'posted',entry_date:'2026-11-01',journal_number:'J-2',reversal_of:'original',total_debit:300,total_credit:300}],
  lines:[{id:'a',journal_id:'original',account_id:'ap',credit:300,status:'reversed'},{id:'b',journal_id:'original',account_id:'cost',debit:300,status:'reversed'},{id:'c',journal_id:'reversal',account_id:'ap',debit:300,status:'posted'},{id:'d',journal_id:'reversal',account_id:'cost',credit:300,status:'posted'}],
});
function runtime(data){
  const r=hookRuntime();r.queries=[];r.read=async(name,query)=>{r.queries.push([name,query]);return data[name].filter(row=>!query.status||(query.status.$in||[query.status]).includes(row.status));};return r;
}
for(const kind of ['ledger','trial'])test(`${kind} loads dated reversal history, exports identical totals, and blocks invalid-date exports`,async()=>{
  const render=await renderer(),r=runtime(fixtures());globalThis.__ledgerUI=r;
  const draw=()=>{r.beforeRender();return render(kind);};
  try{
    draw();await r.flush();draw();assert.deepEqual(r.queries.find(([name])=>name==='journals')[1].status,{$in:['posted','reversed']});
    const dates=()=>r.controls.filter(c=>c.type==='date');assert.equal(dates()[0].value,'2026-01-01');assert.equal(dates()[1].value,'2026-11-15');
    if(kind==='ledger'){r.select.onValueChange('ap');draw();}
    dates()[0].onChange({target:{value:'2026-11-01'}});draw();
    assert.equal(r.exportProps.disabled,false);
    const doc=r.exportProps.report,rows=doc.sections[0].rows;
    if(kind==='ledger'){assert.equal(rows[0].at(-1),300);assert.equal(rows[1][1],'J-2');assert.equal(doc.sections[0].totals[0].at(-1),0);}
    else {assert.deepEqual(rows.find(row=>row[0]==='4010').slice(2),[0,300,300,0,0,0]);}
    dates()[0].onChange({target:{value:'2026-02-30'}});const invalid=draw();assert.match(invalid,/valid date range/);assert.equal(r.exportProps.disabled,true);assert.doesNotMatch(invalid,/Total debits equal total credits/);
  }finally{r.cleanup();delete globalThis.__ledgerUI;}
});

test('a paginated-load mismatch cannot be displayed or exported as a balanced trial balance',async()=>{
  const data=fixtures();data.lines=data.lines.filter(l=>l.id!=='a');const render=await renderer(),r=runtime(data);globalThis.__ledgerUI=r;
  try{r.beforeRender();render('trial');await r.flush();r.beforeRender();const html=render('trial');assert.match(html,/incomplete or does not balance/);assert.doesNotMatch(html,/Total debits equal total credits/);assert.equal(r.exportProps.disabled,true);}
  finally{r.cleanup();delete globalThis.__ledgerUI;}
});
