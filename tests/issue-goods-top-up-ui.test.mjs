import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
  if(compiled)return compiled;
  const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import IssueGoods from './src/components/distribution/IssueGoods.jsx';export const render=props=>renderToStaticMarkup(React.createElement(IssueGoods,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'issue-top-up-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>/IssueGoods\.jsx$/.test(a.importer)?{path:'issue',namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,p,...children)=>{globalThis.__issueUI.capture(tag,p,children);return React.createElement(tag,p,...children);}};export const useState=v=>globalThis.__issueUI.state('issue',v),useRef=v=>globalThis.__issueUI.ref('issue',v),useEffect=(f,d)=>globalThis.__issueUI.effect('issue',f,d);`,resolveDir:process.cwd()}));
    const mocks={
      '@/lib/i18n':"export const ui=(s,...values)=>s.replace(/\\{(\\d+)\\}/g,(_,i)=>String(values[i]??'')),uiMessage=s=>s;",
      '@/lib/localization':'export const useLocaleRender=()=>{};',
      '@/lib/business-date':"export const businessDate=()=> '2026-11-09';",
      '@/lib/field-ops':'export const invokeFieldOps=async body=>({data:await globalThis.__issueUI.action(body)});',
      '@/lib/sales-stock-refresh':'export const watchSalesStock=refresh=>{const item={refresh,stopped:false};globalThis.__issueUI.watchers.push(item);return()=>{item.stopped=true;};};',
      '@/components/ui/use-toast':'export const useToast=()=>({toast:notice=>globalThis.__issueUI.notifications.push(notice)});',
      '@/components/ui/input':"import React from 'react';export const Input=p=>{globalThis.__issueUI.capture('input',p);return React.createElement('input',p);};",
      '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...p})=>{globalThis.__issueUI.capture('button',p,children);return React.createElement('button',p,children);};",
      '@/components/ui/dialog':"import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogDescription=Dialog,DialogFooter=Dialog;",
      '@/components/shared/ProductCatalog':'export default function Catalog(p){globalThis.__issueUI.catalog=p;return null;}',
      '@/components/shared/ProductThumb':'export default ()=>null;',
    };
    b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);compiled=module.exports.render;return compiled;
}
const current={id:'run-a',dispatch_number:'LOAD-017',salesperson_id:'agent',driver_id:'driver',vehicle_id:'van',warehouse_id:'cold',vehicle_warehouse_id:'held-a',status:'loaded',return_pending:false,returned_to_base:false};
function workspace(active_loads=[]){return {active_loads,staff:[{id:'agent',full_name:'Agent',role:'commercial',status:'active'},{id:'other',full_name:'Other employee',role:'employee',status:'active'},{id:'driver',full_name:'Driver',role:'driver',status:'active'}],vehicles:[{id:'van',name:'Van',is_active:true}],warehouses:[{id:'store',name:'Finished store',warehouse_type:'finished_goods'},{id:'cold',name:'Cold Room',warehouse_type:'cold_room'}],products:[{id:'yogurt',name:'YOLA',inventory_type:'assembly',is_active:true,unit:'ea'}],warehouse_stock:[{warehouse_id:'cold',product_id:'yogurt',quantity:12,qc_status:'approved',expiry_date:'2026-12-01'},{warehouse_id:'store',product_id:'yogurt',quantity:4,qc_status:'approved',expiry_date:'2026-12-01'}]};}
const button=(r,label)=>r.buttons.find(row=>row.label===label),select=(r,label)=>r.controls.find(row=>row.tag==='select'&&row['aria-label']===label);
function choose(f,label,value){select(f.r,label).onChange({target:{value}});return f.draw();}
async function fixture(data=workspace(),initialAgent='agent'){
  const render=await renderer(),r=hookRuntime();r.watchers=[];r.calls=[];r.saved=[];r.latest=data;r.action=async body=>{r.calls.push(structuredClone(body));return body.action==='distributionIssueWorkspace'?r.latest:{dispatch:{id:body.existingDispatchId||'new-load'}};};globalThis.__issueUI=r;
  const props={data,initialAgent,onClose:()=>{},onSaved:value=>r.saved.push(value)},draw=()=>{r.beforeRender();return render(props);},settle=async()=>{for(let i=0;i<3;i++){draw();await r.flush();}return draw();};
  return {r,draw,settle,close(){r.cleanup();delete globalThis.__issueUI;}};
}
function addAndReview(f,quantity=3){f.r.catalog.onQuantityChange(f.r.catalog.products[0],quantity);f.draw();button(f.r,'Continue').onClick();f.draw();button(f.r,'No, sale goods only').onClick();return f.draw();}

