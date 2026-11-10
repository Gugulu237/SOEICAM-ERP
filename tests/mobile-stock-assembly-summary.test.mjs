import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {stockExpirySummary} from '../src/lib/stock-expiry-summary.js';
import {assemblyDetailSummary,assemblyDetailLine} from '../src/lib/assembly-detail-summary.js';

test('nearest expiry follows positive physical balances, including expired, held and outbound stock',()=>{
  const balances=[
    {product_id:'p',quantity:0,expiry_date:'2000-01-01'},
    {product_id:'p',quantity:-2,expiry_date:'2001-01-01'},
    {product_id:'p',quantity:5,expiry_date:'2026-12-20',qc_status:'approved'},
    {product_id:'p',quantity:3,expiry_date:'2026-11-01',qc_status:'held'},
    {product_id:'p',quantity:'2',expiry_date:'2026-11-05',warehouse_id:'vehicle'},
  ],before=structuredClone(balances),summary=stockExpirySummary(balances,'2026-11-10');
  assert.deepEqual(summary.get('p'),{date:'2026-11-01',expired:true,positiveBatches:3,missingDates:0,invalidDates:0});
  assert.deepEqual(balances,before);
  assert.equal(summary.has('unpermitted-product'),false,'the read projection cannot add an unprovided scope');
});

test('unknown and invalid calendar dates remain distinct from known dates and expiry today is current',()=>{
  const summary=stockExpirySummary([
    {product_id:'mixed',quantity:1,expiry_date:'2026-11-10'},
    {product_id:'mixed',quantity:1,expiry_date:''},
    {product_id:'mixed',quantity:1,expiry_date:'2026-02-31'},
    {product_id:'unknown',quantity:1},
    {product_id:'leap',quantity:1,expiry_date:'2028-02-29'},
  ],'2026-11-10');
  assert.deepEqual(summary.get('mixed'),{date:'2026-11-10',expired:false,positiveBatches:3,missingDates:1,invalidDates:1});
  assert.equal(summary.get('unknown').date,null);
  assert.equal(summary.get('leap').date,'2028-02-29');
});

test('exhausted, invalid and blank quantities cannot revive an old batch expiry',()=>{
  for(const quantity of [0,-1,null,undefined,'',NaN,'invalid',Infinity,true])assert.equal(stockExpirySummary([{product_id:'p',quantity,expiry_date:'2026-01-01'}]).size,0);
});

const milk={id:'milk',name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg',purchase_unit:'bag',purchase_to_storage_factor:25,purchase_price:30000,current_cost:1000};
const cup={id:'cup',name:'Cup',inventory_type:'raw_material',category:'Packaging',unit_of_measure:'ea',current_cost:80};
const components=[{product_id:'milk',quantity:0.5,unit:'kg',unit_cost:1000},{product_id:'cup',quantity:1,unit:'ea',unit_cost:30,cost_source:'manual'},{component_type:'other',product_name:'Allocation',quantity:1,unit:'use',unit_cost:20,cost_source:'manual'}];

test('assembly totals follow current registered unit conversions and preserve deliberate overrides without writes',()=>{
  const item={components,yogurt_units_per_bucket:52},before=structuredClone({item,milk,cup}),summary=assemblyDetailSummary(item,[milk,cup]);
  assert.equal(summary.yieldUnits,52);
  assert.equal(summary.materialUnitCost,620);
  assert.equal(summary.materialTotal,32240);
  assert.equal(summary.packagingUnitCost,30);
  assert.equal(summary.packagingBucketCost,1560);
  assert.equal(summary.totalUnitCost,650);
  assert.equal(summary.otherComponents,true);
  assert.equal(summary.packaging.length,1,'legacy categorized packaging keeps its per-unit basis');
  assert.deepEqual(assemblyDetailLine(components[0],[milk,cup],52),{quantity:26,unitCost:1200,total:31200});
  assert.deepEqual({item,milk,cup},before);
});

test('missing costs stay unknown and no bucket yield is inferred from a product size',()=>{
  const summary=assemblyDetailSummary({size:'500 g',components:[...components,{product_id:'missing',quantity:1,unit:'ea',unit_cost:99}]},[milk,cup]);
  assert.equal(summary.yieldUnits,null);
  assert.equal(summary.materialTotal,null);
  assert.equal(summary.totalUnitCost,null);
  assert.equal(summary.packagingUnitCost,30);
  assert.equal(summary.packagingBucketCost,null);
  assert.deepEqual(assemblyDetailLine({product_id:'missing',quantity:1,unit:'ea',unit_cost:99},[milk,cup]),{quantity:1,unitCost:null,total:null});
});

const require=createRequire(import.meta.url);
let renderer;
async function renderStock(props){
  renderer||=build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Stock from './src/components/inventory/MobileStockList.jsx';export const render=props=>renderToStaticMarkup(<Stock {...props}/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false}).then(out=>{const module={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,module,module.exports);return module.exports.render;});
  return (await renderer)(props);
}

test('finished Stock rows show recorded expiry uncertainty beside physical on-hand without new stock actions',async()=>{
  const html=await renderStock({rows:[{item:{id:'p',name:'Yogurt',inventory_type:'assembly',unit_of_measure:'ea'},variant:{}}],quantities:new Map([['p',5]]),balances:[{product_id:'p',quantity:3,expiry_date:'2000-01-01',qc_status:'held'},{product_id:'p',quantity:2}],onOpen(){}});
  assert.match(html,/Expired/);assert.match(html,/datetime="2000-01-01"/i);
  assert.match(html,/Some batch expiry dates are unknown/);assert.match(html,/On hand/);
  assert.doesNotMatch(html,/Available for sale|Receive|Count/);
});

test('legacy packaging never displays missing or expired warnings, while undated other stock stays quiet',async()=>{
  const html=await renderStock({rows:[{item:cup,variant:{}}],quantities:new Map([['cup',4]]),balances:[{product_id:'cup',quantity:2,expiry_date:'2000-01-01'},{product_id:'cup',quantity:2,expiry_date:'invalid'}],onOpen(){}});
  assert.match(html,/No expiry required/);assert.doesNotMatch(html,/Expired|Expiry unknown|dates are unknown|2000-01-01/);
  const raw=await renderStock({rows:[{item:milk,variant:{}}],quantities:new Map([['milk',1]]),balances:[{product_id:'milk',quantity:1}],onOpen(){}});
  assert.doesNotMatch(raw,/expiry|Expired/);
});
