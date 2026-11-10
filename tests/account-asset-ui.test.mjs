import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url),compiled=new Map();
async function renderer(kind='asset'){
  if(compiled.has(kind))return compiled.get(kind);
  const path={asset:'AccountAssetDialog',editor:'AccountFormDialog',manager:'ChartOfAccountsManager'}[kind];
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Component from './src/components/accounting/${path}.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Component,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'account-asset-ui',setup(b){
    const component=/(AccountAssetDialog|AccountFormDialog|ChartOfAccountsManager)\.jsx$/;
    b.onResolve({filter:/^react$/},a=>component.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;const key=${JSON.stringify(key)};export const useState=v=>globalThis.__accountAssetUI.state(key,v),useRef=v=>globalThis.__accountAssetUI.ref(key,v),useEffect=(f,d)=>globalThis.__accountAssetUI.effect(key,f,d),useMemo=f=>f();export const useCallback=(fn,deps)=>{const slot=globalThis.__accountAssetUI.ref(key,null);if(!slot.current||deps.some((value,i)=>!Object.is(value,slot.current.deps[i])))slot.current={fn,deps};return slot.current.fn;};`,resolveDir:process.cwd()}));
    b.onResolve({filter:/^react\/jsx-runtime$/},a=>component.test(a.importer)?{path:'jsx',namespace:'capture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`import {jsx as x,jsxs as xs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,p,key)=>{if(typeof tag==='string')globalThis.__accountAssetUI.capture(tag,p,p?.children);return x(tag,p,key);};export const jsxs=(tag,p,key)=>{if(typeof tag==='string')globalThis.__accountAssetUI.capture(tag,p,p?.children);return xs(tag,p,key);};`,resolveDir:process.cwd()}));
    const mocks={
      '@/lib/localization':'export const useLocaleRender=()=>{};',
      '@/lib/assets':"export {monthlyDepreciation} from './src/lib/asset-schedule.js';export const assetAction=body=>globalThis.__accountAssetUI.action(body);",
      '@/api/erpClient':'export const erp={functions:{invoke:async(name,body)=>({data:await globalThis.__accountAssetUI.action(body)})},accounting:{saveAccount:body=>globalThis.__accountAssetUI.save(body)}};',
      '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({isAdmin:true,isCashier:false});',
      '@/lib/router':"import React from 'react';export const useNavigate=()=>()=>{};export const Link=({to,children,replaceOverlay,...p})=>React.createElement('a',{href:to,...p},children);",
      '@/components/ui/use-toast':'export const useToast=()=>({toast:value=>globalThis.__accountAssetUI.notifications.push(value)});',
      '@/components/ui/input':"import React from 'react';export const Input=p=>{globalThis.__accountAssetUI.capture('input',p);return React.createElement('input',p);};",
      '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...p})=>{globalThis.__accountAssetUI.capture('button',p,children);return React.createElement('button',p,children);};",
      '@/components/ui/switch':'export const Switch=()=>null;',
      '@/components/ui/select':"import React from 'react';const Box=({children})=>React.createElement('div',null,children);export const Select=Box,SelectContent=Box,SelectItem=Box,SelectTrigger=Box,SelectValue=()=>null;",
      '@/components/ui/dialog':"import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children),DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogFooter=Dialog;",
      '@/components/assets/AssetPlanDialog':"import React from 'react';export default props=>{globalThis.__accountAssetUI.plan=props;return React.createElement('p',null,'Specific asset plan: '+props.asset.name);};",
      './AccountOpeningFields':'export default ()=>null;export const useAccountOpening=()=>({}),accountOpeningPayload=()=>undefined;',
      './RecurringExpenseSettings':'export default ()=>null;export const initialRecurringSettings=()=>({});',
      '@/components/accounting/AccountStats':'export default ()=>null;',
      './AccountPosition':'export default ()=>null;',
      '@/components/accounting/AccountTree':"import React from 'react';export default props=>{globalThis.__accountAssetUI.tree=props;return React.createElement('p',null,props.sections.flatMap(section=>section.roots).map(a=>a.name).join(', '));};",
    };
    if(kind==='editor')mocks['./AccountAssetDialog']="import React from 'react';export default props=>{globalThis.__accountAssetUI.dialog=props;return React.createElement('p',null,'Asset account: '+props.account.id);};";
    if(kind==='manager')mocks['@/components/accounting/AccountFormDialog']="export default props=>{globalThis.__accountAssetUI.form=props;return null;};";
    b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);compiled.set(kind,module.exports.render);return module.exports.render;
}
const account={id:'equipment',account_number:'2141',name:'Freezers',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true};
const accounts=[account,{id:'contra',account_number:'2814',name:'Accumulated depreciation',account_type:'asset',normal_balance:'credit',is_active:true,is_posting:true},{id:'expense',account_number:'6810',name:'Depreciation expense',account_type:'expense',normal_balance:'debit',is_active:true,is_posting:true}];
const workspace=()=>({account,accounts,assets:[],ledger_cost:1200,registered_cost:0,unassigned_cost:1200,eligible:true,blocked_reasons:[],token:'verified-ledger-snapshot'});
const control=(r,id)=>r.controls.find(c=>c.id===id||c['aria-label']===id),button=(r,label)=>r.buttons.find(b=>b.label===label);
function change(r,id,value){control(r,id).onChange({target:{value,checked:value}});}
async function env(kind,props={},data=workspace()){
  const render=await renderer(kind),r=hookRuntime();r.calls=[];r.action=async body=>{r.calls.push(body);return data;};r.save=async()=>({});globalThis.__accountAssetUI=r;
  const draw=()=>{r.beforeRender();return render(props);};draw();await r.flush();draw();return {r,draw,close:()=>{r.cleanup();delete globalThis.__accountAssetUI;}};
}
function fill(r,draw){
  button(r,'Set a schedule for recorded cost').onClick();draw();
  for(const [id,value] of [['account-asset-name','Freezer A'],['account-asset-cost','1200'],['account-asset-acquired','2026-09-01'],['account-asset-start','2026-09-01'],['account-asset-residual','0'],['account-asset-months','60'],['account-asset-accum','contra'],['account-asset-expense','expense'],['account-asset-reference','Posted invoice #1']])change(r,id,value);
  draw();change(r,'Confirm already-recorded asset cost',true);draw();
}

test('linking existing capitalized cost previews straight-line expense and retries one checked request without a purchase journal',async()=>{
  let changed=0;const f=await env('asset',{account,onClose(){},onChanged(){changed++;}}),{r,draw}=f;
  try{
    assert.equal(control(r,'account-asset-start'),undefined);fill(r,draw);assert.match(draw(),/20 XAF/);assert.match(draw(),/60 months/);assert.doesNotMatch(draw(),/Paid From|Payable \(optional\)/);
    const requests=[];let fail=true;r.action=async body=>{if(body.action==='assetAccountWorkspace')return workspace();requests.push(body);if(fail)throw Error('Connection interrupted');return {asset:{id:'new-asset'}};};
    await button(r,'Save depreciation schedule').onClick();assert.match(draw(),/Connection interrupted/);assert.equal(control(r,'account-asset-cost').value,'1200');assert.equal(control(r,'Confirm already-recorded asset cost').checked,true);
    fail=false;const submit=button(r,'Save depreciation schedule');await Promise.all([submit.onClick(),submit.onClick()]);assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal(changed,1);
    assert.equal(requests[1].action,'assetLinkAccount');assert.equal(requests[1].accountId,'equipment');assert.equal(requests[1].workspaceToken,'verified-ledger-snapshot');assert.equal(requests[1].confirmExistingCost,true);assert.equal(requests[1].data.useful_life_months,60);assert.equal(requests[1].data.acquisition_cost,1200);assert.equal(requests[1].data.automatic_depreciation_enabled,false);assert.equal(requests[1].fundingAccountId,undefined);assert.equal(requests[1].data.funding_account_id,undefined);
  }finally{f.close();}
});

test('multiple assets require selecting a specific schedule and historical zero-cost records cannot be revised',async()=>{
  const data=workspace();data.assets=[{id:'a',name:'Freezer A',asset_number:'FA-1',asset_account_id:account.id,acquisition_cost:500,status:'active',useful_life_months:60,depreciation_method:'straight_line',acquisition_date:'2026-01-01'},{id:'b',name:'Freezer B',asset_number:'FA-2',asset_account_id:account.id,acquisition_cost:700,status:'active',useful_life_months:24,depreciation_method:'straight_line',acquisition_date:'2026-01-01'},{id:'old',name:'Imported zero record',acquisition_cost:0,status:'fully_depreciated'}];data.registered_cost=1200;data.unassigned_cost=0;
  const f=await env('asset',{account,onClose(){}},data),{r,draw}=f;
  try{assert.equal(r.buttons.filter(b=>b.label==='Edit schedule').length,2);assert.equal(button(r,'Set a schedule for recorded cost'),undefined);assert.match(draw(),/This record has no capitalized cost/);r.buttons.filter(b=>b.label==='Edit schedule')[1].onClick();assert.match(draw(),/Specific asset plan: Freezer B/);assert.equal(r.plan.asset.id,'b');assert.equal(r.plan.accounts.length,3);r.plan.onClose();assert.match(draw(),/Freezer A/);assert.equal(r.calls.length,1);}
  finally{f.close();}
});

test('ledger restrictions block linking; failed loads retry and edits reset financial confirmation',async()=>{
  const blocked={...workspace(),eligible:false,blocked_reasons:['Review the existing depreciation ledger.']};const f=await env('asset',{account,onClose(){}},blocked),{r,draw}=f;
  try{assert.match(draw(),/Review the existing depreciation ledger/);assert.equal(button(r,'Set a schedule for recorded cost'),undefined);r.action=async()=>{throw Error('Ledger unavailable');};await button(r,'Refresh').onClick();assert.match(draw(),/Ledger unavailable/);r.action=async()=>workspace();await button(r,'Refresh').onClick();draw();fill(r,draw);change(r,'account-asset-months','48');draw();assert.equal(control(r,'Confirm already-recorded asset cost').checked,false);assert.equal(button(r,'Save depreciation schedule').disabled,true);change(r,'account-asset-cost','1500');draw();change(r,'Confirm already-recorded asset cost',true);draw();await button(r,'Save depreciation schedule').onClick();assert.match(draw(),/exceeds the unassigned recorded cost/);}
  finally{f.close();}
});

test('account editing opens asset settings without losing account changes',async()=>{
  const f=await env('editor',{account,accounts,canManageAssets:true,balances:{equipment:{entries:1,debit:1200}},onClose(){},onDone(){}}),{r,draw}=f;
  try{change(r,'account-name','Renamed equipment');draw();button(r,'Manage asset depreciation').onClick();assert.match(draw(),/Asset account: equipment/);assert.equal(r.dialog.account.id,'equipment');r.dialog.onClose();draw();assert.equal(control(r,'account-name').value,'Renamed equipment');}
  finally{f.close();}
});

test('account editors without asset authority cannot open depreciation settings',async()=>{
  for(const canManageAssets of [undefined,false]){
    const f=await env('editor',{account,accounts,canManageAssets,balances:{equipment:{entries:1,debit:1200}},onClose(){},onDone(){}}),{r,draw}=f;
    try{assert.equal(button(r,'Manage asset depreciation'),undefined);assert.doesNotMatch(draw(),/Fixed-asset depreciation/);assert.equal(r.dialog,undefined);assert.equal(r.calls.length,0);assert.ok(button(r,'Save Changes'));}
    finally{f.close();}
  }
});

test('account list hides never-used zero rows but its toggle and editing selectors retain every account',async()=>{
  const unused={id:'unused',account_number:'9990',name:'Unused account',account_type:'expense',normal_balance:'debit',is_active:true},used={id:'used',account_number:'9991',name:'Settled account',account_type:'expense',normal_balance:'debit',is_active:true};
  const data={accounts:[unused,used],balances:{used:{debit:100,credit:100,entries:2}},date:'2026-11-06'};
  const f=await env('manager',{},data),{r,draw}=f;
  try{assert.doesNotMatch(draw(),/Unused account/);assert.match(draw(),/Settled account/);const toggle=r.controls.find(c=>c.type==='checkbox');assert.equal(toggle.checked,false);toggle.onChange({target:{checked:true}});assert.match(draw(),/Unused account/);r.tree.onEdit(used);draw();assert.equal(r.form.accounts.length,2);assert.ok(r.form.accounts.some(a=>a.id==='unused'));assert.equal(r.form.canManageAssets,true);}
  finally{f.close();}
});

test('existing-cost review exposes journal provenance and leaves dates, cost, life and automatic posting for explicit review',async()=>{
  const data=workspace();data.cost_sources=[{id:'fixture-opening',journal_number:'JV-FIXTURE',entry_date:'2025-01-01',description:'Fictional capitalized equipment opening',net_cost:1200}];
  const f=await env('asset',{account,onClose(){}},data),{r,draw}=f;
  try{assert.match(draw(),/Journal sources for this recorded cost/);assert.match(draw(),/href="\/accounting\/journals\/fixture-opening"/);button(r,'Set a schedule for recorded cost').onClick();draw();for(const id of ['account-asset-cost','account-asset-acquired','account-asset-start','account-asset-months'])assert.equal(control(r,id).value,'');assert.equal(r.controls.filter(c=>c.type==='checkbox')[0].checked,false);assert.equal(control(r,'Confirm already-recorded asset cost').checked,false);assert.equal(r.calls.length,1);}
  finally{f.close();}
});
