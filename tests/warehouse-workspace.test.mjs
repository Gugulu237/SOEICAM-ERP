import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWarehouseDefinition } from '../src/server/domain/warehouse-definition.js';
import { warehouseTransfer } from '../src/server/domain/warehouse-transfer.js';
import { warehouseMovements,movementFilters } from '../src/server/domain/warehouse-movements.js';
import { guardMutation } from '../src/server/access.js';
import { csvText,movementEndpoint,warehouseSnapshot } from '../src/lib/warehouse-workspace.js';

const admin={role:'admin',user:{id:'gm',email:'gm@example.test',role:'admin'}};
const context=role => ({role,user:{id:role,role:'user'},employee:{id:role,role,status:'active',allowed_modules:['inventory']}});
const warehouse={id:'from',name:'Main store',code:'MAIN',warehouse_type:'finished_goods',is_active:true};
function matches(row,query={}) {
  return Object.entries(query).every(([key,value]) => {
    if(key==='$and')return value.every(q=>matches(row,q));
    if(key==='$or')return value.some(q=>matches(row,q));
    if(value && typeof value==='object')return Object.entries(value).every(([op,arg])=>({$in:()=>arg.includes(row[key]),$nin:()=>!arg.includes(row[key]),$ne:()=>row[key]!==arg,$gt:()=>row[key]>arg,$gte:()=>row[key]>=arg,$lte:()=>row[key]<=arg})[op]());
    return row[key]===value;
  });
}
function fixture(extra={}) {
  const rows={Warehouse:[{...warehouse},{id:'to',name:'Cold room',code:'COLD',warehouse_type:'cold_room',is_active:true}],Product:[{id:'product',name:'Yoghurt',inventory_type:'assembly',is_active:true}],StockBalance:[{id:'stock',warehouse_id:'from',product_id:'product',lot_number:'LOT-1',production_order_id:'production',expiry_date:'2099-01-01',quantity:10,unit_cost:2,total_value:20,qc_status:'approved'}],StockMovement:[],AuditLog:[],Branch:[],Dispatch:[],DispatchRequest:[],Vehicle:[],ProductionOrder:[],PurchaseOrder:[],...extra};
  const stores={},writes=[],reads=[];
  for(const [name,items] of Object.entries(rows)) stores[name]={
    get:async id=>items.find(row=>row.id===id),
    filter:async(query={},sort,limit=200,skip=0)=>{reads.push(name);const filtered=items.filter(row=>matches(row,query));if(sort&&typeof sort==='object'){const selected=filtered.slice(sort.skip||0,(sort.skip||0)+sort.limit);return {items:selected,total:filtered.length,has_more:(sort.skip||0)+selected.length<filtered.length};}return filtered.slice(skip,skip+limit);},
    create:async value=>{const row={id:name+'-'+items.length,...value};items.push(row);writes.push(name);return row;},
    update:async(id,value)=>{const row=items.find(row=>row.id===id);Object.assign(row,value);writes.push(name);return row;},
    aggregate:async({query,groupBy,sum})=>{const grouped=new Map();for(const row of items.filter(row=>matches(row,query))){const key=JSON.stringify(groupBy.map(k=>row[k]));const group=grouped.get(key)||{...Object.fromEntries(groupBy.map(k=>[k,row[k]])),count:0,...Object.fromEntries(sum.map(k=>['sum_'+k,0]))};group.count++;for(const field of sum)group['sum_'+field]+=Number(row[field]||0);grouped.set(key,group);}return {rows:[...grouped.values()]};},
  };
  return {rows,stores,writes,reads};
}
const transfer={productId:'product',fromWarehouseId:'from',toWarehouseId:'to',quantity:3,movementDate:'2026-10-19',requestKey:'11111111-1111-4111-8111-111111111111',reason:'Rebalance cold stock'};

