import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,user,date} from './helpers/commercial-supply.mjs';
import {employeeStockAction} from '../src/server/domain/employee-stock.js';
import {FEATURE_AUTHORITY} from '../src/server/domain/roles.js';
import {functionRoute, request} from './helpers/cashier.mjs';
import {isReadOnlyFunction} from '../src/lib/function-actions.js';

const roles=['admin','procurement','warehouse_manager','cashier','production_manager','employee','commercial','driver'];

test('the HTTP stock overview uses one consistent private snapshot without mutating records', async()=>{
 const f=fixture(), before=JSON.stringify(f.tables);let snapshots=0;
 globalThis.__cashierClient=f.client;
 globalThis.__cashierTransaction=async load=>{snapshots++;return load();};
 try{
  const route=await functionRoute(), response=await route(request({action:'employeeStockSnapshot'}),{params:Promise.resolve({name:'fieldOps'})});
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).employee.id,'agent-a');
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal(snapshots,1);assert.equal(JSON.stringify(f.tables),before);
  assert.equal(isReadOnlyFunction('fieldOps','employeeStockSnapshot'),true);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;}
});
function setup({personal=false}={}){
  const f=fixture(),{tables}=f;
  if(personal){
    Object.assign(tables.Dispatch[0],{vehicle_id:'',vehicle_name:'',driver_id:'',driver_name:'',vehicle_warehouse_id:'personal-stock'});
    tables.Warehouse.push({id:'personal-stock',name:'Agent issued goods',warehouse_type:'commercial_custody',custodian_employee_id:'agent-a',employee_delivery_custody:true,is_active:true});
    tables.StockBalance[0].warehouse_id='personal-stock';
  }
  return {...f,read:(body={},actor=user)=>employeeStockAction(f.client,actor,{action:'employeeStockSnapshot',...body})};
}
const issued=result=>result.balances.filter(row=>row.stock_kind==='issued');
const total=(rows,key='quantity')=>rows.reduce((sum,row)=>sum+Number(row[key]||0),0);
const sensitive=new Set(['unit_cost','total_value','loaded_value','current_cost','salary','journal_id','totalSales','cashSales','creditSales','degustationCost']);
function noSensitiveFields(value){
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){assert.ok(!sensitive.has(key),'Sensitive field: '+key);noSensitiveFields(child);}
}

test('all eligible holder roles see actual goods without a vehicle and receive no stock costs',async()=>{
  for(const role of roles){
    const f=setup({personal:true});f.tables.Employee[0].role=role;
    Object.assign(f.tables.Employee[0],{salary:900000});Object.assign(f.tables.Product[0],{current_cost:200,product_family:'Yogurt',size:'500 g',flavor:'Vanilla'});
    Object.assign(f.tables.DispatchLine[0],{unit_cost:200,loaded_value:2000});
    const result=await f.read();
    assert.equal(result.employee.id,'agent-a');assert.equal(result.employeeName,'Agent A');assert.equal(result.date,date);assert.ok(Number.isFinite(Date.parse(result.updated_at)));
    assert.equal(total(issued(result)),10);assert.equal(total(issued(result),'usable_quantity'),10);
    assert.equal(result.runs[0].vehicle_id,'');assert.equal(result.runs[0].is_holder,true);assert.equal(result.runs[0].can_supply,role!=='driver');
    assert.deepEqual([result.products[0].product_family,result.products[0].size,result.products[0].flavor],['Yogurt','500 g','Vanilla']);
    assert.equal(total(result.balances.filter(row=>row.stock_kind==='legacy')),50);noSensitiveFields(result);
  }
});

