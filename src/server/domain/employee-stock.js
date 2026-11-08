import {recordDegustation} from './degustation.js';
import {degustationHistory} from './degustation-stock.js';
import {requireStaff,today,round3,appropriatedDegustation} from './field-ops.js';
import {eligibleStockRecipient,STOCK_RECIPIENT_ROLES} from './employee-custody.js';
import {salesOrderAction} from './sales-orders.js';
import {commercialRunInventory,runManifest,supplyRun} from './commercial-runs.js';
import {dispatchReconciliationData} from './dispatch-operations.js';
import {finishedProduct} from './commercial-rules.js';
import {principalRole} from './roles.js';
import {stockUnit} from '../../lib/item-units.js';
import {readRecords} from './commercial-workspace.js';
const pick=(row,fields)=>Object.fromEntries(fields.split(' ').map(field=>[field,row?.[field]]));
const open=['loaded','in_transit'];
const productFields='id name sku image_url inventory_type category size flavor product_family storage_unit unit_of_measure sales_unit is_active configuration_status';
const positiveStock=row=>Number.isFinite(Number(row.quantity))&&Number(row.quantity)>0;

async function ownMonthlySales(stores,employee,user){
 const sales=await readRecords(stores.SalesOrder,{salesperson_id:employee.id,order_date:{$gte:today().slice(0,8)+'01'}});
 const ids=[...new Set(sales.map(s=>s.sales_supply_request_id).filter(Boolean))],events=[];
 for(let i=0;i<ids.length;i+=100)events.push(...await readRecords(stores.AuditLog,{id:{$in:ids.slice(i,i+100)}}));
 const evidence=new Map(events.map(event=>[event.id,event]));
 // The salesperson owns the sale even when management entered it. The checked
 // submission audit proves its source without granting that salesperson edits.
 return sales.filter(s=>{
  if(s.sales_supply_recorded_by===user.id&&s.dispatch_id)return true;
  const event=evidence.get(s.sales_supply_request_id);
  return s.sales_supply_recorded_at&&event?.action==='record_supplied_order'&&event.module==='sales_supply'&&event.audit_source==='server_verified'&&event.entity_type==='SalesOrder'&&event.entity_id===s.id&&event.user_id===s.sales_supply_recorded_by&&event.sales_supply_seller_id===employee.id&&event.sales_supply_payload&&event.sales_supply_invoice_id===(s.invoice_id||'')&&(s.supply_kind==='exchange'?s.status==='delivered'&&!s.invoice_id:s.status==='invoiced'&&!!s.invoice_id);
 }).map(s=>({id:s.id,order_number:s.order_number,customer_name:s.customer_name,order_date:s.order_date,total:s.total,payment_type:s.payment_type,status:s.status}));
}

