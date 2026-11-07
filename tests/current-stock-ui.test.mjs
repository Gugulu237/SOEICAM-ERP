import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;

async function renderer(){
  if(compiled)return compiled;
  const result=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Overview from './src/components/field/MyStockOverview.jsx';import Full from './src/views/EmployeeStock.jsx';export {currentStockRows} from './src/components/field/IssuedStockRows.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement(kind==='full'?Full:Overview,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'current-stock-ui',setup(b){
    const owned=/(?:MyStockOverview|IssuedStockRows|EmployeeStock)\.jsx$|useMyStock\.js$/;
    b.onResolve({filter:/^react$/},a=>owned.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;const key=${JSON.stringify(a.path)};export const useState=v=>globalThis.__currentStockUI.state(key,v),useRef=v=>globalThis.__currentStockUI.ref(key,v),useEffect=(f,d)=>globalThis.__currentStockUI.effect(key,f,d),useMemo=f=>f();export const useCallback=(fn,deps)=>{const slot=globalThis.__currentStockUI.ref(key,null);if(!slot.current||deps.some((v,i)=>!Object.is(v,slot.current.deps[i])))slot.current={fn,deps};return slot.current.fn;};`,resolveDir:process.cwd()}));
    b.onResolve({filter:/^react\/jsx-runtime$/},a=>owned.test(a.importer)?{path:'jsx',namespace:'capture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`import {jsx as x,jsxs as xs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,p,key)=>{if(typeof tag==='string')globalThis.__currentStockUI.capture(tag,p,p?.children);return x(tag,p,key);};export const jsxs=(tag,p,key)=>{if(typeof tag==='string')globalThis.__currentStockUI.capture(tag,p,p?.children);return xs(tag,p,key);};`,resolveDir:process.cwd()}));
    const mocks={
      '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__currentStockUI.session;',
      '@/lib/localization':'export const useLocaleRender=()=>{};',
      '@/lib/field-ops':'export const invokeFieldOps=async body=>({data:await globalThis.__currentStockUI.action(body)});',
      '@/lib/sales-stock-refresh':'export const watchSalesStock=fn=>{const entry={refresh:fn,stopped:false};globalThis.__currentStockUI.watchers.push(entry);return()=>{entry.stopped=true;};};',
      '@/lib/router':"import React from 'react';export const useNavigate=()=>path=>globalThis.__currentStockUI.navigation.push(path);export const Link=({to,children,...p})=>React.createElement('a',{...p,href:to},children);",
      '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...p})=>{globalThis.__currentStockUI.capture('button',p,children);return React.createElement('button',p,children);};",
      '@/components/ui/input':"import React from 'react';export const Input=p=>{globalThis.__currentStockUI.capture('input',p);return React.createElement('input',p);};",
      '@/components/shared/PageHeader':"import React from 'react';export default ({title,subtitle,actions})=>React.createElement('header',null,React.createElement('h1',null,title),React.createElement('p',null,subtitle),actions);",
      '@/components/shared/ProductThumb':"import React from 'react';export default ({product})=>React.createElement('span',{'data-product':product?.id});",
      '@/components/shared/DataTable':"import React from 'react';export default ({data,emptyMessage})=>React.createElement('div',null,data?.length?'History rows':emptyMessage);",
      '@/components/distribution/DegustationForm':"import React from 'react';export default ()=>React.createElement('div',null,'Giveaway form');",
      '@/components/distribution/DegustationHistory':"import React from 'react';export default ()=>React.createElement('div',null,'Giveaway history');",
    };
    b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);compiled=module.exports;return compiled;
}

const product={id:'yogurt',name:'Vanilla yogurt',sku:'YOG-01',inventory_type:'finished_product',unit:'bottles',unit_of_measure:'bottles',is_active:true};
const run={id:'load-personal',dispatch_number:'LOAD-OLDER',dispatch_date:'2026-10-28',status:'loaded',vehicle_id:'',vehicle_name:'',driver_name:'',salesperson_id:'holder',salesperson_name:'Holder',stock_warehouse_id:'personal',stock_warehouse_name:'Goods held by Holder',pending_return:false,is_holder:true,is_paired_driver:false,can_supply:true,stock_error:'',rows:[]};
const snapshot={employee:{id:'holder',full_name:'Holder'},employeeName:'Holder',date:'2026-11-07',updated_at:'2026-11-07T08:00:00Z',runs:[run],products:[product],balances:[{id:'batch-one',product_id:'yogurt',warehouse_id:'personal',warehouse_name:'Goods held by Holder',dispatch_id:run.id,stock_kind:'issued',quantity:12,usable_quantity:7,degustation_quantity:3,held_quantity:2,lot_number:'BATCH-ONE',expiry_date:'2026-11-20',qc_status:'approved'}],legacy:[],sales:[],degustations:[]};
const button=(r,label)=>r.buttons.find(item=>item.label===label||item['aria-label']===label);
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
async function fixture({kind='overview',data=snapshot,role='employee',loading=false,action}={}){
  const render=await renderer(),r=hookRuntime();r.session={user:{id:'login-holder'},employee:{id:'holder',role,status:'active'},role,principalRole:role,loading,error:''};r.calls=[];r.watchers=[];r.action=async body=>{r.calls.push(body);return action?action(body):structuredClone(data);};globalThis.__currentStockUI=r;
  const draw=props=>{r.beforeRender();return render.render(kind,props);},settle=async()=>{await r.flush();return draw();};
  return {r,draw,settle,rows:render.currentStockRows,close(){r.cleanup();delete globalThis.__currentStockUI;}};
}

test('the stock overview loads only the signed-in actor and displays real quantities before opening the full stock page',async()=>{
  const f=await fixture({loading:true}),{r,draw,settle}=f;
  try{
    assert.equal(draw(),'');await r.flush();assert.deepEqual(r.calls,[]);
    r.session.loading=false;assert.match(draw(),/Loading assigned inventory/);const html=await settle();
    assert.deepEqual(r.calls,[{action:'employeeStockSnapshot'}]);assert.equal(r.watchers.length,1);
    assert.match(text(html),/Vanilla yogurt On hand 12 bottles/);assert.match(text(html),/For sale: 7/);assert.match(text(html),/Dégustation: 3/);assert.match(text(html),/Held \/ expired: 2/);
    assert.match(html,/href="\/my-stock"/);assert.match(html,/href="\/my-stock\/returns"/);assert.match(html,/Last stock update/);assert.doesNotMatch(html,/No goods currently assigned/);
  }finally{f.close();assert.ok(r.watchers.every(w=>w.stopped));}
});

test('automatic refresh failure retains the last confirmed quantities and manual retry replaces them',async()=>{
  const f=await fixture(),{r,draw,settle}=f;
  try{
    draw();await settle();r.action=async body=>{r.calls.push(body);throw Error('Connection interrupted');};await r.watchers[0].refresh();
    let html=draw();assert.match(html,/Stock refresh failed/);assert.match(html,/last confirmed quantities/);assert.match(text(html),/On hand 12 bottles/);assert.doesNotMatch(html,/No goods currently assigned/);
    r.action=async body=>{r.calls.push(body);return {...snapshot,balances:[{...snapshot.balances[0],quantity:8,usable_quantity:5,degustation_quantity:1,held_quantity:2}]};};button(r,'Retry').onClick();draw();html=await settle();
    assert.equal(r.watchers[0].stopped,true);assert.match(text(html),/On hand 8 bottles/);assert.doesNotMatch(html,/Connection interrupted|Stock refresh failed/);assert.deepEqual(r.calls,Array.from({length:3},()=>({action:'employeeStockSnapshot'})));
  }finally{f.close();}
});

test('failed first load never appears as zero stock, and changing the authenticated employee hides previous evidence',async()=>{
  const f=await fixture({action:async()=>{throw Error('Stock temporarily unavailable');}}),{r,draw,settle}=f;
  try{
    draw();let html=await settle();assert.match(html,/Could not load your current stock/);assert.doesNotMatch(html,/No goods currently assigned|Vanilla yogurt/);
    r.action=async()=>structuredClone(snapshot);button(r,'Retry').onClick();draw();html=await settle();assert.match(html,/Vanilla yogurt/);
    let release;r.action=()=>new Promise(resolve=>{release=resolve;});r.session={...r.session,user:{id:'login-other'},employee:{id:'other',role:'employee',status:'active'}};
    html=draw();assert.doesNotMatch(html,/Vanilla yogurt|On hand 12|Stock temporarily unavailable/);await r.flush();release({...snapshot,employee:{id:'other'},employeeName:'Other',runs:[],balances:[],products:[]});await r.flush();html=draw();assert.match(html,/No goods currently assigned/);assert.doesNotMatch(html,/Vanilla yogurt/);
    r.session.employee={...r.session.employee,role:'hotesse'};assert.equal(draw(),'');await r.flush();assert.ok(r.watchers.every(w=>w.stopped));
  }finally{f.close();}
});

test('pending returns stay visible and collected or legacy stock remains separate from finished goods for sale',async()=>{
  const data={...snapshot,runs:[{...run,pending_return:true,can_supply:false}],products:[product,{id:'cups',name:'Recovered cups',unit_of_measure:'units'}],balances:[...snapshot.balances,{...snapshot.balances[0],id:'batch-two',quantity:4,usable_quantity:4,degustation_quantity:0,held_quantity:0,lot_number:'BATCH-TWO'},{id:'returned-yogurt',product_id:'yogurt',dispatch_id:run.id,quantity:2,usable_quantity:0,degustation_quantity:0,held_quantity:2,stock_kind:'customer_return'},{id:'cup-lot',product_id:'cups',quantity:6,usable_quantity:0,degustation_quantity:0,held_quantity:6,stock_kind:'legacy'},{id:'empty',product_id:'yogurt',quantity:0,stock_kind:'issued'}]};
  const f=await fixture({data}),{draw,settle}=f;
  try{
    draw();const html=await settle(),rows=f.rows(data),issued=rows.find(row=>row.product.id==='yogurt'&&row.kind==='issued'),collected=rows.find(row=>row.kind==='customer_return');
    assert.deepEqual([issued.quantity,issued.sale,issued.giveaway,issued.held],[16,11,3,2]);assert.deepEqual([collected.quantity,collected.sale],[2,0]);assert.equal(rows.length,3);
    assert.match(html,/Awaiting warehouse receipt/);assert.match(html,/still in your possession/);assert.match(html,/Collected returns \/ recovered packaging/);assert.match(html,/Stock awaiting reconciliation/);assert.match(html,/Recovered cups/);assert.match(text(html),/On hand 16 bottles/);assert.match(text(html),/On hand 2 bottles/);assert.match(text(html),/On hand 6 units/);
  }finally{f.close();}
});

test('the full stock page shows unpaired custody and searches the complete product list by name or SKU',async()=>{
  const extras=Array.from({length:5},(_,i)=>({...product,id:'extra-'+i,name:'Fruit yogurt '+i,sku:'FRUIT-'+i}));
  const data={...snapshot,products:[product,...extras],balances:[...snapshot.balances,...extras.map((p,i)=>({...snapshot.balances[0],id:'lot-'+p.id,product_id:p.id,quantity:i+1,usable_quantity:i+1,degustation_quantity:0,held_quantity:0,lot_number:'FRUIT-LOT-'+i}))]};
  const f=await fixture({kind:'full',data}),{r,draw,settle}=f;
  try{
    draw();let html=await settle();assert.deepEqual(r.calls,[{action:'employeeStockWorkspace'}]);assert.match(html,/Employee-held goods/);assert.match(html,/LOAD-OLDER/);assert.match(html,/2026-10-28/);assert.match(html,/Vanilla yogurt/);assert.match(html,/Fruit yogurt 4/);assert.match(html,/BATCH-ONE/);assert.match(html,/FRUIT-LOT-4/);
    assert.equal(button(r,'Record sale').disabled,false);assert.equal(button(r,'Record Dégustation').disabled,false);
    r.controls.find(c=>c['aria-label']==='Search my stock').onChange({target:{value:' fruit-4 '}});html=draw();assert.match(html,/Fruit yogurt 4/);assert.match(text(html),/On hand 5 bottles/);assert.doesNotMatch(html,/Vanilla yogurt|Fruit yogurt 0|FRUIT-LOT-0/);
    r.controls.find(c=>c['aria-label']==='Search my stock').onChange({target:{value:'missing product'}});html=draw();assert.match(html,/No products match this view/);assert.doesNotMatch(html,/No goods currently assigned/);
    r.controls.find(c=>c['aria-label']==='Search my stock').onChange({target:{value:'vanilla'}});html=draw({embedded:true});assert.match(html,/Vanilla yogurt/);assert.doesNotMatch(html,/<h1/);
    button(r,'Return goods').onClick();assert.equal(r.navigation.at(-1),'/my-stock/returns');button(r,'Record sale').onClick();assert.equal(r.navigation.at(-1),'/my-stock/new');
  }finally{f.close();}
});

test('paired drivers see the goods and returns action while sale, giveaway and seller history controls are absent',async()=>{
  const data={...snapshot,runs:[{...run,vehicle_name:'Delivery van',driver_name:'Driver',is_holder:false,is_paired_driver:true,can_supply:true}],sales:[{id:'sale-should-not-render'}]};
  const f=await fixture({kind:'full',role:'driver',data}),{r,draw,settle}=f;
  try{
    // A module grant may expose a feature role, but it cannot turn a driver into
    // the Commercial who owns the paired run's sale authority.
    r.session.role='admin';draw();const html=await settle();assert.match(html,/Delivery van/);assert.match(text(html),/On hand 12 bottles/);assert.ok(button(r,'Return goods'));
    assert.equal(button(r,'Record sale'),undefined);assert.equal(button(r,'Record Dégustation'),undefined);assert.doesNotMatch(html,/My sales this month|Giveaway history|History rows/);
    button(r,'Return goods').onClick();assert.equal(r.navigation.at(-1),'/my-stock/returns');assert.deepEqual(r.calls,[{action:'employeeStockWorkspace'}]);
  }finally{f.close();}
});

test('pending return quantities remain visible and refresh errors disable stock-spending actions without showing an empty load',async()=>{
  const f=await fixture({kind:'full',data:{...snapshot,runs:[{...run,pending_return:true,can_supply:false}]}}),{r,draw,settle}=f;
  try{
    draw();let html=await settle();assert.match(html,/Awaiting warehouse receipt/);assert.match(text(html),/On hand 12 bottles/);assert.equal(button(r,'Record sale').disabled,true);assert.equal(button(r,'Record Dégustation').disabled,true);assert.ok(button(r,'Return goods'));
    r.action=async()=>{throw Error('Latest stock check failed');};await r.watchers[0].refresh();html=draw();assert.match(html,/Latest stock check failed/);assert.match(html,/last confirmed quantities/);assert.match(text(html),/On hand 12 bottles/);assert.doesNotMatch(html,/No goods currently assigned/);assert.equal(button(r,'Record sale').disabled,true);assert.equal(button(r,'Record Dégustation').disabled,true);
  }finally{f.close();}
});

test('unverifiable assigned or legacy stock reports its error without claiming that the employee holds no goods',async()=>{
  for(const kind of ['overview','full'])for(const legacy of [false,true]){
    const data={...snapshot,balances:[],products:[],runs:legacy?[]:[{...run,can_supply:false,stock_error:'Assigned stock location needs review'}],legacy:legacy?[{id:'old-custody',name:'Older employee custody',stock_error:'Legacy quantities need review'}]:[]};
    const f=await fixture({kind,data}),{r,draw,settle}=f;
    try{
      draw();const html=await settle();assert.doesNotMatch(html,/No goods currently assigned|On hand 0/);
      if(kind==='overview')assert.match(html,/Some stock needs review/);
      else {assert.match(html,/role="alert"/);assert.match(html,legacy?/Older employee custody: Legacy quantities need review/:/Assigned stock location needs review/);assert.equal(button(r,'Record sale').disabled,true);}
    }finally{f.close();}
  }
});

test('a compact overview discloses omitted items and links to the complete stock list',async()=>{
  const products=Array.from({length:6},(_,i)=>({...product,id:'item-'+i,name:'Item '+i})),data={...snapshot,products,balances:products.map(p=>({...snapshot.balances[0],id:'lot-'+p.id,product_id:p.id}))};
  const f=await fixture({data}),{draw,settle}=f;
  try{draw();const html=await settle();assert.match(html,/Showing 4 of 6 stock items/);assert.match(html,/Item 0/);assert.match(html,/Item 3/);assert.doesNotMatch(html,/Item 4|Item 5/);assert.match(html,/href="\/my-stock"/);}finally{f.close();}
});