test('paired drivers view only their assigned load without inheriting holder sales or legacy custody',async()=>{
  for(const personal of [false,true]){
    const f=setup({personal});f.tables.Dispatch[0].driver_id='driver-a';f.client.auth.staff=async()=>f.tables.Employee[1];
    f.tables.Dispatch.push({...f.tables.Dispatch[0],id:'foreign-run',driver_id:'foreign-driver',salesperson_id:'foreign-agent',vehicle_id:'foreign-vehicle',vehicle_warehouse_id:'foreign-stock'});
    f.tables.StockBalance.push({id:'foreign-balance',warehouse_id:'foreign-stock',product_id:'private-product',quantity:999});
    const result=await f.read({}, {id:'driver-login',role:'user'});
    assert.deepEqual(result.runs.map(row=>row.id),['run-a']);assert.equal(result.runs[0].is_paired_driver,true);assert.equal(result.runs[0].is_holder,false);assert.equal(result.runs[0].can_supply,false);
    assert.equal(total(result.balances),10);assert.deepEqual(result.legacy,[]);assert.doesNotMatch(JSON.stringify(result),/foreign-|private-product|LEGACY/);noSensitiveFields(result);
  }
});

test('own stock rejects identity overrides, inactive holders and unlinked administrators',async()=>{
  for(const action of ['employeeStockSnapshot','employeeStockWorkspace'])for(const key of ['employeeId','commercialId','driverId']){
    const f=setup();await assert.rejects(f.read({action,[key]:'another-employee'}),/only your own inventory/);
    await assert.rejects(f.read({action,[key]:'another-employee'},{id:user.id,role:'admin'}),/only your own inventory/);
  }
  for(const change of [{role:'hotesse'},{status:'inactive'},{employee_removed_at:'2020-01-01'}]){
    const f=setup();Object.assign(f.tables.Employee[0],change);await assert.rejects(f.read(),/Not permitted|active employee/);
  }
  const f=setup();f.client.entities.Employee.filter=async()=>[];
  await assert.rejects(f.read({}, {id:'unlinked-gm',role:'admin'}),/active employee/);
});

test('custom staff templates preserve holder access and never turn a Hotesse template into a holder',async()=>{
  const f=setup({personal:true});
  f.tables.CompanySettings[0].staff_role_catalogue={roles:{delivery_clerk:{key:'delivery_clerk',template_role:'procurement',label:'Delivery clerk',modules:[]},retail_host:{key:'retail_host',template_role:'hotesse',label:'Retail host',modules:['outlets']}}};
  Object.assign(f.tables.Employee[0],{role:'delivery_clerk',access_template:'procurement',role_label:'Delivery clerk'});f.client.auth.staff=async()=>f.tables.Employee[0];
  const result=await f.read();assert.equal(total(issued(result)),10);assert.equal(result.runs[0].can_supply,true);
  Object.assign(f.tables.Employee[0],{role:'retail_host',access_template:'hotesse',role_label:'Retail host'});
  for(const actor of [{id:user.id,role:'admin'},{...user,[FEATURE_AUTHORITY]:{module:'distribution',role:'admin'}}])await assert.rejects(f.read({},actor),/active employee/);
});

test('pending returns preserve physical and giveaway quantities while stock supply stays disabled',async()=>{
  const f=setup({personal:true});f.tables.DispatchLine[0].degustation_quantity=2;
  const before=await f.read();f.tables.Dispatch[0].unsold_return_request_id='pending-return';
  const pending=await f.read();assert.equal(pending.runs[0].pending_return,true);assert.equal(pending.runs[0].can_supply,false);
  assert.deepEqual(issued(pending),issued(before));assert.equal(total(issued(pending)),10);assert.equal(total(issued(pending),'usable_quantity'),8);assert.equal(total(issued(pending),'degustation_quantity'),2);
  f.tables.StockBalance[0].quantity=0;f.tables.Dispatch[0].status='returned';
  const received=await f.read();assert.deepEqual(received.runs,[]);assert.deepEqual(issued(received),[]);
});

