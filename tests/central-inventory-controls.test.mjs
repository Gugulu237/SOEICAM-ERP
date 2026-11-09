import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,user,date} from './helpers/cashier.mjs';
import {guardMutation} from '../src/server/access.js';
import {employeeStockAction} from '../src/server/domain/employee-stock.js';
import {inventoryOverview} from '../src/server/domain/inventory-overview.js';
import {distributionControlAction} from '../src/server/domain/distribution-control.js';
import {dispatchAction} from '../src/server/domain/dispatch-operations.js';
import {finishedStorageAllowed,finishedStockOutsideColdRoom} from '../src/lib/finished-product-storage.js';
import {isReadOnlyFunction} from '../src/lib/function-actions.js';

async function setup(){
 const f=await fixture(),s=f.entities,config={policy:'central-company-stock-v1',enabled:true,effective_date:date,activation_id:'CIA-'+'a'.repeat(64),central_warehouse_id:'central-pool'};
 await s.Employee.update('cashier',{role:'commercial'});
 await s.CompanySettings.update('settings',{centralized_inventory:config});
 f.rows.Warehouse.push({id:'central-pool',name:'Company inventory',warehouse_type:'general',central_inventory_pool:true,is_active:true});
 f.rows.AuditLog.push({id:config.activation_id,action:'activate_central_inventory',module:'inventory',entity_type:'CompanySettings',entity_id:'settings',audit_source:'server_verified',user_id:'gm',centralized_inventory_policy:config.policy,centralized_inventory_activation:config});
 await s.Warehouse.update('factory',{warehouse_type:'cold_room',is_active:true});
 await s.StockBalance.create({product_id:'product-a',product_name:'YOLA',warehouse_id:'factory',quantity:7,unit_cost:100,total_value:700,qc_status:'approved',expiry_date:'2099-01-01'});
 await s.StockBalance.create({product_id:'product-a',product_name:'YOLA',warehouse_id:'central-pool',quantity:2,unit_cost:90,total_value:180,qc_status:'approved',expiry_date:'2099-01-01'});
 f.rows.Warehouse.push({id:'foreign-custody',name:'Other employee stock',warehouse_type:'commercial_custody',custodian_employee_id:'other',is_active:true});
 await s.StockBalance.create({product_id:'product-a',warehouse_id:'foreign-custody',quantity:999,total_value:99900,unit_cost:100,qc_status:'approved'});
 return {...f,s,config};
}

test('a profile and the Inventory overview agree on central company quantities without exposing custody or carrying costs',async()=>{
 const f=await setup(),employee=await f.s.Employee.get('cashier'),before=structuredClone(f.rows);
 const snapshot=await employeeStockAction(f.client,user,{action:'employeeStockSnapshot'});
 assert.equal(snapshot.centralized_inventory.enabled,true);assert.equal(snapshot.products.find(p=>p.id==='product-a').available,9);
 assert.equal(snapshot.balances.reduce((sum,row)=>sum+row.quantity,0),9);assert.deepEqual(snapshot.runs,[]);
 assert.ok(snapshot.balances.every(row=>!('unit_cost'in row)&&!('total_value'in row)&&row.stock_kind==='company'));
 assert.ok(!JSON.stringify(snapshot).includes('foreign-custody'));
 const context={user,employee,role:'commercial'},overview=await inventoryOverview(context,f.s,{compact:true});
 assert.equal(overview.centralized_inventory.enabled,true);
 assert.equal(overview.balances.reduce((sum,row)=>sum+row.quantity,0),9);
 assert.ok(overview.balances.every(row=>!('unit_cost'in row)&&!('total_value'in row)));
 assert.deepEqual(f.rows,before);
 await assert.rejects(employeeStockAction(f.client,user,{action:'employeeStockSnapshot',employeeId:'other'}),/only your own/);
});

test('active centralized inventory rejects old issue, top-up and approval endpoints without creating records',async()=>{
 const f=await setup(),gm={id:'gm',role:'admin'},before=structuredClone(f.rows);
 for(const action of ['distributionIssueWorkspace','issueDistributionStock','recoverLegacyCustody'])await assert.rejects(distributionControlAction(f.client,gm,{action}),/centralized company stock/);
 for(const action of ['approveDispatchRequest','approveDispatch','loadDispatch'])await assert.rejects(dispatchAction(f.client,gm,{action,dispatchId:'run-a',requestId:'request'}),/centralized company stock/);
 assert.deepEqual(f.rows,before);
});

test('an inventory-only staff profile sees company stock without offering an unauthorized sale',async()=>{
 const f=await setup();await f.s.Employee.update('cashier',{role:'warehouse_manager'});
 f.client.auth.assertModule=async module=>{if(module!=='inventory')throw Object.assign(Error('Module access denied'),{status:403});};
 const snapshot=await employeeStockAction(f.client,user,{action:'employeeStockSnapshot'});
 assert.equal(snapshot.centralized_inventory.enabled,true);assert.equal(snapshot.can_record_sales,false);
 assert.equal(snapshot.products.find(row=>row.id==='product-a').available,9);
});

test('generic writes cannot enable, disable, forge or erase centralized inventory and giveaway evidence',()=>{
 const context={user:{id:'gm',role:'admin'},role:'admin'};
 for(const entity of ['CompanySettings','Warehouse','StockBalance','StockMovement','Dispatch','AuditLog'])for(const [operation,payload,existing] of [
  ['create',{central_inventory_pool:true},null],['update',{centralized_inventory:{enabled:true}},{id:'row'}],
  ['update',{name:'Detach evidence'},{id:'row',central_inventory_cutover_id:'CIA-proof'}],
  ['delete',{}, {id:'row',central_degustation_id:'CDG-proof'}],['create',{id:'CIA-forged'},null],
 ])assert.throws(()=>guardMutation(context,entity,operation,payload,existing),{status:403});
});

test('a protected virtual company pool can hold finished goods without being mistaken for misplaced physical Cold Room stock',()=>{
 const product={id:'product',inventory_type:'assembly'},pool={id:'pool',warehouse_type:'general',central_inventory_pool:true,is_active:true};
 assert.equal(finishedStorageAllowed(product,pool),true);
 assert.equal(finishedStorageAllowed(product,{...pool,central_inventory_pool:false}),false);
 assert.equal(finishedStorageAllowed(product,{...pool,custodian_employee_id:'agent'}),false);
 assert.deepEqual(finishedStockOutsideColdRoom([product],[pool],[{product_id:'product',warehouse_id:'pool',quantity:3}]),[]);
});

test('central reports are read-only and stock or customer ownership changes retain transaction boundaries',()=>{
 for(const action of ['centralDegustationWorkspace','centralDegustationHistory','customerCommissions'])assert.equal(isReadOnlyFunction('fieldOps',action),true);
 for(const action of ['recordCentralDegustation','assignCustomerAcquisition','employeeRecordSupply'])assert.equal(isReadOnlyFunction('fieldOps',action),false);
});