// Viewing custody is separate from permission to supply it. A pending return,
// expired lot or inactive product must not make physically held goods disappear.
async function ownStockSnapshot(svc,employee){
 const s=svc.entities,date=today(),balances=[],rawBalances=[],locations=new Set(),legacy=[],driver=principalRole({role:'user'},employee)==='driver';
 const assigned=await readRecords(s.Dispatch,{status:{$in:open},$or:[{salesperson_id:employee.id},{driver_id:employee.id}]});
 for(const run of assigned)if(run.vehicle_warehouse_id)locations.add(run.vehicle_warehouse_id);
 const runs=[];
 for(const run of assigned){
  const view={...pick(run,'id dispatch_number dispatch_date status driver_id driver_name salesperson_id salesperson_name vehicle_id vehicle_name vehicle_warehouse_id route_id route_name'),pending_return:!!run.unsold_return_request_id,is_holder:run.salesperson_id===employee.id,is_paired_driver:run.driver_id===employee.id&&run.salesperson_id!==employee.id,can_supply:false,stock_error:'',rows:[]};
  const warnings=[];let manifest=new Map(),giveaway=new Map();
  if(!run.dispatch_date||run.dispatch_date>date)warnings.push('Choose an open delivery load already issued to you.');
  try{
   const [warehouse,vehicle,conflicts]=await Promise.all([
    s.Warehouse.get(run.vehicle_warehouse_id),run.vehicle_id?s.Vehicle.get(run.vehicle_id):null,
    readRecords(s.Dispatch,{status:{$in:open},$or:[{vehicle_warehouse_id:run.vehicle_warehouse_id},...(run.vehicle_id?[{vehicle_id:run.vehicle_id}]:[])]}),
   ]);
   // Do not reveal another employee's location if a saved assignment is corrupt.
   if(!warehouse||warehouse.id===run.warehouse_id||(run.vehicle_id?(!vehicle||vehicle.warehouse_id!==warehouse.id||warehouse.warehouse_type!=='vehicle'||warehouse.vehicle_id&&warehouse.vehicle_id!==vehicle.id):(warehouse.warehouse_type!=='commercial_custody'||!warehouse.employee_delivery_custody||warehouse.custodian_employee_id!==run.salesperson_id||warehouse.vehicle_id)))throw Error('The assigned stock location changed. Ask warehouse management to review this load.');
   if(conflicts.some(other=>other.id!==run.id))throw Error('More than one open load shares this stock. Ask warehouse management to reconcile the assignments.');
   locations.add(warehouse.id);
   view.stock_warehouse_id=warehouse.id;view.stock_warehouse_name=warehouse.name;
   const [stock,bins]=await Promise.all([
    readRecords(s.StockBalance,{warehouse_id:warehouse.id}),
    readRecords(s.Warehouse,run.vehicle_id?{vehicle_id:run.vehicle_id,field_return_bin:true,warehouse_type:'quarantine'}:{source_warehouse_id:warehouse.id,customer_supply_return_bin:true,warehouse_type:'quarantine'}),
   ]);
   if(stock.some(row=>!Number.isFinite(Number(row.quantity))||Number(row.quantity)<0))warnings.push('The stock quantities need management review.');
   try{
    const [remaining,reconciliation]=await Promise.all([runManifest(svc,run.id,warehouse.id),dispatchReconciliationData(svc,run)]);
    manifest=remaining;giveaway=new Map(reconciliation.rows.map(row=>[row.product_id,row.degustation_remaining]));
    view.rows=reconciliation.rows.map(row=>({...pick(row,'product_id product_name loaded replaced returned expected variance degustation_allocated degustation_given degustation_returned degustation_remaining'),on_hand:row.actual,supplied:round3(row.consumed-row.replaced-row.degustation_given)}));
    if(reconciliation.degustationAppropriation)view.degustation_appropriation=pick(reconciliation.degustationAppropriation,'id date total_quantity remaining_quantity');
    view.has_variance=reconciliation.hasVariance;
    if(reconciliation.hasVariance)warnings.push('The recorded load and current stock differ. Ask warehouse management to review the difference.');
   }catch(error){warnings.push(error.message);}
   for(const row of stock)if(positiveStock(row))rawBalances.push({row,kind:'issued',run:view,manifest,giveaway,warehouse});
   for(const bin of bins){
    const collected=await readRecords(s.StockBalance,{warehouse_id:bin.id});
    if(collected.some(row=>!Number.isFinite(Number(row.quantity))||Number(row.quantity)<0))warnings.push('The stock quantities need management review.');
    for(const row of collected)if(positiveStock(row))rawBalances.push({row,kind:'customer_return',run:view,warehouse:bin});
   }
   if(view.is_holder&&!driver&&!view.pending_return)try{await supplyRun(svc,employee.id,run.id,date,true);view.can_supply=!warnings.length;}catch(error){warnings.push(error.message);}
  }catch(error){warnings.push(error.message);}
  view.stock_warnings=[...new Set(warnings)];view.stock_error=view.stock_warnings[0]||'';runs.push(view);
 }
 // Old/unassigned personal custody is visible only to its recorded custodian.
 for(const warehouse of await readRecords(s.Warehouse,{warehouse_type:'commercial_custody',custodian_employee_id:employee.id})){
  if(locations.has(warehouse.id))continue;
  const stock=await readRecords(s.StockBalance,{warehouse_id:warehouse.id});
  const positive=stock.filter(positiveStock);
  const invalid=stock.some(row=>!Number.isFinite(Number(row.quantity))||Number(row.quantity)<0);
  if(!positive.length&&!invalid)continue;
  legacy.push({...pick(warehouse,'id name'),stock_error:invalid?'The stock quantities need management review.':'These goods need warehouse review before they can be supplied or returned.'});
  for(const row of positive)rawBalances.push({row,kind:'legacy',warehouse});
 }
 const ids=[...new Set([...rawBalances.map(({row})=>row.product_id),...runs.flatMap(run=>run.rows.map(row=>row.product_id))])],products=[];
 for(let i=0;i<ids.length;i+=100)products.push(...await readRecords(s.Product,{id:{$in:ids.slice(i,i+100)}}));
 const byId=new Map(products.map(product=>[product.id,product])),saleRemaining=new Map(),giveRemaining=new Map(),seenBalances=new Set();
 for(const entry of rawBalances.sort((a,b)=>String(a.row.expiry_date||'9999-12-31').localeCompare(String(b.row.expiry_date||'9999-12-31')))){
  const {row,kind,run,warehouse}=entry,product=byId.get(row.product_id),quantity=round3(row.quantity),key=run?.id+':'+row.product_id;
  if(seenBalances.has(row.id))continue;seenBalances.add(row.id);
  let usable=0,degustation=0;const appropriation=appropriatedDegustation(row);
  if(appropriation){
   if(kind!=='issued'||appropriation.dispatch_id!==run?.id)throw Error('Reconcile the expensed Dégustation custody quantities and original costs before moving this stock.');
   degustation=quantity;
  }else if(kind==='issued'&&finishedProduct(product)&&product.is_active!==false&&!product.item_removed_at&&product.configuration_status!=='draft'&&(row.qc_status||'approved')==='approved'&&(!row.expiry_date||row.expiry_date>=date)){
   if(!saleRemaining.has(key))saleRemaining.set(key,Math.max(0,entry.manifest.get(row.product_id)||0));
   if(!giveRemaining.has(key))giveRemaining.set(key,Math.max(0,entry.giveaway.get(row.product_id)||0));
   usable=Math.min(quantity,saleRemaining.get(key));saleRemaining.set(key,round3(saleRemaining.get(key)-usable));
   degustation=Math.min(round3(quantity-usable),giveRemaining.get(key));giveRemaining.set(key,round3(giveRemaining.get(key)-degustation));
  }
  balances.push({...pick(row,'id warehouse_id product_id qc_status expiry_date lot_number'),warehouse_name:warehouse.name,quantity,usable_quantity:usable,degustation_quantity:degustation,degustation_expensed_quantity:appropriation?quantity:0,held_quantity:round3(quantity-usable-degustation),dispatch_id:run?.id||'',stock_kind:kind});
  if(!product)byId.set(row.product_id,{id:row.product_id,name:row.product_name||'Unregistered product',is_active:false});
 }
 return {runs,balances,products:[...byId.values()].map(product=>({...pick(product,productFields),unit:stockUnit(product)})),legacy,employeeName:employee.full_name,employee:pick(employee,'id full_name'),date,updated_at:new Date().toISOString()};
}