test('paid supplies, replacements and giveaways reduce the same physical load once and remain distinct',async()=>{
  const f=setup(),{tables}=f;tables.DispatchLine[0].degustation_quantity=2;tables.StockBalance[0].quantity=4;
  tables.FieldSale.push({id:'sale',dispatch_id:'run-a',status:'approved_posted'});tables.FieldSaleLine.push({id:'sale-line',field_sale_id:'sale',product_id:'product-a',quantity:3});
  tables.StockMovement.push(
    {id:'paid',document_type:'FieldSale',document_id:'sale',source_warehouse_id:'van-stock',product_id:'product-a',movement_type:'field_delivery',quantity:3,status:'approved'},
    {id:'paid-receipt',document_type:'FieldSale',document_id:'sale',destination_warehouse_id:'pending',product_id:'product-a',movement_type:'field_delivery',quantity:3,status:'approved'},
    {id:'other-sale',document_type:'FieldSale',document_id:'unrelated-sale',source_warehouse_id:'van-stock',product_id:'product-a',movement_type:'field_delivery',quantity:100,status:'approved'},
    {id:'replacement',document_type:'SpoilageRecord',document_id:'replacement',dispatch_id:'run-a',source_warehouse_id:'van-stock',product_id:'product-a',movement_type:'promotional_issue',quantity:2,status:'approved'},
    {id:'giveaway',document_type:'Degustation',document_id:'giveaway',dispatch_id:'run-a',source_warehouse_id:'van-stock',product_id:'product-a',movement_type:'promotional_issue',quantity:1,status:'approved'},
  );
  const result=await f.read(),row=issued(result)[0],runRow=result.runs[0].rows[0];
  assert.deepEqual([row.quantity,row.usable_quantity,row.degustation_quantity,row.held_quantity],[4,3,1,0]);
  assert.deepEqual([runRow.loaded,runRow.supplied,runRow.replaced,runRow.degustation_given,runRow.on_hand],[10,3,2,1,4]);assert.equal(result.runs[0].has_variance,false);noSensitiveFields(result);
});

test('inactive, expired, quarantined and unallocated goods stay visible as held stock',async()=>{
  for(const scenario of ['inactive','expired','quarantined','unallocated','missing-product']){
    const f=setup();
    if(scenario==='inactive')f.tables.Product[0].is_active=false;
    if(scenario==='expired')f.tables.StockBalance[0].expiry_date='2000-01-01';
    if(scenario==='quarantined')f.tables.StockBalance[0].qc_status='quarantine';
    if(scenario==='unallocated')f.tables.DispatchLine[0].loaded_quantity=0;
    if(scenario==='missing-product')f.tables.Product.length=0;
    const result=await f.read(),row=issued(result)[0];assert.equal(row.quantity,10,scenario);assert.equal(row.usable_quantity,0,scenario);assert.equal(row.held_quantity,10,scenario);
    assert.ok(result.products.some(product=>product.id==='product-a'));
    if(scenario==='unallocated'){assert.equal(result.runs[0].can_supply,false);assert.match(result.runs[0].stock_error,/current stock differ/);}
  }
});

test('actual return-bin packaging and legacy goods are held separately and foreign custody is excluded',async()=>{
  for(const personal of [false,true]){
    const f=setup({personal}),{tables}=f,source=tables.Dispatch[0].vehicle_warehouse_id;
    tables.Product.push({id:'cups',name:'Recovered cups',inventory_type:'packaging',storage_unit:'ea',current_cost:900});
    tables.Warehouse.push({id:'own-bin',name:'Return bin',warehouse_type:'quarantine',field_return_bin:true,customer_supply_return_bin:true,...(personal?{source_warehouse_id:source}:{vehicle_id:'vehicle-a'})},{id:'foreign-bin',name:'Private bin',warehouse_type:'quarantine',field_return_bin:true,customer_supply_return_bin:true,vehicle_id:'foreign-vehicle',source_warehouse_id:'foreign-stock'},{id:'foreign-legacy',warehouse_type:'commercial_custody',custodian_employee_id:'foreign-agent'});
    tables.StockBalance.push({id:'returned-cups',warehouse_id:'own-bin',product_id:'cups',quantity:3,qc_status:'quarantine',lot_number:'RECOVERY-LOT',total_value:0,inventory_recovery_id:'PRIVATE-RECOVERY-METADATA'},{id:'foreign-return',warehouse_id:'foreign-bin',product_id:'cups',quantity:999},{id:'foreign-legacy-stock',warehouse_id:'foreign-legacy',product_id:'cups',quantity:999});
    tables.SpoilageRecord.push({id:'original-collection',dispatch_id:'run-a',record_type:'field_expired_return',collection_warehouse_id:'own-bin',product_id:'product-a',quantity:1000});
    const result=await f.read(),returned=result.balances.filter(row=>row.stock_kind==='customer_return'),legacy=result.balances.filter(row=>row.stock_kind==='legacy');
    assert.equal(returned.length,1);assert.deepEqual([returned[0].product_id,returned[0].quantity,returned[0].usable_quantity,returned[0].held_quantity],['cups',3,0,3]);
    assert.equal(total(legacy),50);assert.equal(total(legacy,'usable_quantity'),0);assert.ok(result.legacy[0].stock_error);assert.doesNotMatch(JSON.stringify(result),/foreign-|Private bin|PRIVATE-RECOVERY-METADATA/);noSensitiveFields(result);
  }
});