test('a fresh manager issue defaults to Cold Room and leaves the existing new-load payload unchanged',async()=>{
  const f=await fixture();try{
    f.draw();assert.equal(button(f.r,'Continue').disabled,true);assert.match(f.draw(),/Checking current stock and employee loads/);
    await f.settle();assert.equal(select(f.r,'Factory / warehouse').value,'cold');assert.equal(select(f.r,'Driver (optional)').value,'');assert.equal(select(f.r,'Vehicle (optional)').value,'');
    addAndReview(f);assert.equal(button(f.r,'Confirm & issue goods').disabled,false);await button(f.r,'Confirm & issue goods').onClick();
    const sent=f.r.calls.filter(row=>row.action==='issueDistributionStock');assert.equal(sent.length,1);assert.deepEqual(sent[0],{action:'issueDistributionStock',commercialId:'agent',driverId:'',vehicleId:'',warehouseId:'cold',notes:'',lines:[{product_id:'yogurt',quantity:3,degustation_quantity:0}],date:'2026-11-09',requestKey:sent[0].requestKey});assert.match(sent[0].requestKey,/^[a-f\d-]{36}$/i);assert.equal(f.r.saved.length,1);
  }finally{f.close();}
});

test('a compatible current load is explicit before review and preserves its holder, warehouse and optional team',async()=>{
  const f=await fixture(workspace([current]));try{
    const html=await f.settle();assert.match(html,/Add these goods to load LOAD-017/);assert.equal(select(f.r,'Factory / warehouse').value,'cold');assert.equal(select(f.r,'Driver (optional)').value,'driver');assert.equal(select(f.r,'Vehicle (optional)').value,'van');
    addAndReview(f);assert.match(f.draw(),/LOAD-017/);assert.equal(button(f.r,'Confirm & add goods').disabled,false);await button(f.r,'Confirm & add goods').onClick();
    const sent=f.r.calls.find(row=>row.action==='issueDistributionStock');assert.equal(sent.existingDispatchId,'run-a');assert.equal(sent.topUpPolicy,'add-to-current-stock-v1');assert.equal(sent.commercialId,'agent');assert.equal(sent.driverId,'driver');assert.equal(sent.vehicleId,'van');assert.equal(sent.warehouseId,'cold');assert.deepEqual(sent.lines,[{product_id:'yogurt',quantity:3,degustation_quantity:0}]);assert.equal(f.r.notifications[0].title,'Finished goods added to current stock');
  }finally{f.close();}
});

