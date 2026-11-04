import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
 compiled||=build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Catalogue from './src/components/shared/ProductCatalog.jsx';import Warehouse from './src/components/inventory/WarehouseStockItems.jsx';import Table from './src/components/shared/DataTable.jsx';import Alerts from './src/components/inventory/StockAlerts.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement({Catalogue,Warehouse,Table,Alerts}[kind],props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,plugins:[{name:'list-controls',setup(b){
  b.onResolve({filter:/^react\/jsx-runtime$/},a=>/(ProductCatalog|WarehouseStockItems|DataTable|StockAlerts)\.jsx$/.test(a.importer)?{path:'jsx',namespace:'capture-jsx'}:undefined);
  b.onLoad({filter:/.*/,namespace:'capture-jsx'},()=>({resolveDir:process.cwd(),contents:`import {jsx as baseJsx,jsxs as baseJsxs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,props,key)=>{globalThis.__listUI.capture(tag,props,props?.children);return baseJsx(tag,props,key);};export const jsxs=(tag,props,key)=>{globalThis.__listUI.capture(tag,props,props?.children);return baseJsxs(tag,props,key);};`}));
  b.onResolve({filter:/^react$/},a=>/(ProductCatalog|WarehouseStockItems|DataTable|StockAlerts)\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},a=>({resolveDir:process.cwd(),contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(a.path)};export default {...React,createElement:(tag,props,...children)=>{globalThis.__listUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const Fragment=React.Fragment,useState=v=>globalThis.__listUI.state(key,v),useRef=v=>globalThis.__listUI.ref(key,v),useMemo=(fn,deps)=>{const ref=globalThis.__listUI.ref(key,{});if(!ref.current.deps||deps.some((d,i)=>!Object.is(d,ref.current.deps[i])))ref.current={deps,value:fn()};return ref.current.value;};`}));
  const mocks={
   '@/lib/localization':'export const useLocaleRender=()=>{};',
   '@/lib/i18n':"export const getLocale=()=> 'en-GB';export const getLanguage=()=> 'en';export const ui=(value,...args)=>String(value).replace(/\\{(\\d+)\\}/g,(_,i)=>String(args[i]??''));",
   '@/lib/navigation-context':"export const usePageState=(key,value)=>globalThis.__listUI.state('page:'+key,value);",
   '@/hooks/usePhoneLayout':'export const usePhoneLayout=()=>Boolean(globalThis.__listUI.phone);',
   '@/components/shared/ReportExport':"export default props=>{globalThis.__listUI.report=props;return null;};",
   '@/components/shared/ProductSortSelect':"import React from 'react';export default props=>{globalThis.__listUI.sort=props;return React.createElement('select',{'aria-label':'Sort products',value:props.value,onChange:e=>props.onChange(e.target.value)},React.createElement('option',{value:'name'},'Name'));};",
   '@/components/ui/picker-popdown':"import React from 'react';export default props=>{globalThis.__listUI.anchor=props.anchorRef.current;return React.createElement('div',null,props.children);};",
   '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...props})=>{globalThis.__listUI.capture('button',props,children);return React.createElement('button',props,children);};",
   '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__listUI.capture('input',props,[]);return React.createElement('input',props);};",
   photo:"import React from 'react';export function ProductPhoto(props){globalThis.__listUI.photos.push(props);return React.createElement('img',{alt:props.name||props.product?.name});}export default ProductPhoto;",
   quantity:"export default props=>{globalThis.__listUI.quantity=props;return null;};"
  };
  b.onResolve({filter:/(^|\/)ProductThumb$/},()=>({path:'photo',namespace:'mock'}));
  b.onResolve({filter:/^\.\/ProductQuantityBar$/},()=>({path:'quantity',namespace:'mock'}));
  b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]}).then(output=>{const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);return mod.exports.render;});
 return compiled;
}
function state(){const r=hookRuntime(),before=r.beforeRender.bind(r);r.beforeRender=()=>{before();r.photos=[];r.quantity=null;r.anchor=null;};globalThis.__listUI=r;return r;}
const control=(r,label)=>r.controls.find(c=>c['aria-label']===label);
const button=(r,label)=>r.buttons.find(b=>b['aria-label']===label||b.label===label);
const products=length=>Array.from({length},(_,i)=>({id:'p'+i,name:'Product '+String(i).padStart(4,'0'),sku:'SKU-'+i,inventory_type:'raw_material',quantity:100,selling_price:500,unit:'ea'}));

test('a 2500-item catalogue mounts 24 cards, searches the full catalogue and retains selected quantities across pages',async()=>{
 const render=await renderer(),r=state(),items=products(2500),selected=[{product_id:'p0',quantity:2}],calls=[];
 const draw=()=>{r.beforeRender();return render('Catalogue',{products:items,lines:selected,onQuantityChange:(product,quantity)=>calls.push([product.id,quantity]),selling:true});};
 try{
  const html=draw();assert.equal((html.match(/<article/g)||[]).length,24);assert.equal(r.photos.length,24);assert.match(html,/2500/);
  const anchor={id:'p0-button'};button(r,'Enter quantity for Product 0000').onClick({currentTarget:anchor});draw();assert.equal(r.quantity.value,2);assert.equal(r.anchor,anchor);
  button(r,'Next product page').onClick();draw();assert.equal(r.quantity,null);assert.equal(r.photos.length,24);assert.equal(button(r,'Enter quantity for Product 0000'),undefined);
  control(r,'Search products').onChange({target:{value:'SKU-2499'}});draw();assert.equal(r.photos.length,1);assert.equal(r.photos[0].product.id,'p2499');button(r,'Enter quantity for Product 2499').onClick({currentTarget:anchor});draw();r.quantity.onConfirm(7);assert.deepEqual(calls,[['p2499',7]]);
  button(r,'Clear product search').onClick();draw();button(r,'Enter quantity for Product 0000').onClick({currentTarget:anchor});draw();assert.equal(r.quantity.value,2);assert.deepEqual(selected,[{product_id:'p0',quantity:2}]);
 }finally{r.cleanup();delete globalThis.__listUI;}
});

test('catalogue quantity edits and page changes reuse indexed search and sorting instead of rereading every product',async()=>{
 const render=await renderer(),r=state(),items=products(300);let reads=0;
 for(const item of items){const name=item.name;Object.defineProperty(item,'name',{get(){reads++;return name;},enumerable:true});}
 const lines=[],draw=()=>{r.beforeRender();return render('Catalogue',{products:items,lines,onQuantityChange(){}});};
 try{draw();reads=0;button(r,'Enter quantity for Product 0000').onClick({currentTarget:{}});draw();assert.ok(reads<120,'opening one quantity editor must not rescan 300 product names');reads=0;button(r,'Next product page').onClick();draw();assert.ok(reads<120,'paging must reuse the same complete sorted index');}
 finally{r.cleanup();delete globalThis.__listUI;}
});

test('warehouse item and batch pages bound mounted rows while full search, quantities and actions remain available',async()=>{
 const render=await renderer(),r=state(),edits=[],adjustments=[],items=products(101);
 const rows=items.map((product,i)=>({id:product.id,name:product.name,product,quantity:i,usable:i,value:i*2,unit:'ea',hasRecordedBalance:true,lots:i===0?Array.from({length:60},(_,j)=>({id:'lot'+j,lot_number:'BATCH-'+String(j).padStart(3,'0'),quantity:1,total_value:2,qc_status:'quarantine'})):[]}));
 const draw=()=>{r.beforeRender();return render('Warehouse',{rows,onEditItem:p=>edits.push(p.id),onAdjust:p=>adjustments.push(p.id)});};
 try{
  draw();assert.equal(r.photos.length,25);button(r,'Stock records for Product 0000').onClick();let html=draw();assert.match(html,/BATCH-024/);assert.doesNotMatch(html,/BATCH-025/);
  r.buttons.find(b=>b.label==='Next'&&!b['aria-label']).onClick();html=draw();assert.match(html,/BATCH-025/);assert.doesNotMatch(html,/BATCH-000/);
  button(r,'Next warehouse item page').onClick();draw();assert.equal(r.photos.length,25);assert.equal(button(r,'Stock records for Product 0000'),undefined);
  control(r,'Search warehouse items').onChange({target:{value:'SKU-100'}});html=draw();assert.equal(r.photos.length,1);assert.match(html,/Product 0100/);button(r,'Edit Product 0100').onClick();button(r,'Adjust quantity for Product 0100').onClick();assert.deepEqual(edits,['p100']);assert.deepEqual(adjustments,['p100']);
  assert.equal(rows[0].lots.length,60);assert.equal(rows[100].quantity,100);
 }finally{r.cleanup();delete globalThis.__listUI;}
});

test('table search fields are indexed once, paging stays bounded and exports contain all matching records',async()=>{
 const render=await renderer(),r=state(),rows=products(1000);r.phone=true;let reads=0;
 for(const row of rows){const sku=row.sku;Object.defineProperty(row,'sku',{get(){reads++;return sku;},enumerable:true});}
 const columns=[{key:'name',label:'Name'},{key:'quantity',label:'Quantity'}];
 const draw=()=>{r.beforeRender();return render('Table',{data:rows,columns,searchFields:['sku'],pageSize:15,exportTitle:'Stock report'});};
 try{
  let html=draw();assert.equal((html.match(/<article/g)||[]).length,15);assert.equal(reads,1000);reads=0;
  button(r,'Next records').onClick();draw();assert.equal(reads,0,'equivalent new field arrays must not rebuild search strings');
  control(r,'Search records').onChange({target:{value:'SKU-9'}});html=draw();assert.equal(reads,0);assert.equal((html.match(/<article/g)||[]).length,15);
  const report=r.report.getReport();assert.equal(report.sections[0].rows.length,111,'export must include matches outside the visible page');
 }finally{r.cleanup();delete globalThis.__listUI;}
});


test('low-stock alerts page all eligible items and preserve open-item actions and severity order',async()=>{
 const render=await renderer(),r=state(),items=products(101).map(item=>({...item,reorder_level:5})),opened=[];
 const balances=items.map((item,i)=>({product_id:item.id,quantity:i===100?0:2}));
 const draw=()=>{r.beforeRender();return render('Alerts',{products:items,balances,onEdit:item=>opened.push(item.id)});};
 try{
  let html=draw();assert.equal((html.match(/<li /g)||[]).length,25);assert.match(html,/Showing 1-25 of 101 items/);assert.ok(html.indexOf('Product 0100')<html.indexOf('Product 0000'),'out-of-stock items retain first priority');
  r.buttons.find(b=>b.label==='Open item').onClick();assert.deepEqual(opened,['p100']);
  button(r,'Next').onClick();html=draw();assert.match(html,/Product 0024/);assert.doesNotMatch(html,/Product 0100/);assert.equal((html.match(/<li /g)||[]).length,25);
  r.buttons.find(b=>b.label==='Open item').onClick();assert.deepEqual(opened,['p100','p24']);
  button(r,'Next').onClick();draw();button(r,'Next').onClick();draw();button(r,'Next').onClick();html=draw();assert.match(html,/Product 0099/);assert.equal((html.match(/<li /g)||[]).length,1);assert.equal(button(r,'Next').disabled,true);
  assert.equal(items.length,101);assert.equal(balances.length,101);
 }finally{r.cleanup();delete globalThis.__listUI;}
});