test('conflicting sources cannot reappear as legacy stock and malformed legacy quantities remain flagged',async()=>{
  const f=setup({personal:true});f.tables.Dispatch.push({...f.tables.Dispatch[0],id:'other-run',salesperson_id:'another-holder'});
  const result=await f.read();assert.match(result.runs[0].stock_error,/shares this stock/);assert.equal(issued(result).length,0);assert.ok(result.balances.every(row=>row.warehouse_id!=='personal-stock'));assert.ok(result.legacy.every(row=>row.id!=='personal-stock'));
  for(const quantity of [-2,'invalid']){
    const invalid=setup();invalid.tables.StockBalance.find(row=>row.id==='legacy-custody').quantity=quantity;
    const report=await invalid.read();assert.match(report.legacy.find(row=>row.id==='custody').stock_error,/quantities need management review/);assert.ok(report.balances.every(row=>row.id!=='legacy-custody'));
  }
});

test('a return lot referenced by overlapping bin metadata is counted only once',async()=>{
  const f=setup(),{tables}=f;
  tables.Dispatch.push({...tables.Dispatch[0],id:'personal-run',vehicle_id:'',driver_id:'',vehicle_warehouse_id:'personal-stock'});
  tables.DispatchLine.push({id:'personal-load',dispatch_id:'personal-run',product_id:'product-a',loaded_quantity:5});
  tables.Warehouse.push({id:'personal-stock',warehouse_type:'commercial_custody',employee_delivery_custody:true,custodian_employee_id:'agent-a'},{id:'shared-bin',warehouse_type:'quarantine',field_return_bin:true,customer_supply_return_bin:true,vehicle_id:'vehicle-a',source_warehouse_id:'personal-stock'});
  tables.StockBalance.push({id:'personal-lot',warehouse_id:'personal-stock',product_id:'product-a',quantity:5,qc_status:'approved'},{id:'shared-return-lot',warehouse_id:'shared-bin',product_id:'product-a',quantity:3,qc_status:'quarantine'});
  const result=await f.read();assert.equal(total(result.balances.filter(row=>row.stock_kind==='customer_return')),3);assert.equal(result.balances.filter(row=>row.id==='shared-return-lot').length,1);assert.equal(new Set(result.balances.map(row=>row.id)).size,result.balances.length);
});

test('missing and future issue dates keep actual holdings visible with an operational warning',async()=>{
  for(const dispatch_date of ['', '9999-12-31']){
    const f=setup({personal:true});f.tables.Dispatch[0].dispatch_date=dispatch_date;
    const result=await f.read();assert.equal(total(issued(result)),10);assert.equal(result.runs[0].can_supply,false);assert.match(result.runs[0].stock_error,/already issued/);
  }
});

test('the dashboard snapshot performs no writes or monthly sales and giveaway-history scans',async()=>{
  const f=setup(),before=structuredClone(f.tables),stores=f.client.asServiceRole.entities;
  for(const entity of Object.values(stores))for(const method of ['create','update','bulkCreate','upsert','updateMany','deleteMany'])entity[method]=()=>{throw Error('Snapshot must not write');};
  for(const name of ['SalesOrder','StockMovement']){
    const filter=stores[name].filter;stores[name].filter=(query,...args)=>{assert.equal('sales_supply_recorded_by' in query,false);assert.equal('employee_id' in query,false);return filter(query,...args);};
  }
  const result=await f.read();assert.equal(total(issued(result)),10);assert.equal('sales' in result,false);assert.equal('degustations' in result,false);assert.deepEqual(f.tables,before);
});
