import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
 if(compiled)return compiled;
 const result=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Stock from './src/components/inventory/StockOnHand.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Stock,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'stock-ui',setup(b){
  b.onResolve({filter:/^react$/},a=>a.importer.endsWith('StockOnHand.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__stockUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=value=>globalThis.__stockUI.state('stock',value),useMemo=fn=>fn();`,resolveDir:process.cwd()}));
  const mocks={
   '@/lib/business-date':"export const businessDate=()=> '2026-11-01';",
   '@/components/ui/button':"import React from 'react';export function Button({children,...props}){globalThis.__stockUI.capture('button',props,children);return React.createElement('button',props,children);}",
  };
  b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);compiled=module.exports.render;return compiled;
}
const products=[{id:'milk',name:'Fresh milk',inventory_type:'assembly',unit_of_measure:'bottle'}],warehouses=[{id:'cold',name:'Cold room',warehouse_type:'cold_room'}];
const balances=[{id:'first',product_id:'milk',warehouse_id:'cold',lot_number:'LOT-001',batch_number:'PROD-1',quantity:12,expiry_date:'2026-11-03'},{id:'second',product_id:'milk',warehouse_id:'cold',lot_number:'LOT-002',batch_number:'PROD-2',quantity:5,expiry_date:'2026-11-10'}];
test('item details start collapsed, open accessibly and close again; search and expiry filters reconcile quantities',async()=>{
 const render=await renderer(),r=hookRuntime();globalThis.__stockUI=r;
 const paint=()=>{r.beforeRender();return render({products,balances,warehouses});};
 const item=()=>r.buttons.find(b=>b['aria-label']==='Stock details for Fresh milk');
 try{
  let html=paint();assert.match(html,/Fresh milk/);assert.doesNotMatch(html,/LOT-001|PROD-1|Send first/);assert.equal(item()['aria-expanded'],false);
  item().onClick();html=paint();assert.match(html,/LOT-001/);assert.match(html,/PROD-1/);assert.match(html,/Send first/);assert.match(html,/Cold room/);assert.equal(item()['aria-expanded'],true);assert.match(html,/overflow-y-auto/);
  item().onClick();assert.doesNotMatch(paint(),/LOT-001/);
  r.controls.find(c=>c['aria-label']==='Search items, lots or batches').onChange({target:{value:'PROD-2'}});paint();item().onClick();html=paint();assert.match(html,/LOT-002/);assert.doesNotMatch(html,/LOT-001|Send first/);assert.match(html,/only matching lots/);
  r.controls.find(c=>c['aria-label']==='Expiry window').onChange({target:{value:'7'}});assert.match(paint(),/No remaining stock/);
 }finally{r.cleanup();delete globalThis.__stockUI;}
});
test('large catalogues page without listing every batch and navigation returns to earlier items',async()=>{
 const render=await renderer(),r=hookRuntime();globalThis.__stockUI=r;
 const many=Array.from({length:25},(_,i)=>({...products[0],id:'item-'+String(i).padStart(2,'0'),name:'Item '+String(i).padStart(2,'0')}));
 const paint=()=>{r.beforeRender();return render({products:many,balances:many.map(p=>({...balances[0],id:'balance-'+p.id,product_id:p.id})),warehouses});};
 try{let html=paint();assert.match(html,/Item 00/);assert.doesNotMatch(html,/Item 24/);r.buttons.find(b=>b.label==='Next').onClick();html=paint();assert.match(html,/Item 24/);assert.doesNotMatch(html,/Item 00/);r.buttons.find(b=>b.label==='Previous').onClick();assert.match(paint(),/Item 00/);}finally{r.cleanup();delete globalThis.__stockUI;}
});
