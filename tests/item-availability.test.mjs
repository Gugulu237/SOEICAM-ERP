import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { fixture,user } from './helpers/cashier.mjs';
import { saveItem } from '../src/server/domain/item-save.js';
import { prepareProductDefinition } from '../src/server/domain/product-definition.js';
import { finishedItemSetupIssues,itemAvailabilityLabel } from '../src/lib/item-readiness.js';
import { recipeCatalogue } from '../src/lib/yogurt-recipe-presets.js';
import { assemblyRecordAvailable } from '../src/lib/assembly-component-groups.js';

async function setup(db){
 const f=await fixture(db),s=f.entities;
 const cogs=await s.Account.create({name:'Costs',account_type:'cogs',is_active:true,is_posting:true}),income=await s.Account.create({name:'Sales',account_type:'revenue',is_active:true,is_posting:true}),stock=await s.Account.create({name:'Inventory',account_type:'asset',is_active:true,is_posting:true});
 const cup=await s.Product.create({name:'Cups',inventory_type:'packaging',unit_of_measure:'ea',current_cost:10,is_active:true});
 const product=await s.Product.create({name:'YOLA Brasse Nature 500g',inventory_type:'assembly',unit_of_measure:'ea',product_family:'Yaourt Brasse',flavor:'Nature',size:'500 g',selling_price:500,cogs_account_id:cogs.id,revenue_account_id:income.id,inventory_account_id:stock.id,components:[{component_type:'inventory_part',product_id:cup.id,quantity:1,unit:'ea',unit_cost:10,cost_source:'registered'}],configuration_status:'ready',is_active:false});
 return {...f,product,cup,cogs,income,stock,context:{user:{...user,role:'admin'},employee:{id:'cashier',role:'admin',full_name:'Owner'}}};
}
test('one checked activation makes a configured finished item available to inventory, assemblies and recipe selection without moving stock or posting journals',async()=>{
 const f=await setup(),s=f.entities,p=f.product;
 await s.StockBalance.create({product_id:p.id,quantity:7,unit_cost:40,total_value:280});
 const before=await s.StockBalance.filter({product_id:p.id}),journals=(await s.JournalEntry.filter()).length;
 const saved=await saveItem(f.context,s,{id:p.id,updatedDate:p.updated_date,changes:{is_active:true}});
 assert.equal(saved.is_active,true);assert.equal(assemblyRecordAvailable(saved,'assembly'),true);assert.equal(recipeCatalogue([saved],'brasse')[0].unavailable,false);assert.deepEqual(await s.StockBalance.filter({product_id:p.id}),before);assert.equal((await s.JournalEntry.filter()).length,journals);
 const audit=await s.AuditLog.filter({action:'change_item_availability'});assert.equal(audit.length,1);assert.equal(audit[0].user_id,user.id);assert.equal(audit[0].item_status_before.is_active,false);assert.equal(audit[0].item_status_after.is_active,true);
 await saveItem(f.context,s,{id:p.id,updatedDate:saved.updated_date,changes:{is_active:true}});assert.equal((await s.AuditLog.filter({action:'change_item_availability'})).length,1,'Retrying an already-applied status must not create duplicate transition history');
});
test('activation freshly validates configured assemblies and rejects missing setup, bad accounts, missing components and stale edits',async()=>{
 const f=await setup(),s=f.entities,p=f.product;
 const activate=existing=>prepareProductDefinition(s,{is_active:true},existing);
 for(const [field,value] of [['components',[]],['unit_of_measure',''],['selling_price',0],['cogs_account_id','']])await assert.rejects(activate({...p,[field]:value}),/before activating/);
 await s.Account.update(f.income.id,{is_active:false});await assert.rejects(activate(p),/active posting/);await s.Account.update(f.income.id,{is_active:true});
 await assert.rejects(activate({...p,components:[{...p.components[0],product_id:'missing'}]}),/registered component/);
 await assert.rejects(saveItem(f.context,s,{id:p.id,updatedDate:'outdated',changes:{is_active:true}}),/changed in another window/);assert.equal((await s.Product.get(p.id)).is_active,false);assert.equal((await s.AuditLog.filter({action:'change_item_availability'})).length,0);
});
test('unfinished imports stay explicitly marked for assembly setup; a complete imported draft can be activated through the checked save',async()=>{
 const f=await setup(),s=f.entities,p=f.product;
 const draft=await s.Product.update(p.id,{configuration_status:'draft',components:[],selling_price:null});
 assert.equal(itemAvailabilityLabel(draft),'Assembly setup needed');assert.deepEqual(finishedItemSetupIssues(draft),['Assembly components','Positive selling price']);
 await assert.rejects(saveItem(f.context,s,{id:p.id,updatedDate:draft.updated_date,changes:{is_active:true}}),/before activating/);
 const complete=await s.Product.update(p.id,{components:p.components,selling_price:500});
 const saved=await saveItem(f.context,s,{id:p.id,updatedDate:complete.updated_date,changes:{is_active:true}});assert.equal(saved.configuration_status,'ready');assert.equal(saved.is_active,true);
});

test('activation keeps existing role boundaries and rolls back the status when audit recording fails',async()=>{
 const db=new PGlite();
 try{const f=await setup(db),s=f.entities,p=f.product;
   await assert.rejects(saveItem({user,employee:{id:'cashier',role:'commercial'}},s,{id:p.id,updatedDate:p.updated_date,changes:{is_active:true}}),/permit|access|allowed/i);
   s.AuditLog.create=async()=>{throw Error('Audit unavailable');};
   await db.exec('BEGIN');
   try{await assert.rejects(saveItem(f.context,s,{id:p.id,updatedDate:p.updated_date,changes:{is_active:true}}),/Audit unavailable/);}finally{await db.exec('ROLLBACK');}
   assert.equal((await s.Product.get(p.id)).is_active,false);assert.equal((await s.AuditLog.filter({action:'change_item_availability'})).length,0);
 }finally{await db.close();}
});
