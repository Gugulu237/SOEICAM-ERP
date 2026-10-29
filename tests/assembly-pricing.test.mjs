import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblyEstimate,assemblyProfitability} from '../src/lib/assembly-pricing.js';
import {componentFromRecord} from '../src/lib/assembly-components.js';
import {watchItemCatalogue} from '../src/lib/item-catalogue-sync.js';

test('markup and margin use different denominators, retain losses and avoid fake percentages on unknown or zero bases',()=>{
  const regular=assemblyProfitability(200,300);assert.equal(regular.profit,100);assert.equal(regular.markup,50);assert.ok(Math.abs(regular.margin-33.3333333333)<1e-8);
  assert.deepEqual(assemblyProfitability(200,100),{profit:-100,markup:-50,margin:-100});
  assert.deepEqual(assemblyProfitability(0,100),{profit:100,markup:null,margin:100});
  assert.deepEqual(assemblyProfitability(100,0),{profit:-100,markup:-100,margin:null});
  for(const missing of [null,undefined,'',NaN,-1,true])assert.deepEqual(assemblyProfitability(missing,300),{profit:null,markup:null,margin:null});
});

test('assembly estimates follow registered updates without changing quantities, custom costs or stored definitions',()=>{
  const milk={id:'milk',name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg',current_cost:1000};
  const cup={id:'cup',name:'Cup',inventory_type:'packaging',unit_of_measure:'ea',current_cost:50};
  const rows=[{...componentFromRecord('inventory_part',milk),quantity:0.5},{...componentFromRecord('inventory_part',cup),quantity:1,cost_source:'manual',unit_cost:30}];
  const before=structuredClone(rows);
  assert.equal(assemblyEstimate(rows,[milk,cup]),530);
  assert.equal(assemblyEstimate(rows,[{...milk,current_cost:1200},{...cup,current_cost:80}]),630);
  assert.deepEqual(rows,before);
  assert.equal(assemblyEstimate([],[]),null);
  assert.equal(assemblyEstimate(rows,[milk]),null);
  assert.equal(assemblyEstimate([{...rows[0],unit:'ea'}],[milk]),null);
});

test('catalogue watching refreshes on focus and visible intervals, pauses hidden tabs and removes listeners',async()=>{
  const target=new EventTarget(),document=new EventTarget();let tick,cleared=false,calls=0;
  target.setInterval=fn=>{tick=fn;return 9;};target.clearInterval=id=>{assert.equal(id,9);cleared=true;};document.visibilityState='visible';
  const stop=watchItemCatalogue(async()=>calls++,{target,document});
  target.dispatchEvent(new Event('focus'));await Promise.resolve();assert.equal(calls,1);
  document.visibilityState='hidden';tick();await Promise.resolve();assert.equal(calls,1);
  document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();assert.equal(calls,2);
  tick();await Promise.resolve();assert.equal(calls,3);
  stop();target.dispatchEvent(new Event('focus'));await Promise.resolve();assert.equal(calls,3);assert.ok(cleared);
});


test('milk purchase-price changes override old carrying costs in nested assembly estimates and preserve manual overrides',()=>{
 const milk={id:'milk',name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg',purchase_unit:'bag',purchase_to_storage_factor:25,purchase_price:30000,current_cost:1000};
 const base={id:'base',name:'Yogurt base',inventory_type:'assembly',unit_of_measure:'ea',standard_cost:500,current_cost:450,components:[{product_id:'milk',quantity:0.5,unit:'kg',unit_cost:1000,cost_source:'registered'}]};
 const parent=[{product_id:'base',quantity:2,unit:'ea',unit_cost:500,cost_source:'registered'},{product_id:'milk',quantity:0.1,unit:'kg',unit_cost:900,cost_source:'manual'}];
 assert.equal(assemblyEstimate(base.components,[milk,base]),600);assert.equal(assemblyEstimate(parent,[milk,base]),1290);assert.equal(base.current_cost,450);assert.equal(milk.current_cost,1000);
 assert.equal(assemblyEstimate([{product_id:'milk',quantity:500,unit:'g',unit_cost:1}],[milk]),600);
});

test('catalogue mutations notify same-tab and cross-tab watchers without requiring focus',async()=>{
 const target=new EventTarget(),document=new EventTarget();document.visibilityState='visible';let count=0;
 const stop=watchItemCatalogue(()=>count++,{target,document,interval:0});
 target.dispatchEvent(new Event('soeicam:item-catalogue-changed'));await Promise.resolve();assert.equal(count,1);
 const event=new Event('storage');Object.assign(event,{key:'soeicam:item-catalogue-revision'});target.dispatchEvent(event);await Promise.resolve();assert.equal(count,2);
 stop();target.dispatchEvent(new Event('soeicam:item-catalogue-changed'));await Promise.resolve();assert.equal(count,2);
});
