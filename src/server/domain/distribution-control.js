import {requireStaff,round2,round3,today,audit,stockTransfer} from './field-ops.js';
import {readRecords} from './commercial-workspace.js';
import {dispatchAction,dispatchReconciliationData} from './dispatch-operations.js';
import {finishedProduct,periodDates,validateCustodyLines} from './commercial-rules.js';
import {normalizeRole} from './roles.js';
import {stockUnit} from '../../lib/item-units.js';
import {DISPATCH_MANAGER_ROLES} from '../../lib/operations-access.js';

export const DISTRIBUTION_ACTIONS=['distributionControl','distributionIssueWorkspace','issueDistributionStock','closeDistributionRun','recoverLegacyCustody'];
const pick=(row,fields)=>Object.fromEntries(fields.split(' ').map(key=>[key,row?.[key]]));
const open=['loaded','in_transit'];
const storage=['finished_goods','cold_room','general'];
async function byIds(entity,field,ids){const unique=[...new Set(ids)].filter(Boolean),result=[];for(let i=0;i<unique.length;i+=100)result.push(...await readRecords(entity,{[field]:{$in:unique.slice(i,i+100)}}));return result;}
const keyOf=(user,body)=>{if(!/^[a-f\d-]{36}$/i.test(body.requestKey || ''))throw Error('Reopen the stock form for a valid request reference');return user.id+':'+body.requestKey;};

// Reconciliation reuses the same checked engine as the run detail. This small
// read-only snapshot adapter avoids one set of database reads per agent/run.
function snapshotStores(tables){return {entities:Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,{filter:async(query={},_sort,limit=200,offset=0)=>rows.filter(row=>Object.entries(query).every(([key,value])=>value&&typeof value==='object'&&'$in' in value?value.$in.includes(row[key]):row[key]===value)).slice(offset,offset+limit)}]))};}

