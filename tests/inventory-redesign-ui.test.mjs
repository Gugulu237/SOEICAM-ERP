import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
let compiled;
async function render(kind,props) {
  compiled ||= build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Groups from './src/components/inventory/GroupedItems.jsx';import Fields from './src/components/items/InventoryFields.jsx';import Quick from './src/components/items/QuickItemPanel.jsx';import Service from './src/components/items/ServiceFields.jsx';import Timer from './src/components/manufacturing/FermentationTimer.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement({Groups,Fields,Quick,Service,Timer}[kind],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false}).then(out=>{const module={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,module,module.exports);return module.exports.render;});
  return (await compiled)(kind,props);
}
const form={name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg',purchase_price:500,selling_price:1000};
test('material and internal service forms show cost and quantity while sales fields appear only for finished assemblies',async()=>{
  const props={form,set(){},accounts:[],suppliers:[],quantityOnHand:25};
  const material=await render('Fields',props);assert.match(material,/Quantity on hand/);assert.match(material,/value="25"/);assert.doesNotMatch(material,/Sales price|Income Account|Sales information/);
  const finished=await render('Fields',{...props,isAssembly:true});assert.match(finished,/Sales price/);assert.match(finished,/Income Account/);
  const quick=await render('Quick',{item:form,draft:{purchase_price:'500',selling_price:'1000',unit_of_measure:'kg',reorder_level:'0'},choices:[],stock:{status:'loading'}});assert.match(quick,/Purchase cost/);assert.doesNotMatch(quick,/Selling price|Current selling price/);
  const service=await render('Service',props);assert.match(service,/Internal service cost/);assert.doesNotMatch(service,/Sales price|Income Account/);
});
test('catalogue renders family then flavour then size, real per-item units and separate edit controls',async()=>{
  const products=[{id:'b',name:'Drink vanilla',inventory_type:'assembly',product_family:'Yaourt à boire',flavor:'Vanille',size:'330 ml',unit_of_measure:'ea'},{id:'a',name:'Stirred strawberry',inventory_type:'assembly',product_family:'Yaourt brassé',flavor:'Fraise',size:'500 g',unit_of_measure:'ea'}];
  const html=await render('Groups',{products,filter:'finished',quantities:new Map([['a',12],['b',4]]),onEdit(){},renderDetails:()=>null});
  assert.ok(html.indexOf('Yaourt brassé')<html.indexOf('Stirred strawberry'));
  assert.match(html,/Strawberry/);assert.match(html,/500 g/);const text=html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');assert.match(text,/12 ea/);assert.match(text,/4 ea/);assert.match(text,/Brassé · Strawberry · 500 g/);assert.match(text,/Drinkable · Vanilla · 330 ml/);
  let depth=0;for(const tag of html.matchAll(/<button\b|<\/button>/g)){depth+=tag[0].startsWith('</')?-1:1;assert.ok(depth>=0 && depth<=1);}assert.equal(depth,0);
});
test('large catalogues render 25 items per page and retain the complete result count',async()=>{
  const products=Array.from({length:10000},(_,i)=>({id:String(i),name:'Milk '+i,inventory_type:'raw_material',unit_of_measure:'kg'}));
  const html=await render('Groups',{products,filter:'materials',quantities:new Map(),renderDetails:()=>null});
  assert.equal([...html.matchAll(/<article\b/g)].length,25);assert.match(html,/Showing 1–25 of 10000 items/);assert.match(html,/Next item page/);assert.match(html,/Page 1 of 400/);
});
test('fermentation display uses the stored deadline rather than restarting an eight-hour browser countdown',async()=>{
  const html=await render('Timer',{order:{status:'in_production',fermentation_due_at:new Date(Date.now()+30*60000).toISOString()}});assert.match(html,/0h 30m remaining/);
  assert.match(await render('Timer',{order:{status:'in_production',fermentation_due_at:'2020-01-01T00:00:00Z'}}),/timer complete/);
});
