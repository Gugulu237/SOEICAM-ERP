import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {buildCashFlow} from '../src/lib/cash-flow.js';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
 if(compiled)return compiled;
 const out=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Statements from './src/views/FinancialStatements.jsx';import Cash from './src/components/accounting/CashFlowStatement.jsx';export const render=kind=>renderToStaticMarkup(React.createElement(kind==='cash'?Cash:Statements));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'statement-account-ui',setup(b){
 const owned=/(FinancialStatements|IncomeStatement|CashFlowStatement|StatementAccountDrilldown|StatementSection|MobileIncomeStatementBody|AccountPosition)\.jsx$/;
 b.onResolve({filter:/^react$/},a=>owned.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
 b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;const key=${JSON.stringify(key)};export const useState=v=>globalThis.__statementAccountUI.state(key,v),useRef=v=>globalThis.__statementAccountUI.ref(key,v),useEffect=(f,d)=>globalThis.__statementAccountUI.effect(key,f,d);export const useMemo=(f,d)=>{const slot=useRef();if(!slot.current||d.some((v,i)=>!Object.is(v,slot.current.deps[i])))slot.current={value:f(),deps:d};return slot.current.value;};export const useCallback=(f,d)=>useMemo(()=>f,d);`,resolveDir:process.cwd()}));
 b.onResolve({filter:/^react\/jsx-runtime$/},a=>owned.test(a.importer)?{path:'jsx',namespace:'capture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`import {jsx as x,jsxs as xs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};const capture=(tag,p)=>{if(typeof tag==='string')globalThis.__statementAccountUI.capture(tag,p,p?.children);if(p?.detail||p?.error&&p?.onClose)globalThis.__statementAccountUI.drilldown=p;};export const jsx=(tag,p,k)=>{capture(tag,p);return x(tag,p,k);};export const jsxs=(tag,p,k)=>{capture(tag,p);return xs(tag,p,k);};`,resolveDir:process.cwd()}));
 const mocks={
  '@/hooks/usePhoneLayout':'export const usePhoneLayout=()=>globalThis.__statementAccountUI.phone;',
  '@/hooks/useCurrentUser':"export const useCurrentUser=()=>({isAdmin:true,principalRole:'admin'});",
  '@/lib/business-date':"export const businessDate=()=> '2026-10-31';",
  '@/lib/localization':'export const useLocaleRender=()=>null;',
  '@/api/erpClient':"export const invalidateERPReads=()=>{};export const erp={entities:{Account:'accounts',JournalEntry:'journals',JournalLine:'lines'},functions:{invoke:async(_name,body)=>{const r=globalThis.__statementAccountUI;r.requests.push(body);return {data:r.cashReport(body)};}}};",
  '@/lib/field-pos':"export const readAll=async entity=>{const r=globalThis.__statementAccountUI;r.reads.push(entity);if(r.denied)throw Error('Accounting access denied');return r[entity];};",
  '@/lib/asset-depreciation-client':"export const syncAssetDepreciation=async()=>{globalThis.__statementAccountUI.syncs++;return {pending_count:0,pending_total:0,issues:[]};};",
  '@/lib/recurring-expense-client':"export const recurringExpenseRequest=async()=>({pending_total:0,pending_count:0});",
  '@/lib/router':"import React from 'react';export const useNavigate=()=>()=>{};export const useSearchParams=()=>[new URLSearchParams(globalThis.__statementAccountUI.params),()=>{}];export const Link=({to,children,replaceOverlay,...p})=>{if(to.startsWith('/accounting/journals/'))globalThis.__statementAccountUI.overlayLinks.push(replaceOverlay);return React.createElement('a',{href:to,...p},children);};",
  '@/components/assets/DepreciationStatus':'export default ()=>null;',
  '@/components/shared/PageHeader':"import React from 'react';export default ({title})=>React.createElement('h1',null,title);",
  '@/components/shared/ReportExport':"export default ()=>null;",
  '@/components/ui/dialog':"import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children),DialogContent=({children,...p})=>React.createElement('div',p,children),DialogHeader=Dialog,DialogTitle=({children})=>React.createElement('h2',null,children),DialogDescription=({children})=>React.createElement('p',null,children);",
  '@/components/ui/input':"import React from 'react';export const Input=p=>{globalThis.__statementAccountUI.capture('input',p);return React.createElement('input',p);};",
  '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...p})=>{globalThis.__statementAccountUI.capture('button',p,children);return React.createElement('button',p,children);};",
  './IncomeStatementSources':'export default ()=>null;',
 };
 b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mocks'}:undefined);b.onLoad({filter:/.*/,namespace:'mocks'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);compiled=mod.exports.render;return compiled;
}
function runtime(){
 const r=hookRuntime(),baseCapture=r.capture.bind(r);r.elements=[];r.capture=(tag,p,children)=>{baseCapture(tag,p,children);r.elements.push({tag,props:p||{},children});};
 Object.assign(r,{phone:false,params:'tab=pnl',overlayLinks:[],reads:[],requests:[],syncs:0,accounts:[{id:'cash',account_number:'1000',name:'Cash',account_type:'asset',normal_balance:'debit',is_treasury:true,balance:1040},{id:'equity',account_number:'3000',name:'Capital',account_type:'equity',normal_balance:'credit'},{id:'fuel',account_number:'6260',name:'Vehicle fuel',account_type:'expense',normal_balance:'debit'},{id:'child',parent_id:'fuel',account_number:'6261',name:'Fuel child',account_type:'expense',normal_balance:'debit'},{id:'sales',account_number:'7010',name:'Sales',account_type:'revenue',normal_balance:'credit'}],journals:[],lines:[]});
 const add=(id,date,debit,credit,amount,extra={})=>{r.journals.push({id,entry_date:date,journal_number:'JV-'+id,status:'posted',description:'Actual '+id,total_debit:amount,total_credit:amount,private_notes:'SECRET',...extra});r.lines.push({journal_id:id,account_id:debit,debit:amount,credit:0},{journal_id:id,account_id:credit,debit:0,credit:amount});};
 add('opening','2026-09-01','cash','equity',1000,{source_module:'opening_balances'});add('old-fuel','2026-09-05','fuel','cash',20);add('fuel','2026-10-03','fuel','cash',100);add('child','2026-10-04','child','cash',40);add('sales','2026-10-06','cash','sales',200);
 r.cashReport=body=>buildCashFlow({accounts:r.accounts,journals:r.journals,cashLines:r.lines.filter(l=>l.account_id==='cash'),periodLines:r.lines,from:body.from,to:body.to});return r;
}
const accountButton=(r,name)=>r.elements.find(e=>e.tag==='button'&&e.props['aria-label']==='View journal entries for '+name)?.props;
const paint=(r,render,kind)=>{r.beforeRender();r.elements=[];return render(kind);};
const dateInputs=r=>r.controls.filter(p=>p.type==='date');

for(const phone of [false,true])test(`P&L ${phone?'mobile':'desktop'} account tap/double-click opens the same posted period snapshot without further reads`,async()=>{
 const render=await renderer(),r=runtime(),previousWindow=globalThis.window;globalThis.__statementAccountUI=r;globalThis.window={addEventListener(){},removeEventListener(){}};r.phone=phone;
 try{paint(r,render);await r.flush();paint(r,render);await r.flush();paint(r,render);const dates=dateInputs(r);dates[0].onChange({target:{value:'2026-10-01'}});dates[1].onChange({target:{value:'2026-10-31'}});paint(r,render);await r.flush();paint(r,render);
 const button=accountButton(r,'Vehicle fuel');assert.ok(button);assert.equal(button.type,'button');assert.equal(button['aria-haspopup'],'dialog');assert.equal(typeof button.onDoubleClick,'function');const reads=r.reads.length,syncs=r.syncs;button.onClick();let html=paint(r,render);assert.equal(r.drilldown.detail.periodTotal,phone?-100:100);assert.deepEqual(r.drilldown.detail.rows.map(row=>row.journalId),['fuel']);assert.match(html,/href="\/accounting\/journals\/fuel"/);assert.ok(r.overlayLinks.length&&r.overlayLinks.every(Boolean));assert.doesNotMatch(html,/SECRET/);assert.equal(r.reads.length,reads);assert.equal(r.syncs,syncs);assert.equal(r.requests.length,0);
 r.drilldown.onClose();paint(r,render);accountButton(r,'Vehicle fuel').onDoubleClick();paint(r,render);assert.equal(r.drilldown.detail.periodTotal,phone?-100:100);assert.equal(r.reads.length,reads);assert.equal(r.syncs,syncs);
 }finally{r.cleanup();globalThis.window=previousWindow;delete globalThis.__statementAccountUI;}
});

test('Balance Sheet account and cumulative earnings details show opening history and correct closing balance',async()=>{
 const render=await renderer(),r=runtime(),previousWindow=globalThis.window;globalThis.__statementAccountUI=r;globalThis.window={addEventListener(){},removeEventListener(){}};r.params='tab=balance';
 try{paint(r,render);await r.flush();paint(r,render);dateInputs(r)[0].onChange({target:{value:'2026-10-01'}});paint(r,render);const reads=r.reads.length;accountButton(r,'Cash').onDoubleClick();let html=paint(r,render);assert.equal(r.drilldown.detail.openingBalance,980);assert.equal(r.drilldown.detail.closingBalance,1040);assert.match(html,/Opening before period/);assert.doesNotMatch(html,/href="\/accounting\/journals\/opening"/);
 r.controls.find(p=>p.type==='checkbox').onChange({target:{checked:true}});html=paint(r,render);assert.match(html,/href="\/accounting\/journals\/opening"/);assert.equal(r.reads.length,reads);r.drilldown.onClose();paint(r,render);accountButton(r,'Current earnings / unclosed profit').onClick();paint(r,render);assert.equal(r.drilldown.detail.closingBalance,40);assert.equal(r.drilldown.detail.openingBalance,-20);assert.equal(r.reads.length,reads);
 }finally{r.cleanup();globalThis.window=previousWindow;delete globalThis.__statementAccountUI;}
});

test('Cash Flow drill-down uses applied report dates even after unapplied date edits and needs no new request',async()=>{
 const render=await renderer(),r=runtime();globalThis.__statementAccountUI=r;
 try{paint(r,render,'cash');await r.flush();paint(r,render,'cash');r.controls.find(p=>p.id==='cashflow-from').onChange({target:{value:'2026-10-01'}});paint(r,render,'cash');await r.elements.find(e=>e.tag==='form').props.onSubmit({preventDefault(){}});await r.flush();paint(r,render,'cash');r.controls.find(p=>p.id==='cashflow-from').onChange({target:{value:'2026-10-15'}});paint(r,render,'cash');const calls=r.requests.length;accountButton(r,'Vehicle fuel').onClick();paint(r,render,'cash');assert.equal(r.drilldown.detail.fromDate,'2026-10-01');assert.equal(r.drilldown.detail.toDate,'2026-10-31');assert.equal(r.drilldown.detail.periodTotal,-100);assert.deepEqual(r.drilldown.detail.rows.map(row=>row.journalId),['fuel']);assert.equal(r.requests.length,calls);
 }finally{r.cleanup();delete globalThis.__statementAccountUI;}
});

test('a denied statement reader exposes no account drill-down controls or journal payload',async()=>{
 const render=await renderer(),r=runtime(),previousWindow=globalThis.window;globalThis.__statementAccountUI=r;globalThis.window={addEventListener(){},removeEventListener(){}};r.denied=true;
 try{paint(r,render);await r.flush();const html=paint(r,render);assert.match(html,/Accounting access denied/);assert.equal(accountButton(r,'Vehicle fuel'),undefined);assert.doesNotMatch(html,/JV-fuel|SECRET|href="\/accounting\/journals/);assert.equal(r.requests.length,0);
 }finally{r.cleanup();globalThis.window=previousWindow;delete globalThis.__statementAccountUI;}
});

test('statement account rows and journal detail display exact fractional XAF rather than independently rounded totals',async()=>{
 const render=await renderer(),r=runtime(),previousWindow=globalThis.window;globalThis.__statementAccountUI=r;globalThis.window={addEventListener(){},removeEventListener(){}};
 const fuel=r.journals.find(j=>j.id==='fuel');fuel.total_debit=100.25;fuel.total_credit=100.25;r.lines.filter(l=>l.journal_id==='fuel').forEach(l=>{if(l.debit)l.debit=100.25;if(l.credit)l.credit=100.25;});
 try{paint(r,render);await r.flush();paint(r,render);dateInputs(r)[0].onChange({target:{value:'2026-10-01'}});let html=paint(r,render);assert.match(html,/100\.25 XAF/);accountButton(r,'Vehicle fuel').onClick();html=paint(r,render);assert.equal(r.drilldown.detail.periodTotal,100.25);assert.match(html,/100\.25 XAF/);assert.equal(r.drilldown.detail.rows[0].effect,100.25);
 }finally{r.cleanup();globalThis.window=previousWindow;delete globalThis.__statementAccountUI;}
});