async function overview(svc,date){
  const s=svc.entities;
  const [staff,vehicles,warehouses,products,allOpen,daySales,acquisitions,dayOrders]=await Promise.all([
    readRecords(s.Employee,{role:{$in:['commercial','driver']}}),readRecords(s.Vehicle),readRecords(s.Warehouse),readRecords(s.Product,{inventory_type:{$in:['assembly','finished_product']}}),
    readRecords(s.Dispatch,{status:{$in:open}}),readRecords(s.FieldSale,{transaction_date:date,status:'approved_posted'}),readRecords(s.Customer,{acquisition_date:date}),readRecords(s.SalesOrder,{order_date:date,status:'invoiced',sales_supply_recorded_at:{$exists:true},dispatch_id:{$ne:''}}),
  ]);
  const runs=await readRecords(s.Dispatch,{$or:[{dispatch_date:date},{id:{$in:[...daySales,...dayOrders].map(v=>v.dispatch_id).filter(Boolean)}},...(date===today()?[{status:{$in:[...open,'returned']}}]:[])]});
  const ids=runs.map(r=>r.id),legacyLocations=warehouses.filter(w=>w.warehouse_type==='commercial_custody');
  const [lines,fieldSales,orders,balances,runMovements,extraMovements,journals]=await Promise.all([
    byIds(s.DispatchLine,'dispatch_id',ids),byIds(s.FieldSale,'dispatch_id',ids),byIds(s.SalesOrder,'dispatch_id',ids),
    byIds(s.StockBalance,'warehouse_id',[...warehouses.filter(w=>storage.includes(w.warehouse_type)).map(w=>w.id),...runs.filter(r=>open.includes(r.status)).map(r=>r.vehicle_warehouse_id),...legacyLocations.map(w=>w.id)]),
    byIds(s.StockMovement,'document_id',ids),byIds(s.StockMovement,'dispatch_id',ids),byIds(s.JournalEntry,'id',[...daySales.map(v=>v.journal_id),...dayOrders.map(v=>v.sales_supply_journal_id)]),
  ]);
  const [fieldLines,orderLines,supplyMovements,expiredReturns]=await Promise.all([byIds(s.FieldSaleLine,'field_sale_id',fieldSales.map(v=>v.id)),byIds(s.SalesOrderLine,'order_id',orders.map(v=>v.id)),byIds(s.StockMovement,'document_id',[...fieldSales,...orders].map(v=>v.id)),byIds(s.SpoilageRecord,'dispatch_id',ids)]);
  const movements=[...new Map([...runMovements,...extraMovements,...supplyMovements].map(m=>[m.id,m])).values()];
  const snapshot=snapshotStores({Dispatch:allOpen,DispatchLine:lines,SalesOrder:orders,FieldSale:fieldSales,StockBalance:balances,StockMovement:movements,SalesOrderLine:orderLines,FieldSaleLine:fieldLines});
  const views=await Promise.all(runs.map(async run=>{
    const view={...pick(run,'id dispatch_number dispatch_date status warehouse_id warehouse_name vehicle_id vehicle_name vehicle_warehouse_id driver_id driver_name salesperson_id salesperson_name route_name total_loaded_value total_returned_value return_date'),customer_returns:expiredReturns.filter(r=>r.dispatch_id===run.id&&r.record_type==='field_expired_return').map(r=>pick(r,'id record_number customer_name product_id product_name quantity unit returned_lot_number returned_expiry_date status return_received_at'))};
    try{const recon=await dispatchReconciliationData(snapshot,run);return {...view,reconciliation:{...recon,orders:recon.orders.map(o=>pick(o,'id order_number')),fieldSales:recon.fieldSales.map(v=>pick(v,'id sale_number'))},error:''};}catch(e){return {...view,error:e.message,reconciliation:null};}
  }));
  const proven=new Set(views.flatMap(v=>v.reconciliation?.fieldSales.map(s=>s.id) || [])),posted=new Set(journals.filter(j=>j.status==='posted').map(j=>j.id));
  const provenOrders=new Set(views.flatMap(v=>v.reconciliation?.orders.map(o=>o.id)||[]));
  const journalById=new Map(journals.map(j=>[j.id,j]));
  const suppliedOrders=dayOrders.filter(o=>{const j=journalById.get(o.sales_supply_journal_id);return provenOrders.has(o.id)&&j?.status==='posted'&&j.source_document_type==='Invoice'&&j.source_document_id===o.invoice_id;}).map(o=>({...o,commercial_id:o.salesperson_id}));
  const sales=[...daySales.filter(v=>proven.has(v.id)&&posted.has(v.journal_id)),...suppliedOrders];
  const agents=staff.filter(e=>normalizeRole(e.role)==='commercial').map(agent=>{
    const own=sales.filter(sale=>sale.commercial_id===agent.id),customers=acquisitions.filter(c=>c.acquired_by_id===agent.id);
    return {...pick(agent,'id full_name status'),sales:round2(own.reduce((sum,v)=>sum+Number(v.total || 0),0)),cash_collected:round2(own.reduce((sum,v)=>sum+Number(v.amount_collected || 0),0)),credit:round2(own.reduce((sum,v)=>sum+Number(v.amount_due ?? Math.max(0,Number(v.total || 0)-Number(v.amount_collected || 0))),0)),supplies:own.length,customers_supplied:new Set(own.map(v=>v.customer_id)).size,new_customers:customers.length,verified_customers:customers.filter(c=>c.acquisition_verified==='verified_unique').length,open_runs:views.filter(r=>r.salesperson_id===agent.id&&open.includes(r.status)).length};
  });
  const productMap=new Map(products.map(p=>[p.id,p]));
  const legacy=legacyLocations.map(w=>({...pick(w,'id name custodian_employee_id'),lots:balances.filter(b=>b.warehouse_id===w.id&&Number(b.quantity)>0).map(b=>({...pick(b,'id product_id product_name quantity lot_number expiry_date qc_status'),unit:stockUnit(productMap.get(b.product_id) || {})}))})).filter(w=>w.lots.length);
  return {date,agents,runs:views,legacy,unverified_supplies:daySales.length+dayOrders.length-sales.length,
    products:products.map(p=>({...pick(p,'id name image_url inventory_type is_active configuration_status'),unit:stockUnit(p)})),
    staff:staff.map(e=>({...pick(e,'id full_name status'),role:normalizeRole(e.role)})),
    vehicles:vehicles.map(v=>pick(v,'id name registration warehouse_id is_active')),
    warehouses:warehouses.filter(w=>storage.includes(w.warehouse_type)&&w.is_active!==false).map(w=>pick(w,'id name warehouse_type')),
    warehouse_stock:balances.filter(b=>warehouses.some(w=>w.id===b.warehouse_id&&storage.includes(w.warehouse_type))).map(b=>pick(b,'warehouse_id product_id quantity qc_status expiry_date'))};
}

