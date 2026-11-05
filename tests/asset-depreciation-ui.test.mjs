import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);let compiled;
async function renderer(){
  if(compiled)return compiled;
  const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Plan from './src/components/assets/AssetPlanDialog.jsx';import Statements from './src/views/FinancialStatements.jsx';import Status from './src/components/assets/DepreciationStatus.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement({plan:Plan,statements:Statements,status:Status}[kind],props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'asset-ui',setup(b){
    const components=/(AssetPlanDialog|DepreciationRateFields|FinancialStatements)\.jsx$/;
    b.onResolve({filter:/^react$/},a=>components.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:'import React from '+JSON.stringify(require.resolve('react'))+';export default React;const key='+JSON.stringify(key)+';export const useState=v=>globalThis.__assetUI.state(key,v),useRef=v=>globalThis.__assetUI.ref(key,v),useEffect=(f,d)=>globalThis.__assetUI.effect(key,f,d),useMemo=f=>f();',resolveDir:process.cwd()}));
    b.onResolve({filter:/^react\/jsx-runtime$/},a=>components.test(a.importer)?{path:'jsx',namespace:'capture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:'import {jsx as x,jsxs as xs,Fragment} from '+JSON.stringify(require.resolve('react/jsx-runtime'))+';export {Fragment};export const jsx=(tag,p,key)=>{if(typeof tag==="string")globalThis.__assetUI.capture(tag,p,p?.children);return x(tag,p,key);};export const jsxs=(tag,p,key)=>{if(typeof tag==="string")globalThis.__assetUI.capture(tag,p,p?.children);return xs(tag,p,key);};',resolveDir:process.cwd()}));
    const mocks={
      '@/lib/assets':"export const assetAction=b=>globalThis.__assetUI.request(b);",
      '@/lib/localization':'export const useLocaleRender=()=>{};',
      '@/lib/asset-depreciation-client':'export const syncAssetDepreciation=()=>globalThis.__assetUI.sync();',
      '@/api/erpClient':'export const erp={entities:{Account:"accounts",JournalEntry:"journals",JournalLine:"lines"}};',
      '@/lib/field-pos':'export const readAll=entity=>globalThis.__assetUI.read(entity);',
      '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({isAdmin:true});',
      '@/lib/router':"import React from 'react';export const useNavigate=()=>()=>{},useSearchParams=()=>[new URLSearchParams(),()=>{}];export const Link=({to,children,...p})=>React.createElement('a',{href:to,...p},children);",
      '@/components/ui/input':"import React from 'react';export const Input=p=>{globalThis.__assetUI.capture('input',p);return React.createElement('input',p);};",
      '@/components/ui/button':"import React from 'react';export const Button=({children,variant,...p})=>{globalThis.__assetUI.capture('button',p,children);return React.createElement('button',p,children);};",
      '@/components/ui/dialog':"import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children),DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogFooter=Dialog;",
      '@/components/ui/tabs':"import React from 'react';export const Tabs=({children})=>React.createElement('div',null,children),TabsList=Tabs,TabsContent=Tabs,TabsTrigger=Tabs;",
      './AssetDialog':'export const AccountSelect=()=>null;',
      '@/components/shared/PageHeader':'export default ()=>null;',
      '@/components/accounting/IncomeStatement':"import React from 'react';export default p=>{globalThis.__assetUI.statement=p;return React.createElement('p',null,'Loaded income statement');};",
      '@/components/accounting/BalanceSheet':'export default ()=>null;',
      '@/components/accounting/CashFlowStatement':'export default ()=>null;'
    };
    b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});const m={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);compiled=m.exports.render;return compiled;
}
const asset={id:'machine',name:'Machine',acquisition_date:'2020-01-01',in_service_date:'2020-01-01',acquisition_cost:1000,salvage_value:100,useful_life_months:60,depreciation_method:'straight_line',status:'active',accumulated_depreciation:0,asset_revision:1};
const field=(r,id)=>r.controls.find(c=>c.id===id);
const button=(r,label)=>r.buttons.find(b=>b.label===label);
const checkbox=(r,index)=>r.controls.filter(c=>c.type==='checkbox')[index];

