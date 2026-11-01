import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryLowStock} from '../src/lib/stock-alerts.js';
import {isReadOnlyFunction} from '../src/lib/function-actions.js';

test('the stock bell counts each active item once using numeric quantities and omits drafts, services and unset thresholds',()=>{
  const products=[{id:'milk',name:'Milk',reorder_level:'6'},{id:'cups',name:'Cups',reorder_level:10},{id:'full',name:'Full',reorder_level:2},{id:'draft',configuration_status:'draft',reorder_level:2},{id:'inactive',is_active:false,reorder_level:2},{id:'service',inventory_type:'service',reorder_level:2},{id:'none',reorder_level:0}];
  const balances=[{product_id:'milk',quantity:'2.5'},{product_id:'milk',quantity:'3'},{product_id:'full',quantity:3}];
  const alerts=inventoryLowStock(products,balances);
  assert.deepEqual(alerts.map(p=>[p.id,p.stock]),[['cups',0],['milk',5.5]]);
  assert.equal(inventoryLowStock([{id:'milk',reorder_level:5.5}],balances).length,1);
});

test('stock issue setup is a read while issuing goods remains a transaction',()=>{
  assert.equal(isReadOnlyFunction('fieldOps','distributionIssueWorkspace'),true);
  assert.equal(isReadOnlyFunction('fieldOps','issueDistributionStock'),false);
  assert.equal(isReadOnlyFunction('fieldOps','warehouseAdjustmentHistory'),true);
});

test('expired and quality-held stock cannot hide a replenishment warning',()=>{
 const products=[{id:'yogurt',reorder_level:5},{id:'removed',item_removed_at:'2026-10-01',reorder_level:5}];
 const balances=[{product_id:'yogurt',quantity:30,expiry_date:'2020-01-01',qc_status:'approved'},{product_id:'yogurt',quantity:20,qc_status:'quarantine'},{product_id:'yogurt',quantity:4,qc_status:'approved',expiry_date:'2099-01-01'}];
 assert.deepEqual(inventoryLowStock(products,balances).map(p=>[p.id,p.stock]),[['yogurt',4]]);
});