export async function distributionControlAction(client,user,body){
  const {role,employee}=await requireStaff(client,user,DISPATCH_MANAGER_ROLES,'Distribution inventory control');
  if(role!=='admin'&&employee?.status!=='active')throw Error('An active Distribution management staff account is required');
  const svc=client.asServiceRole,s=svc.entities;
  if(body.action==='distributionIssueWorkspace') {
    client.auth.assertModule?.('distribution');
    const [staff,vehicles,warehouses,products]=await Promise.all([readRecords(s.Employee,{role:{$in:['commercial','driver']},status:'active'}),readRecords(s.Vehicle,{is_active:true}),readRecords(s.Warehouse,{is_active:true}),readRecords(s.Product,{inventory_type:{$in:['assembly','finished_product']},is_active:true})]);
    const locations=warehouses.filter(w=>storage.includes(w.warehouse_type)),balances=await byIds(s.StockBalance,'warehouse_id',locations.map(w=>w.id));
    return {products:products.map(p=>({...pick(p,'id name image_url inventory_type is_active configuration_status'),unit:stockUnit(p)})),staff:staff.map(e=>({...pick(e,'id full_name status'),role:normalizeRole(e.role)})),vehicles:vehicles.map(v=>pick(v,'id name registration warehouse_id is_active')),warehouses:locations.map(w=>pick(w,'id name warehouse_type')),warehouse_stock:balances.map(b=>pick(b,'warehouse_id product_id quantity qc_status expiry_date'))};
  }
  if(body.action==='distributionControl'){const {from:date}=periodDates(body.date || today(),body.date || today());if(date>today())throw Error('Choose today or an earlier reporting date');return overview(svc,date);}
  if(body.action==='issueDistributionStock'){
    const key=keyOf(user,body),snapshot=JSON.stringify([body.commercialId,body.driverId,body.vehicleId,body.warehouseId,body.lines,String(body.notes || '').slice(0,2000)]);
    const previous=(await readRecords(s.DispatchRequest,{distribution_request_key:key}))[0];
    if(previous){if(previous.distribution_request_payload!==snapshot)throw Error('These goods were already issued. Open the recorded run before changing the load.');return dispatchAction(client,user,{action:'approveDispatchRequest',requestId:previous.id});}
    if(body.date && body.date!==today())throw Error('New stock loading is recorded on the current business date');
    const rows=body.lines;
    if(!Array.isArray(rows)||!rows.length||rows.length>100||new Set(rows.map(r=>r?.product_id)).size!==rows.length)throw Error('Choose 1 to 100 distinct finished products');
    const products=await byIds(s.Product,'id',rows.map(r=>r?.product_id));
    const items=rows.map(row=>{const p=products.find(p=>p.id===row?.product_id);if(!finishedProduct(p)||p.is_active===false||p.configuration_status==='draft'||typeof row.quantity==='boolean'||!Number.isFinite(Number(row.quantity))||round3(row.quantity)<=0)throw Error('Choose active finished products and positive loading quantities');return {product_id:p.id,product_name:p.name,unit:stockUnit(p),quantity:round3(row.quantity)};});
    const request=await s.DispatchRequest.create({request_number:'DR-'+crypto.randomUUID().slice(0,12).toUpperCase(),request_date:today(),source_warehouse_id:body.warehouseId,vehicle_id:body.vehicleId,driver_id:body.driverId,commercial_id:body.commercialId,salesperson_id:body.commercialId,items,status:'pending_approval',notes:String(body.notes || '').slice(0,2000),distribution_request_key:key,distribution_request_payload:snapshot});
    return dispatchAction(client,user,{action:'approveDispatchRequest',requestId:request.id});
  }
  if(body.action==='closeDistributionRun'){
    const run=await s.Dispatch.get(body.dispatchId);if(!run)throw Error('Select a delivery run');if(run.status==='completed')return {reused:true};if(run.status!=='returned')throw Error('Receive the vehicle stock before closing this run');
    const recon=await dispatchReconciliationData(svc,run);
    if(!recon.rows.length&&Number(run.total_loaded_value)>0)throw Error('This historical run is missing its load manifest; reconcile the recorded load before closing');
    if(recon.hasVariance)throw Error('Resolve the stock variance before closing this run');
    const pending=(await readRecords(s.FieldSale,{dispatch_id:run.id})).some(sale=>sale.stock_moved_at&&sale.status!=='approved_posted');
    if(pending)throw Error('Resolve stock-moved supplies awaiting accounting before closing this run');
    if((await readRecords(s.SpoilageRecord,{dispatch_id:run.id,record_type:'field_expired_return'})).some(r=>!r.return_received_at))throw Error('Receive the expired customer collections into warehouse quarantine before closing this run');
    await s.Dispatch.update(run.id,{status:'completed',closed_by:user.id,closed_at:new Date().toISOString()});
    await audit(svc,{action:'close_dispatch',module:'distribution',entityType:'Dispatch',entityId:run.id,userId:user.id,description:`Closed ${run.dispatch_number} after stock reconciliation`});return {closed:true};
  }
  if(body.action!=='recoverLegacyCustody')throw Error('Unknown Distribution control action');
  if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>1000||body.lines.some(r=>!r||typeof r.quantity==='boolean'||!Number.isFinite(Number(r.quantity))||round3(r.quantity)<=0))throw Error('Choose positive quantities of distinct finished products to recover');
  const key=keyOf(user,body),documentId='LEGACY-'+key,snapshot=JSON.stringify([body.warehouseId,body.toWarehouseId,body.lines,String(body.reason || '').slice(0,1000)]);
  const prior=await readRecords(s.StockMovement,{document_type:'CustodyReturn',document_id:documentId});
  if(prior.length){if(prior.some(m=>m.legacy_return_payload!==snapshot))throw Error('This legacy return was already recorded with different details');return {reused:true,returnRef:documentId};}
  const source=await s.Warehouse.get(body.warehouseId),destination=await s.Warehouse.get(body.toWarehouseId);
  if(!source||source.warehouse_type!=='commercial_custody'||!destination||destination.is_active===false||!storage.includes(destination.warehouse_type)||source.id===destination.id)throw Error('Choose the old custody location and a finished-goods receiving warehouse');
  const products=await byIds(s.Product,'id',(body.lines || []).map(r=>r.product_id)),balances=await readRecords(s.StockBalance,{warehouse_id:source.id});
  const checked=validateCustodyLines(body.lines,products,balances,false,today());
  for(const {product,quantity} of checked)await stockTransfer(svc,{productId:product.id,productName:product.name,fromWarehouseId:source.id,toWarehouseId:destination.id,toWarehouseName:destination.name,quantity,movementType:'commercial_return',documentType:'CustodyReturn',documentId,movementDate:today(),reason:String(body.reason || 'Legacy custody recovered into Distribution').slice(0,1000)});
  const movements=await readRecords(s.StockMovement,{document_type:'CustodyReturn',document_id:documentId});for(const m of movements)await s.StockMovement.update(m.id,{legacy_return_payload:snapshot});
  await audit(svc,{action:'recover_legacy_custody',module:'distribution',entityType:'Warehouse',entityId:source.id,userId:user.id,description:`Recovered ${checked.length} products from ${source.name} to ${destination.name}`});return {returnRef:documentId};
}