test('enabling automatic posting shows overdue total and preserves the existing schedule',async()=>{
  const render=await renderer(),r=hookRuntime(),calls=[];globalThis.__assetUI=r;let release,done=0;r.request=b=>{calls.push(b);return new Promise(resolve=>{release=resolve;});};
  const draw=()=>{r.beforeRender();return render('plan',{asset,accounts:[],onClose(){},onDone(){done++;}});};
  try{draw();assert.equal(checkbox(r,0).checked,false);assert.equal(checkbox(r,1).checked,false);checkbox(r,0).onChange({target:{checked:true}});assert.match(draw(),/60 unposted months/);const first=button(r,'Save schedule').onClick();await button(r,'Save schedule').onClick();assert.equal(calls.length,1);assert.equal(calls[0].changeSchedule,false);assert.equal(calls[0].automaticDepreciationEnabled,true);release({});await first;assert.equal(done,1);}finally{r.cleanup();delete globalThis.__assetUI;}
});

test('changing to an annual percentage previews the flat monthly charge and retains values on a failed save',async()=>{
  const render=await renderer(),r=hookRuntime(),calls=[];globalThis.__assetUI=r;r.request=async b=>{calls.push(b);throw Error('Connection interrupted');};
  const draw=()=>{r.beforeRender();return render('plan',{asset,accounts:[],onClose(){},onDone(){}});};
  try{draw();checkbox(r,1).onChange({target:{checked:true}});draw();field(r,'depreciation-rate-mode').onChange({target:{value:'rate'}});draw();field(r,'asset-annual-rate').onChange({target:{value:'20'}});assert.match(draw(),/15 XAF/);await button(r,'Save schedule').onClick();assert.match(draw(),/Connection interrupted/);assert.equal(field(r,'asset-annual-rate').value,'20');assert.equal(calls[0].rateMode,'rate');assert.equal(calls[0].annualRate,'20');assert.equal(calls[0].changeSchedule,true);}finally{r.cleanup();delete globalThis.__assetUI;}
});

test('financial statements wait for depreciation posting before reading journal balances and fail visibly',async()=>{
  const render=await renderer(),r=hookRuntime(),calls=[];globalThis.__assetUI=r;const previousWindow=globalThis.window;globalThis.window={addEventListener(){},removeEventListener(){}};
  let release;r.sync=()=>{calls.push('sync');return new Promise(resolve=>{release=resolve;});};r.read=async name=>{calls.push(name);return [];};
  const draw=()=>{r.beforeRender();return render('statements',{});};
  try{draw();await r.flush();assert.deepEqual(calls,['sync']);assert.match(draw(),/Loading statements/);release({through:'2020-01',pending_count:0,pending_total:0,issues:[]});await r.flush();draw();assert.deepEqual(calls,['sync','accounts','journals','lines']);assert.equal(r.statement.depreciation.through,'2020-01');r.sync=async()=>{throw Error('Depreciation check unavailable');};button(r,'Refresh').onClick();draw();await r.flush();const failed=draw();assert.match(failed,/Depreciation check unavailable/);assert.doesNotMatch(failed,/Loaded income statement/);}finally{r.cleanup();globalThis.window=previousWindow;delete globalThis.__assetUI;}
});

test('unposted depreciation and locked-period failures are visible to report readers',async()=>{
  const render=await renderer(),r=hookRuntime();globalThis.__assetUI=r;
  try{r.beforeRender();const html=render('status',{status:{through:'2020-02',pending_count:1,pending_total:300,manual_count:0,issues:[{asset_id:'machine',asset_name:'Machine',message:'Accounting period February is locked'}]},canManage:false});assert.match(html,/not yet deducted from profit/);assert.match(html,/February is locked/);assert.doesNotMatch(html,/href=/);}finally{r.cleanup();delete globalThis.__assetUI;}
});
