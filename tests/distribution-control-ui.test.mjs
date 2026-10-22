import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
async function ui(){
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Distribution from './src/views/Distribution.jsx';import Sidebar from './src/components/layout/AppSidebar.jsx';import DeliveriesBoard from './src/components/distribution/DeliveriesBoard.jsx';import {IssueGoods} from './src/components/distribution/DistributionStockControl.jsx';import {modulesForRole} from './src/lib/appModules.js';export const modules=modulesForRole('warehouse_manager');export const render=(name,props)=>renderToStaticMarkup(React.createElement({distribution:Distribution,sidebar:Sidebar,deliveries:DeliveriesBoard,issue:IssueGoods}[name],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'distribution-ui',setup(b){
    b.onResolve({filter:/^react$/},args=>args.importer.endsWith('DistributionStockControl.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__distributionUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__distributionUI.state('form',v);export const useRef=v=>globalThis.__distributionUI.ref('form',v);export const useEffect=React.useEffect,useCallback=React.useCallback;`,resolveDir:process.cwd()}));
    const mocks={
      'next/dynamic':`import React from 'react';export default loader=>()=>React.createElement('div',null,loader.toString().includes('EmployeeDashboard')?'Mounted Driver delivery workspace':'Mounted Commercial stock control');`,
      '@/views/EmployeeDashboard':`export default function DriverWorkspace(){return null;}`,
      '@/hooks/useCurrentUser':`export const useCurrentUser=()=>globalThis.__distributionUI.session||({role:'warehouse_manager',user:{id:'manager'}});`,
      '@/lib/AuthContext':`export const useAuth=()=>({logout:()=>{}});`,
      '@/lib/router':`import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{href:to,...props},children);export const Navigate=({to})=>React.createElement('span',{'data-redirect':to});export const useLocation=()=>({pathname:'/distribution'});export const useNavigate=()=>()=>{};export const useSearchParams=()=>[new URLSearchParams(globalThis.__distributionUI.query||''),()=>{}];`,
      '@/lib/field-ops':`export const errorMessage=e=>e.message;export const invokeFieldOps=body=>globalThis.__distributionUI.invoke(body);export const receiptUrl=async uri=>uri,uploadReceipt=async()=>{throw Error('No upload expected in this test');};`,
      '@/components/ui/use-toast':`export const useToast=()=>({toast:v=>globalThis.__distributionUI.notifications.push(v)});`,
      '@/components/shared/ProductCatalog':`export default props=>{globalThis.__distributionUI.catalog=props;return null;};`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogFooter=Dialog,DialogDescription=Dialog;`,
      '@/components/ui/button':`import React from 'react';export function Button({children,...props}){globalThis.__distributionUI.capture('button',props,children);return React.createElement('button',props,children);}`,
      '@/components/ui/input':`import React from 'react';export function Input(props){globalThis.__distributionUI.inputs.push(props);return React.createElement('input',props);}`,
    };
    b.onResolve({filter:/^(?:@\/|next\/dynamic$)/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]});const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);return mod.exports;
}
function runtime(){const r=hookRuntime(),capture=r.capture.bind(r),before=r.beforeRender.bind(r);r.inputs=[];r.selects=[];r.capture=(tag,props,children)=>{capture(tag,props,children);if(tag==='select')r.selects.push(props);};r.beforeRender=()=>{before();r.inputs=[];r.selects=[];};return r;}
test('Distribution opens stock control for managers and the menu has one Distribution entry without separate Custody',async()=>{
  const {render,modules}=await ui(),r=runtime();globalThis.__distributionUI=r;
  try{r.beforeRender();const html=render('distribution');assert.match(html,/Mounted Commercial stock control/);assert.match(html,/Warehouse issues &amp; field stock/);assert.match(html,/counted returns/);assert.match(html,/Expired exchanges/);const sidebar=render('sidebar');assert.ok(sidebar.includes('href="/distribution"'));assert.equal(sidebar.includes('href="/custody"'),false);assert.equal(modules.filter(m=>['/distribution','/custody'].includes(m.path)).length,1);}finally{r.cleanup();delete globalThis.__distributionUI;}
});
test('drivers enter their own Deliveries within Distribution without mounting management data',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;r.session={role:'driver',employee:{id:'driver-a'}};
  try{
    r.query='tab=deliveries';r.beforeRender();const html=render('distribution');assert.match(html,/Mounted Driver delivery workspace/);assert.doesNotMatch(html,/Commercial stock control|Fleet|New Dispatch/);
    const sidebar=render('sidebar');assert.match(sidebar,/href="\/distribution"/);assert.doesNotMatch(sidebar,/href="\/driver"/);
    r.query='tab=vehicles';r.beforeRender();assert.match(render('distribution'),/data-redirect="\/distribution\?tab=deliveries"/);
  }finally{r.cleanup();delete globalThis.__distributionUI;}
});

test('old request bookmarks reopen warehouse-controlled issuance without a redundant request queue',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;
  try{r.query='tab=field-requests';r.beforeRender();const html=render('distribution');assert.doesNotMatch(html,/Driver &amp; Agent requests|Mounted field stock requests/);assert.match(html,/Mounted Commercial stock control/);}finally{r.cleanup();delete globalThis.__distributionUI;}
});
test('management Deliveries shows active paired runs and opens their dispatch detail',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;
  try{const html=render('deliveries',{dispatches:[{id:'run-a',dispatch_number:'DSP-1',dispatch_date:'2026-10-18',status:'in_transit',route_name:'North',driver_name:'Driver A',salesperson_name:'Agent A',vehicle_name:'Van A'}]});assert.match(html,/Delivery runs/);assert.match(html,/Driver A/);assert.match(html,/Agent A/);assert.match(html,/On the road/);assert.match(html,/Open delivery and reports/);}finally{r.cleanup();delete globalThis.__distributionUI;}
});
test('the photo load form retains its paired team, goods and retry key after an interrupted save',async()=>{
  const {render}=await ui(),r=runtime(),calls=[];let fail=true,saved=0;
  r.invoke=async body=>{calls.push(body);if(fail)throw Error('Connection interrupted');return {data:{dispatch:{id:'run',salesperson_id:'agent'}}};};globalThis.__distributionUI=r;
  const props={initialAgent:'agent',data:{products:[{id:'product',name:'YOLA',inventory_type:'assembly',is_active:true,unit:'ea'}],staff:[{id:'agent',full_name:'Agent',role:'commercial',status:'active'},{id:'driver',full_name:'Driver',role:'driver',status:'active'}],vehicles:[{id:'vehicle',name:'Van',is_active:true}],warehouses:[{id:'factory',name:'Factory'}],warehouse_stock:[{warehouse_id:'factory',product_id:'product',quantity:10,qc_status:'approved',expiry_date:'2099-01-01'}]},onClose:()=>{},onSaved:()=>saved++};
  try{r.beforeRender();render('issue',props);r.selects[1].onChange({target:{value:'driver'}});r.beforeRender();render('issue',props);r.selects[2].onChange({target:{value:'vehicle'}});r.beforeRender();render('issue',props);r.selects[3].onChange({target:{value:'factory'}});r.beforeRender();render('issue',props);assert.equal(r.catalog.hidePrice,true);r.catalog.onSelect(r.catalog.products[0]);r.beforeRender();render('issue',props);const button=r.buttons.find(b=>b.label==='Confirm & issue to vehicle');assert.equal(button.disabled,false);await button.onClick();assert.equal(saved,0);r.beforeRender();const html=render('issue',props);assert.match(html,/Connection interrupted/);fail=false;await r.buttons.find(b=>b.label==='Confirm & issue to vehicle').onClick();assert.equal(saved,1);assert.equal(calls[0].requestKey,calls[1].requestKey);assert.equal(calls[1].commercialId,'agent');assert.equal(calls[1].driverId,'driver');assert.equal(calls[1].vehicleId,'vehicle');assert.equal(calls[1].lines[0].product_id,'product');assert.equal(calls[1].action,'issueDistributionStock');}finally{r.cleanup();delete globalThis.__distributionUI;}
});