export const EMPLOYEE_STOCK_ACTIONS=['recordDegustation','degustationWorkspace','employeeStockSnapshot','employeeStockWorkspace','employeeSalesWorkspace','employeeSalesStock','employeeSalesDeliveryPoints','employeeRecordSupply'];
export async function employeeStockAction(client,user,body){
 const {employee}=await requireStaff(client,user,STOCK_RECIPIENT_ROLES,'your issued stock');
 if(!eligibleStockRecipient(employee))throw Error('An active employee other than Hotesse is required.');
 if(['employeeStockSnapshot','employeeStockWorkspace'].includes(body.action)&&['employeeId','commercialId','driverId'].some(key=>body[key]&&body[key]!==employee.id))throw Error('You can access only your own inventory');
 if(body.action==='employeeStockSnapshot')return ownStockSnapshot(client.asServiceRole,employee);
 if(body.action==='recordDegustation')return recordDegustation(client.asServiceRole,user,employee,body);
 if(body.action==='degustationWorkspace'){
   const [stock,customers]=await Promise.all([commercialRunInventory(client.asServiceRole,employee.id,today()),readRecords(client.asServiceRole.entities.Customer,{is_active:true})]);
   return {...stock,customers:customers.filter(c=>!c.customer_removed_at).map(c=>({id:c.id,business_name:c.business_name}))};
 }
 if(body.action==='employeeStockWorkspace'){
   const [stock,sales]=await Promise.all([ownStockSnapshot(client.asServiceRole,employee),ownMonthlySales(client.asServiceRole.entities,employee,user)]);
   const movements=await readRecords(client.asServiceRole.entities.StockMovement,{document_type:'Degustation',employee_id:employee.id,movement_date:{$gte:today().slice(0,8)+'01'},status:'approved'});
   return {...stock,degustations:degustationHistory(movements,{costs:false}),sales,employeeName:employee.full_name};
 }
 const action={employeeSalesWorkspace:'salesOrderWorkspace',employeeSalesStock:'salesOrderStock',employeeSalesDeliveryPoints:'salesOrderDeliveryPoints',employeeRecordSupply:'recordSuppliedOrder'}[body.action];
 if(!action)throw Error('Unknown employee stock action');
 return salesOrderAction(client,user,{...body,action},{ownIssuedStock:true});
}