test('warehouse management permissions preserve read-only and field-role boundaries',()=>{
  for(const role of ['warehouse_manager','production_manager'])assert.doesNotThrow(()=>guardMutation(context(role),'Warehouse','update',{name:'New name'},warehouse));
  for(const role of ['employee','procurement','driver','commercial'])assert.throws(()=>guardMutation(context(role),'Warehouse','update',{name:'New name'},warehouse));
  assert.throws(()=>guardMutation(admin,'Warehouse','delete',{},warehouse),/inactive/);
  const restricted=context('warehouse_manager');restricted.employee.allowed_modules=['distribution'];
  assert.throws(()=>guardMutation(restricted,'Warehouse','update',{name:'New name'},warehouse),/Inventory/);
});
test('warehouse renaming retains records; types and deactivation reject remaining stock',async()=>{
  const f=fixture();
  const saved=await prepareWarehouseDefinition(f.stores,{name:'New main store'},warehouse);
  assert.equal(saved.name,'New main store');assert.equal(saved.code,'MAIN');assert.deepEqual(f.writes,[]);
  await assert.rejects(prepareWarehouseDefinition(f.stores,{is_active:false},warehouse),/remaining stock/);
  await assert.rejects(prepareWarehouseDefinition(f.stores,{warehouse_type:'general'},warehouse),/remaining stock/);
  await assert.rejects(prepareWarehouseDefinition(f.stores,{name:'Other',code:'cold',warehouse_type:'general'}),/already in use/);
  await assert.rejects(prepareWarehouseDefinition(f.stores,{id:'forged',name:'Other'},warehouse),/Only warehouse details/);
});
test('empty warehouses with open operations cannot be retired; closed empty stores can',async()=>{
  const f=fixture({StockBalance:[],Dispatch:[{id:'run',warehouse_id:'from',status:'loaded'}]});
  await assert.rejects(prepareWarehouseDefinition(f.stores,{is_active:false},warehouse),/open deliveries/);
  f.rows.Dispatch[0].status='completed';
  assert.equal((await prepareWarehouseDefinition(f.stores,{is_active:false},warehouse)).is_active,false);
  f.rows.Vehicle.push({id:'van',warehouse_id:'from',is_active:true});
  await assert.rejects(prepareWarehouseDefinition(f.stores,{is_active:false},warehouse),/vehicle links/);
});
test('linked vehicle and legacy custody types cannot be reassigned through warehouse settings',async()=>{
  const f=fixture({StockBalance:[]});
  await assert.rejects(prepareWarehouseDefinition(f.stores,{warehouse_type:'vehicle'},warehouse),/Distribution/);
  await assert.rejects(prepareWarehouseDefinition(f.stores,{is_active:false},{...warehouse,warehouse_type:'vehicle'}),/Distribution/);
  assert.equal((await prepareWarehouseDefinition(f.stores,{address:'Parking bay'},{...warehouse,warehouse_type:'vehicle'})).address,'Parking bay');
});
test('manual transfer moves stock and cost once, preserving batch and production provenance',async()=>{
  const f=fixture();
  const result=await warehouseTransfer(admin,f.stores,transfer);
  assert.equal(result.quantity,3);assert.equal(result.totalValue,6);
  assert.equal(f.rows.StockBalance[0].quantity,7);assert.equal(f.rows.StockBalance[1].quantity,3);
  assert.equal(f.rows.StockBalance[1].production_order_id,'production');assert.equal(f.rows.StockBalance[1].lot_number,'LOT-1');
  assert.equal(f.rows.StockBalance.reduce((n,r)=>n+r.total_value,0),20);
  assert.equal(f.rows.StockMovement.length,1);assert.equal(f.rows.StockMovement[0].source_warehouse_id,'from');assert.equal(f.rows.StockMovement[0].destination_warehouse_id,'to');
  const writes=f.writes.length;
  assert.equal((await warehouseTransfer(admin,f.stores,transfer)).reused,true);assert.equal(f.writes.length,writes);
  await assert.rejects(warehouseTransfer(admin,f.stores,{...transfer,quantity:4}),/different details/);
});
test('transfers reject unauthorized staff, shortage, inactive and vehicle stores before changing stock',async()=>{
  const f=fixture();
  await assert.rejects(warehouseTransfer(context('employee'),f.stores,transfer),/management/);
  await assert.rejects(warehouseTransfer(admin,f.stores,{...transfer,quantity:11}),/Insufficient/);
  f.rows.Warehouse[1].is_active=false;
  await assert.rejects(warehouseTransfer(admin,f.stores,transfer),/active warehouses/);
  f.rows.Warehouse[1].is_active=true;f.rows.Warehouse[1].warehouse_type='vehicle';
  await assert.rejects(warehouseTransfer(admin,f.stores,transfer),/Distribution/);
  assert.deepEqual(f.writes,[]);
});
test('expired or held stock can move only to isolation and never gains approved QC',async()=>{
  const f=fixture();f.rows.StockBalance[0].expiry_date='2020-01-01';
  await assert.rejects(warehouseTransfer(admin,f.stores,transfer),/Insufficient/);
  f.rows.Warehouse[1].warehouse_type='quarantine';
  await warehouseTransfer(admin,f.stores,transfer);
  assert.equal(f.rows.StockBalance[1].qc_status,'quarantine');assert.equal(f.rows.StockBalance[1].expiry_date,'2020-01-01');
});
test('movement reporting pages all matching records, excludes reversed counts and avoids double-counting same-location QC',async()=>{
  const movement={movement_date:'2026-10-19',product_id:'product',product_name:'Yoghurt',quantity:1,total_value:2,status:'approved',movement_type:'warehouse_transfer',source_warehouse_id:'from',destination_warehouse_id:'to'};
  const f=fixture({StockMovement:[...Array.from({length:81},(_,n)=>({...movement,id:'move-'+n})),{...movement,id:'quality',destination_warehouse_id:'from',movement_type:'quality_release'},{...movement,id:'reversed',status:'reversed'},{...movement,id:'outside',movement_date:'2020-01-01'}]});
  const input={from:'2026-10-01',to:'2026-10-19',warehouse:'from',status:'all',page:'2'};
  const result=await warehouseMovements(admin,f.stores,input);
  assert.equal(result.rows.length,40);assert.equal(result.total,83);assert.equal(result.hasMore,true);
  assert.equal(result.summary.approved,82);assert.equal(result.summary.transfers,81);assert.equal(result.summary.outgoing,81);assert.equal(result.summary.incoming,0);
  const exported=await warehouseMovements(admin,f.stores,{...input,export:'1'});assert.equal(exported.rows.length,83);
  await assert.rejects(warehouseMovements(context('driver'),f.stores,input));
});
test('report filters validate dates and exports never silently truncate or leak transfer metadata',async()=>{
  assert.throws(()=>movementFilters({from:'2026-02-30',to:'2026-10-19'}),/valid/);
  assert.throws(()=>movementFilters({from:'2026-10-19',to:'2026-01-01'}),/valid/);
  const f=fixture({StockMovement:Array.from({length:10001},(_,i)=>({id:String(i),movement_date:'2026-10-19',status:'approved',warehouse_transfer_payload:'private'}))});
  await assert.rejects(warehouseMovements(admin,f.stores,{from:'2026-10-01',to:'2026-10-19',export:'1'}),/10,000/);
  f.rows.StockMovement.pop();const report=await warehouseMovements(admin,f.stores,{from:'2026-10-01',to:'2026-10-19',export:'1'});
  assert.equal(report.rows.length,10000);assert.equal(report.rows[0].warehouse_transfer_payload,undefined);
});
test('warehouse snapshots keep units separate; historical endpoints are not invented; CSV formulas are neutralized',()=>{
  const snapshot=warehouseSnapshot(warehouse,[{warehouse_id:'from',product_id:'a',quantity:2,total_value:10},{warehouse_id:'from',product_id:'b',quantity:900,total_value:20}]);
  assert.equal(snapshot.products,2);assert.equal(snapshot.value,30);assert.equal(snapshot.quantity,undefined);
  assert.equal(movementEndpoint({movement_type:'warehouse_transfer'},'to',[]),'Destination not recorded');
  assert.match(csvText([['=formula','a"b',-2]]),/"'=formula","a""b","-2"/);
});
