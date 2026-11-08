import test from 'node:test';
import assert from 'node:assert/strict';
import {stockIssue,stockReceive,stockTransfer,getRuleAccount} from '../src/server/domain/field-ops.js';
import {saleItemPostings,purchaseItemPostings} from '../src/lib/item-posting.js';
import {fixture} from './helpers/cashier.mjs';

const issue=svc=>stockIssue(svc,{productId:'product-a',warehouseId:'van-stock',quantity:1,movementType:'customer_delivery',documentType:'SalesOrder',documentId:crypto.randomUUID(),saleableOnly:true});

test('sales release recorded lot value rather than inflating COGS from a stale unit cost',async()=>{
 const f=await fixture(),s=f.entities;await s.StockBalance.update('stock',{quantity:10,unit_cost:1000,total_value:100});
 const first=await issue(f.client.asServiceRole),lot=await s.StockBalance.get('stock');
 assert.equal(first.totalValue,10);assert.equal(first.layers[0].unitCost,10);assert.equal(lot.quantity,9);assert.equal(lot.total_value,90);assert.equal(lot.unit_cost,10);
 const all=[first];for(let i=0;i<9;i++)all.push(await issue(f.client.asServiceRole));
 assert.equal(all.reduce((n,result)=>n+result.totalValue,0),100);assert.equal((await s.StockBalance.get('stock')).total_value,0);
 assert.equal((await s.StockMovement.list()).reduce((n,m)=>n+m.total_value,0),100);
});

test('fractional carrying values survive repeated issues and the final issue clears all residual cents',async()=>{
 const f=await fixture(),s=f.entities;await s.StockBalance.update('stock',{quantity:3,unit_cost:0.03,total_value:0.10});
 const values=[];for(let i=0;i<3;i++)values.push((await issue(f.client.asServiceRole)).totalValue);
 assert.deepEqual(values,[0.03,0.04,0.03]);assert.equal((await s.StockBalance.get('stock')).quantity,0);assert.equal((await s.StockBalance.get('stock')).total_value,0);
});

test('missing or invalid carrying value blocks a stock issue before any mutation',async()=>{
 for(const value of [undefined,null,'',-1,'bad',Infinity]){
  const f=await fixture();await f.entities.StockBalance.update('stock',{total_value:value});const before=structuredClone(f.rows);
  await assert.rejects(issue(f.client.asServiceRole),/recorded lot values/);assert.deepEqual(f.rows,before);
 }
});

test('transfers preserve lot value by default and receipts add numeric imported quantities',async()=>{
 const f=await fixture(),s=f.entities;await s.StockBalance.update('stock',{quantity:'10',unit_cost:1000,total_value:'100'});
 await stockTransfer(f.client.asServiceRole,{productId:'product-a',fromWarehouseId:'van-stock',toWarehouseId:'factory',quantity:2,movementType:'warehouse_transfer',documentType:'Dispatch',documentId:'transfer'});
 assert.equal((await s.StockBalance.get('stock')).total_value,80);let target=(await s.StockBalance.filter({warehouse_id:'factory'}))[0];assert.equal(target.total_value,20);assert.equal(target.unit_cost,10);
 await s.StockBalance.update(target.id,{quantity:'2',total_value:'20'});
 await stockReceive(f.client.asServiceRole,{productId:'product-a',warehouseId:'factory',quantity:1,unitCost:10,lotNumber:'LOT',movementType:'goods_receipt'});
 target=await s.StockBalance.get(target.id);assert.equal(target.quantity,3);assert.equal(target.total_value,30);
});

test('posting rules reject duplicated, missing, inactive and financially mistyped accounts',async()=>{
 const f=await fixture(),s=f.entities;const ref=await getRuleAccount(f.client.asServiceRole,'finished_goods_inventory');assert.equal(ref.id,'inventory');
 await s.PostingRule.create({rule_key:'finished_goods_inventory',account_id:'inventory',is_active:true});await assert.rejects(getRuleAccount(f.client.asServiceRole,'finished_goods_inventory'),/duplicated/);
 await s.PostingRule.deleteMany({rule_key:'finished_goods_inventory'});await s.PostingRule.create({rule_key:'finished_goods_inventory',account_id:'inventory',is_active:true});
 for(const bad of [{account_type:'cogs',normal_balance:'debit'},{account_type:'asset',normal_balance:'credit'},{account_type:'asset',normal_balance:'debit',is_active:false}]){
  await s.Account.update('inventory',{is_active:true,...bad});await assert.rejects(getRuleAccount(f.client.asServiceRole,'finished_goods_inventory'),/account mapped/);
 }
 await s.Account.update('cogs',{account_type:'expense'});await assert.rejects(getRuleAccount(f.client.asServiceRole,'direct_material_cogs'),/account mapped/);
 await s.PostingRule.create({rule_key:'inventory_loss_expense',account_id:'expense',is_active:true});assert.equal((await getRuleAccount(f.client.asServiceRole,'inventory_loss_expense')).id,'expense');
});

test('item posting fallbacks receive the same financial-type validation as explicit item accounts',async()=>{
 const f=await fixture(),s=f.entities,lines=[{product_id:'product-a',quantity:1,total:500,cogs_total:10}];
 const fallback=field=>getRuleAccount(f.client.asServiceRole,{revenue_account_id:'sales_revenue',cogs_account_id:'direct_material_cogs',inventory_account_id:'finished_goods_inventory'}[field]);
 assert.equal((await saleItemPostings(s,lines,{netTotal:500,costTotal:10,fallback})).find(l=>l.account_id==='cogs').debit,10);
 for(const bad of [{account_type:'revenue',normal_balance:'credit'},{account_type:'asset',normal_balance:'credit'},{account_type:'asset',normal_balance:'debit',currency:'USD'}]){
  await s.Account.update('inventory',{currency:'XAF',...bad});
  const forged=async field=>({account_id:{revenue_account_id:'revenue',cogs_account_id:'cogs',inventory_account_id:'inventory'}[field]});
  await assert.rejects(saleItemPostings(s,lines,{netTotal:500,costTotal:10,fallback:forged}),/Inventory Asset Account/);
  await assert.rejects(purchaseItemPostings(s,[{product_id:'product-a',total:10}],{total:10,fallback:forged}),/Inventory Asset Account/);
 }
});
