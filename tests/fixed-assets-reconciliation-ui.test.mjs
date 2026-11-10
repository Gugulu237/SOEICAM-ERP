import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);let compiled;
async function renderer(){
 if(compiled)return compiled;
 const out=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Assets from './src/views/FixedAssets.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Assets));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'asset-register-ui',setup(b){
 const owned=/(FixedAssets|MobileFixedAssets|MobileAssetCard|AssetRegisterReconciliation)\.jsx$/;
 b.onResolve({filter:/^react$/},a=>owned.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
 b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;const key=${JSON.stringify(key)};export const useState=v=>globalThis.__assetRegisterUI.state(key,v),useEffect=(f,d)=>globalThis.__assetRegisterUI.effect(key,f,d),useMemo=f=>f(),useRef=v=>globalThis.__assetRegisterUI.ref(key,v);export const useCallback=(f,d)=>{const slot=useRef();if(!slot.current||d.some((v,i)=>!Object.is(v,slot.current.deps[i])))slot.current={value:f,deps:d};return slot.current.value;};`,resolveDir:process.cwd()}));
 b.onResolve({filter:/^react\/jsx-runtime$/},a=>owned.test(a.importer)?{path:'jsx',namespace:'capture'}:undefined);b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`import {jsx as x,jsxs as xs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,p,k)=>{if(typeof tag==='string')globalThis.__assetRegisterUI.capture(tag,p,p?.children);return x(tag,p,k);};export const jsxs=(tag,p,k)=>{if(typeof tag==='string')globalThis.__assetRegisterUI.capture(tag,p,p?.children);return xs(tag,p,k);};`,resolveDir:process.cwd()}));
 const mocks={
 '@/lib/assets':"export {monthlyDepreciation} from './src/lib/asset-schedule.js';export const assetAction=body=>globalThis.__assetRegisterUI.action(body);",
 '@/lib/asset-depreciation-client':"export const syncAssetDepreciation=async()=>{const r=globalThis.__assetRegisterUI;r.syncCalls++;if(r.syncFails)throw Error('Saved schedule check unavailable');return {};};",
 '@/hooks/useCurrentUser':"export const useCurrentUser=()=>({isAdmin:true,isCashier:false,allowedModules:['accounting']});",
 '@/hooks/usePhoneLayout':'export const usePhoneLayout=()=>globalThis.__assetRegisterUI.phone;',
 '@/lib/localization':'export const useLocaleRender=()=>null;',
 '@/lib/router':"import React from 'react';export const useNavigate=()=>path=>globalThis.__assetRegisterUI.navigation.push(path);export const Link=({to,children,replaceOverlay,...p})=>React.createElement('a',{href:to,...p},children);",
 '@/components/shared/PageHeader':"import React from 'react';export default ({title,actions})=>React.createElement('header',null,React.createElement('h1',null,title),actions);",
 '@/components/shared/KPICard':"import React from 'react';export default ({title,value})=>React.createElement('p',null,title+': '+value);",
 '@/components/shared/DataTable':"import React from 'react';export default ({data=[],columns=[]})=>React.createElement('div',null,data.map(row=>React.createElement('article',{key:row.id},columns.map(col=>React.createElement('span',{key:col.key},col.render?col.render(row[col.key],row):String(row[col.key]||''))))));",
 '@/components/assets/DepreciationStatus':'export default ()=>null;',
 '@/components/accounting/AccountAssetDialog':"import React from 'react';export default p=>{globalThis.__assetRegisterUI.review=p;return React.createElement('p',null,'Existing-cost review '+p.account.id);};",
 '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...p})=>{globalThis.__assetRegisterUI.capture('button',p,children);return React.createElement('button',p,children);};",
 };
 for(const name of ['AssetDialog','AssetPlanDialog','AssetFundingDialog','DepreciationRunDialog','DisposeAssetDialog'])mocks['@/components/assets/'+name]='export default ()=>null;';
 b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mocks'}:undefined);b.onLoad({filter:/.*/,namespace:'mocks'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);compiled=mod.exports.render;return compiled;
}
function runtime(phone){
 const r=hookRuntime();Object.assign(r,{phone,syncCalls:0,syncFails:false,calls:[],data:{assets:[{id:'legacy',name:'Historical fixture equipment',status:'fully_depreciated',asset_account_id:'old',acquisition_cost:0,accumulated_depreciation:0,net_book_value:0}],entries:[],accounts:[],treasuryAccounts:[],transfers:[],depreciationStatus:{pending_count:0,issues:[]},reconciliation:{date:'2026-11-10',gross_ledger_cost:1500,accumulated_ledger_depreciation:0,ledger_net_book_value:1500,awaiting_registration_cost:1500,incomplete_assets:['legacy'],rows:[{account:{id:'plant',account_number:'2210',name:'Fixture capitalized equipment'},kind:'gross_cost',ledger_balance:1500,registered_value:0,unassigned_value:1500,issues:[],can_review_registration:true,cost_sources:[{id:'opening',journal_number:'JV-OPEN',entry_date:'2025-01-01',description:'Reviewed fixture opening',net_cost:1500}]}]}}});r.action=async body=>{r.calls.push(body);if(r.loadFails)throw Error('Asset register reader denied');return r.data;};return r;
}
const button=(r,label)=>r.buttons.find(b=>b.label===label||b['aria-label']===label);
function paint(r,render){r.beforeRender();return render();}

test('mobile shows the actual zero-cost record and separates GL balances from fabricated register assets',async()=>{
 const render=await renderer(),r=runtime(true);globalThis.__assetRegisterUI=r;
 try{paint(r,render);await r.flush();let html=paint(r,render);assert.match(html,/Historical fixture equipment/);assert.match(html,/Setup incomplete/);assert.match(html,/Registered asset records/);assert.match(html,/Asset balances awaiting registration/);assert.equal((html.match(/data-sleek-asset-card/g)||[]).length,1);assert.equal(r.syncCalls,0);assert.deepEqual(r.calls,[{action:'assetWorkspace'}]);
 button(r,'Register and account balances').onClick();html=paint(r,render);assert.match(html,/Fixture capitalized equipment/);assert.match(html,/href="\/accounting\/journals\/opening"/);assert.equal((html.match(/data-sleek-asset-card/g)||[]).length,0);assert.equal(r.data.assets.length,1);button(r,'Review existing cost').onClick();html=paint(r,render);assert.match(html,/Existing-cost review plant/);assert.equal(r.review.account.id,'plant');assert.equal(r.calls.length,1);assert.equal(r.syncCalls,0);
 }finally{r.cleanup();delete globalThis.__assetRegisterUI;}
});

test('register opening and refresh are reads; a failed explicit depreciation check does not hide saved assets',async()=>{
 const render=await renderer(),r=runtime(false);globalThis.__assetRegisterUI=r;
 try{paint(r,render);await r.flush();let html=paint(r,render);assert.match(html,/Historical fixture equipment/);assert.equal(r.syncCalls,0);r.syncFails=true;const check=button(r,'Check saved depreciation');await Promise.all([check.onClick(),check.onClick()]);html=paint(r,render);assert.match(html,/Saved schedule check unavailable/);assert.match(html,/Historical fixture equipment/);assert.equal(r.syncCalls,1);assert.equal(r.calls.length,1);await button(r,'Refresh').onClick();html=paint(r,render);assert.match(html,/Historical fixture equipment/);assert.equal(r.syncCalls,1);assert.deepEqual(r.calls,[{action:'assetWorkspace'},{action:'assetWorkspace'}]);
 }finally{r.cleanup();delete globalThis.__assetRegisterUI;}
});

test('failed register reads show an explicit recoverable error instead of an empty register claim',async()=>{
 const render=await renderer(),r=runtime(true);globalThis.__assetRegisterUI=r;r.loadFails=true;
 try{paint(r,render);await r.flush();let html=paint(r,render);assert.match(html,/Asset register reader denied/);assert.doesNotMatch(html,/No assets match|Total Cost/);assert.ok(button(r,'Retry loading the asset register'));r.loadFails=false;await button(r,'Retry loading the asset register').onClick();html=paint(r,render);assert.match(html,/Historical fixture equipment/);assert.equal(r.syncCalls,0);
 }finally{r.cleanup();delete globalThis.__assetRegisterUI;}
});