test('employee selection adopts the one active load while conflicting, multiple and returning loads block before review',async()=>{
  const cases=[
    [[current,{...current,id:'run-b'}],/More than one current load/],
    [[{...current,return_pending:true}],/pending stock return/],
    [[{...current,returned_to_base:true}],/returned load/],
  ];
  for(const [runs,expected] of cases){
    const f=await fixture(workspace(runs),'');try{await f.settle();const html=choose(f,'Employee receiving goods','agent');assert.match(html,expected);assert.equal(button(f.r,'Continue').disabled,true);button(f.r,'Continue').onClick();assert.match(f.draw(),/Goods for sale/);assert.equal(f.r.calls.filter(row=>row.action==='issueDistributionStock').length,0);}finally{f.close();}
  }
  const f=await fixture(workspace([current]),'');try{
    await f.settle();choose(f,'Employee receiving goods','agent');assert.equal(select(f.r,'Driver (optional)').value,'driver');assert.equal(select(f.r,'Vehicle (optional)').value,'van');
    assert.match(choose(f,'Factory / warehouse','store'),/Keep the warehouse, driver and vehicle/);assert.equal(button(f.r,'Continue').disabled,true);
    choose(f,'Factory / warehouse','cold');choose(f,'Employee receiving goods','other');assert.equal(select(f.r,'Driver (optional)').value,'');assert.equal(select(f.r,'Vehicle (optional)').value,'');assert.match(choose(f,'Vehicle (optional)','van'),/already assigned to another current load/);assert.equal(button(f.r,'Continue').disabled,true);
  }finally{f.close();}
});

test('refresh pending or failure blocks stale quantities and a successful retry preserves the entered load',async()=>{
  const f=await fixture();try{
    await f.settle();addAndReview(f,5);let complete;f.r.action=async body=>{f.r.calls.push(structuredClone(body));if(body.action==='distributionIssueWorkspace')return new Promise(resolve=>{complete=resolve;});return {dispatch:{id:'new'}};};
    const refresh=f.r.watchers.find(row=>!row.stopped).refresh();f.draw();assert.equal(button(f.r,'Confirm & issue goods').disabled,true);complete({...workspace(),warehouse_stock:[{warehouse_id:'cold',product_id:'yogurt',quantity:4,qc_status:'approved'}]});await refresh;f.draw();assert.equal(button(f.r,'Confirm & issue goods').disabled,true);
    f.r.action=async()=>{throw Error('Stock refresh unavailable');};await f.r.watchers.find(row=>!row.stopped).refresh();assert.match(f.draw(),/Stock refresh unavailable/);assert.equal(button(f.r,'Confirm & issue goods').disabled,true);
    f.r.action=async body=>body.action==='distributionIssueWorkspace'?workspace():{dispatch:{id:'new'}};button(f.r,'Retry').onClick();await f.settle();assert.equal(button(f.r,'Confirm & issue goods').disabled,false);button(f.r,'Back').onClick();f.draw();assert.equal(f.r.catalog.lines[0].quantity,5);
  }finally{f.close();}
});

test('an interrupted new issue retries its original payload even when refreshed stock now exposes its created load',async()=>{
  const f=await fixture();try{
    await f.settle();addAndReview(f,5);f.r.action=async body=>{f.r.calls.push(structuredClone(body));if(body.action==='distributionIssueWorkspace')return f.r.latest;f.r.latest=workspace([{...current,driver_id:'',vehicle_id:''}]);throw Error('Response interrupted');};
    await button(f.r,'Confirm & issue goods').onClick();await f.r.watchers.find(row=>!row.stopped).refresh();await f.settle();assert.match(f.draw(),/Response interrupted/);assert.equal(f.r.latest.active_loads[0].id,'run-a');assert.doesNotMatch(f.draw(),/Add these goods to load/);assert.equal(button(f.r,'Retry issue').disabled,false);const original=f.r.calls.find(row=>row.action==='issueDistributionStock');assert.equal(Object.hasOwn(original,'existingDispatchId'),false);
    f.r.action=async body=>{f.r.calls.push(structuredClone(body));return body.action==='distributionIssueWorkspace'?f.r.latest:{dispatch:{id:'run-a'}};};await Promise.all([button(f.r,'Retry issue').onClick(),button(f.r,'Retry issue').onClick()]);
    const requests=f.r.calls.filter(row=>row.action==='issueDistributionStock');assert.equal(requests.length,2);assert.deepEqual(requests[1],requests[0]);assert.equal(f.r.saved.length,1);
  }finally{f.close();}
});
