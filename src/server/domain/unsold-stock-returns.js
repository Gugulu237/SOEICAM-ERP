import {createHash} from 'node:crypto';
import {requireStaff,round3,today} from './field-ops.js';
import {readRecords} from './commercial-workspace.js';
import {dispatchAction,dispatchReconciliationData} from './dispatch-operations.js';
import {eligibleStockRecipient,STOCK_RECIPIENT_ROLES,validEmployeeStockLocation} from './employee-custody.js';
import {finishedProduct} from './commercial-rules.js';
import {stockUnit} from '../../lib/item-units.js';

export const UNSOLD_RETURN_ACTIONS=['unsoldReturnWorkspace','requestUnsoldReturn','cancelUnsoldReturn','receiveUnsoldReturn','rejectUnsoldReturn'];
const open=['loaded','in_transit'],receivers=['admin','warehouse_manager'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pick=(row,keys)=>Object.fromEntries(keys.split(' ').map(key=>[key,row?.[key]]));
const assigned=(run,employee)=>!!employee?.id&&(run.salesperson_id===employee.id||run.driver_id===employee.id);
const note=value=>{if(value!==undefined&&typeof value!=='string')throw Error('Enter a return note.');if((value||'').length>2000)throw Error('Keep the return note within 2,000 characters.');return String(value||'').trim();};
const quantity=value=>{const n=Number(value);if(!['number','string'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(n)||n<0||n>1e9||Math.abs(n*1000-Math.round(n*1000))>0.0001)throw Error('Enter non-negative return quantities with at most three decimal places.');return round3(n);};
function checkBalance(balance){quantity(balance.quantity);if(!Number.isFinite(Number(balance.unit_cost))||Number(balance.unit_cost)<0||!Number.isFinite(Number(balance.total_value))||Number(balance.total_value)<0||Number(balance.quantity)===0&&Number(balance.total_value)!==0)throw Error('The stock quantities or recorded costs need management review.');}
function counted(rows,input){
  if(!Array.isArray(input)||input.length!==rows.length||new Set(input.map(r=>r?.product_id)).size!==rows.length)throw Error('Count every product in the remaining load, including zero quantities.');
  return rows.map(row=>{const count=input.find(r=>r?.product_id===row.product_id);if(!count||quantity(count.quantity)!==row.quantity)throw Error('The physical return count must match all remaining stock. Ask warehouse management to reconcile any difference.');return {product_id:row.product_id,quantity:quantity(count.quantity)};});
}
function ownActor(employee,body){
  if(!eligibleStockRecipient(employee))throw Error('An active employee holding issued goods is required.');
  if(['employeeId','commercialId','driverId'].some(key=>body[key]&&body[key]!==employee.id))throw Error('Use your own issued goods for this return.');
}

// Read-only evidence. A pending request keeps the load in custody until the
// warehouse counts and accepts every remaining product through returnStock.
async function returnState(svc,run){
  const s=svc.entities;
  if(!run||!open.includes(run.status)||!run.dispatch_date||run.dispatch_date>today())throw Error('Choose an open delivery load already issued to you.');
  const [source,custody,vehicle,conflicts,balances,lines,bins,pendingExchanges]=await Promise.all([
    s.Warehouse.get(run.warehouse_id),s.Warehouse.get(run.vehicle_warehouse_id),run.vehicle_id?s.Vehicle.get(run.vehicle_id):null,
    readRecords(s.Dispatch,{status:{$in:open},$or:[{vehicle_warehouse_id:run.vehicle_warehouse_id},{salesperson_id:run.salesperson_id},...(run.vehicle_id?[{vehicle_id:run.vehicle_id}]:[]),...(run.driver_id?[{driver_id:run.driver_id}]:[])]}),
    readRecords(s.StockBalance,{warehouse_id:run.vehicle_warehouse_id}),readRecords(s.DispatchLine,{dispatch_id:run.id}),
    readRecords(s.Warehouse,run.vehicle_id?{vehicle_id:run.vehicle_id,field_return_bin:true,warehouse_type:'quarantine'}:{source_warehouse_id:run.vehicle_warehouse_id,customer_supply_return_bin:true,warehouse_type:'quarantine'}),
    readRecords(s.SpoilageRecord,{record_type:'field_expired_request',...(run.vehicle_id?{vehicle_id:run.vehicle_id}:{dispatch_id:run.id}),status:'pending_verification'}),
  ]);
  if(!source||source.is_active===false||!['finished_goods','cold_room','general'].includes(source.warehouse_type))throw Error('The receiving warehouse needs management review.');
  if(!custody||source.id===custody.id||(run.vehicle_id?(!vehicle||vehicle.is_active===false||vehicle.warehouse_id!==custody.id||custody.is_active===false||custody.warehouse_type!=='vehicle'||custody.vehicle_id&&custody.vehicle_id!==vehicle.id):!validEmployeeStockLocation(custody,run.salesperson_id)))throw Error('The assigned stock location changed. Ask warehouse management to review this load.');
  if(conflicts.some(row=>row.id!==run.id))throw Error('More than one open load shares this stock or delivery team. Reconcile the assignments before returning goods.');
  if(pendingExchanges.length)throw Error('Verify or reject pending customer exchange requests before returning this load.');
  for(const balance of balances)checkBalance(balance);
  const reconciliation=await dispatchReconciliationData(svc,run);
  if(reconciliation.hasVariance)throw Error('The remaining stock does not reconcile with this load. Ask warehouse management to review the difference.');
  const ids=[...new Set([...lines,...balances].map(row=>row.product_id))],products=[];
  for(let i=0;i<ids.length;i+=100)products.push(...await readRecords(s.Product,{id:{$in:ids.slice(i,i+100)}}));
  const rows=ids.map(id=>{const product=products.find(row=>row.id===id);if(!finishedProduct(product))throw Error('This load contains an unrecognized or non-finished product. Ask warehouse management to review it.');const lots=balances.filter(row=>row.product_id===id&&Number(row.quantity)>0);return {product_id:id,product_name:product.name,unit:stockUnit(product),quantity:round3(lots.reduce((sum,row)=>sum+Number(row.quantity),0)),lots:lots.map(row=>pick(row,'lot_number expiry_date qc_status quantity'))};}).sort((a,b)=>a.product_id.localeCompare(b.product_id));
  // Mirror the receiver's complete bin selection, including earlier-run goods.
  // Show actual quarantined goods/packaging, not their original finished units.
  const binIds=bins.map(row=>row.id),collectionBalances=[],collections=[];
  for(let i=0;i<binIds.length;i+=100){const ids=binIds.slice(i,i+100);collectionBalances.push(...await readRecords(s.StockBalance,{warehouse_id:{$in:ids}}));collections.push(...await readRecords(s.SpoilageRecord,{record_type:'field_expired_return',collection_warehouse_id:{$in:ids}}));}
  if(bins.some(row=>row.is_active===false))throw Error('A customer-return quarantine location needs management review.');
  for(const balance of collectionBalances)checkBalance(balance);
  const collectionProductIds=[...new Set(collectionBalances.filter(row=>Number(row.quantity)>0).map(row=>row.product_id))],collectionProducts=[];
  for(let i=0;i<collectionProductIds.length;i+=100)collectionProducts.push(...await readRecords(s.Product,{id:{$in:collectionProductIds.slice(i,i+100)}}));
  const collectionRows=collectionBalances.filter(row=>Number(row.quantity)>0).map(balance=>{const product=collectionProducts.find(row=>row.id===balance.product_id);if(!product)throw Error('A quarantined customer return has an unknown product. Ask warehouse management to review it.');return {product_name:product.name,quantity:Number(balance.quantity),unit:stockUnit(product),returned_lot_number:balance.lot_number,returned_expiry_date:balance.expiry_date};});
  const evidence={run:pick(run,'id dispatch_date status warehouse_id vehicle_warehouse_id vehicle_id driver_id salesperson_id'),source,custody,vehicle,balances,lines,bins,collections,collectionBalances};
  return {rows,collections:collectionRows,token:hash(evidence),warehouse_name:source.name};
}

async function requestView(svc,event,{employee,canReceive=false}={}){
  const record=event.unsold_return_request,run=await svc.entities.Dispatch.get(record.dispatch_id),review=await svc.entities.AuditLog.get('URV-'+hash(event.id).slice(0,40));
  const status=review?.unsold_return_review?.status||'pending';
  const view={id:event.id,...record,status,review_note:review?.unsold_return_review?.note||'',reviewed_at:review?.unsold_return_review?.reviewed_at||'',can_cancel:status==='pending'&&assigned(run||{},employee),can_receive:status==='pending'&&canReceive,error:''};
  if(status==='pending')try{if(run?.unsold_return_request_id!==event.id)throw Error('This return request no longer reserves the load. Ask warehouse management to review it.');const state=await returnState(svc,run);if(state.token!==record.token)throw Error('The load changed after this request. Reject or cancel it, reconcile the goods and submit a new count.');}catch(error){view.error=error.message;}
  return view;
}

export async function unsoldStockReturnAction(client,user,body){
  const receiving=body.action==='receiveUnsoldReturn'||body.action==='rejectUnsoldReturn'||body.action==='unsoldReturnWorkspace'&&body.mode==='receive';
  const {role,employee}=await requireStaff(client,user,receiving?receivers:STOCK_RECIPIENT_ROLES,'unsold stock returns');
  if(employee?.status&&employee.status!=='active'||role!=='admin'&&!employee)throw Error('An active staff account is required.');
  if(receiving)client.auth.assertModule?.('distribution');
  else ownActor(employee,body);
  const svc=client.asServiceRole,s=svc.entities;
  if(body.action==='unsoldReturnWorkspace'){
    if(body.mode!==undefined&&!['own','receive'].includes(body.mode))throw Error('Choose your returns or the warehouse receiving queue.');
    const records=await readRecords(s.AuditLog,{action:'request_unsold_stock_return'}),ownRuns=receiving?[]:await readRecords(s.Dispatch,{$or:[{salesperson_id:employee.id},{driver_id:employee.id}]});
    const ownIds=new Set(ownRuns.map(run=>run.id)),visible=records.filter(event=>event.unsold_return_request&&(receiving||ownIds.has(event.unsold_return_request.dispatch_id)));
    const requests=[];
    for(const event of visible)requests.push(await requestView(svc,event,{employee,canReceive:receiving}));
    const runs=[];
    for(const run of ownRuns.filter(row=>open.includes(row.status)&&!row.unsold_return_request_id)){
      const view={...pick(run,'id dispatch_number dispatch_date vehicle_name driver_name'),holder_name:run.salesperson_name,warehouse_name:run.warehouse_name,pending_request_id:'',rows:[],error:''};
      try{Object.assign(view,await returnState(svc,run));}catch(error){view.error=error.message;}
      runs.push(view);
    }
    return {mode:receiving?'receive':'own',employee:pick(employee,'id full_name'),runs,requests:requests.filter(row=>!receiving||row.status==='pending').sort((a,b)=>b.requested_at.localeCompare(a.requested_at)).slice(0,200)};
  }
  if(body.action==='requestUnsoldReturn'){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestKey||''))throw Error('Reopen the return form for a valid request reference.');
    const id='URQ-'+hash([user.id,body.requestKey]).slice(0,40),payload=JSON.stringify({dispatchId:body.dispatchId,token:body.token,countedLines:body.countedLines,notes:note(body.notes),confirmed:body.confirmed}),prior=await s.AuditLog.get(id);
    if(prior){if(prior.unsold_return_payload!==payload)throw Error('This return reference was already used for different counts. Reopen the return form.');return {request:await requestView(svc,prior,{employee}),reused:true};}
    const run=await s.Dispatch.get(body.dispatchId);
    if(!assigned(run||{},employee))throw Error('Return only goods assigned to you or to your paired delivery run.');
    if(run.unsold_return_request_id)throw Error('This load already has a return awaiting warehouse receipt.');
    if(body.confirmed!==true)throw Error('Confirm that all remaining goods have been physically counted for return.');
    const state=await returnState(svc,run);
    if(!state.rows.length)throw Error('This load has no recorded products to count.');
    if(body.token!==state.token)throw Error('The stock changed. Refresh the return form and count the remaining goods again.');
    counted(state.rows,body.countedLines);
    const record={dispatch_id:run.id,dispatch_number:run.dispatch_number,requested_at:new Date().toISOString(),requested_by:employee.full_name||'',requested_by_employee_id:employee.id,holder_name:run.salesperson_name||'',driver_name:run.driver_name||'',warehouse_name:state.warehouse_name,notes:note(body.notes),rows:state.rows,collections:state.collections,token:state.token};
    const event=await s.AuditLog.create({id,action:'request_unsold_stock_return',module:'distribution',entity_type:'Dispatch',entity_id:run.id,user_id:user.id,description:'All unsold goods counted for warehouse receipt: '+(run.dispatch_number||run.id),unsold_return_payload:payload,unsold_return_request:record});
    await s.Dispatch.update(run.id,{unsold_return_request_id:id});
    return {request:await requestView(svc,event,{employee})};
  }
  if(!['cancelUnsoldReturn','receiveUnsoldReturn','rejectUnsoldReturn'].includes(body.action))throw Error('Unknown unsold stock return action.');
  const event=await s.AuditLog.get(body.requestId);
  if(event?.action!=='request_unsold_stock_return'||!event.unsold_return_request)throw Error('Choose a recorded unsold stock return request.');
  const record=event.unsold_return_request,run=await s.Dispatch.get(record.dispatch_id);
  if(!receiving&&!assigned(run||{},employee))throw Error('Cancel only a return from your own assigned load.');
  const status={cancelUnsoldReturn:'cancelled',receiveUnsoldReturn:'received',rejectUnsoldReturn:'rejected'}[body.action],reviewId='URV-'+hash(event.id).slice(0,40),payload=JSON.stringify({action:body.action,note:note(body.note),...(status==='received'?{token:body.token,countedLines:body.countedLines,confirmed:body.confirmed}:{})}),prior=await s.AuditLog.get(reviewId);
  if(prior){if(prior.unsold_return_payload!==payload)throw Error('This return request has already been resolved. Refresh the returns list.');return {request:await requestView(svc,event,{employee,canReceive:receiving}),reused:true};}
  if(run?.unsold_return_request_id!==event.id||!open.includes(run.status))throw Error('This load is no longer awaiting this return. Refresh the returns list.');
  if(status==='received'){
    if(body.confirmed!==true)throw Error('Confirm that the warehouse physically received all counted goods.');
    const state=await returnState(svc,run);
    if(body.token!==record.token||state.token!==record.token)throw Error('The load changed after this request. Reject or cancel it, reconcile the goods and submit a new count.');
    const counts=counted(state.rows,body.countedLines);
    await dispatchAction(client,user,{action:'returnDispatchStock',dispatchId:run.id,countedLines:counts},{returnRequestId:event.id});
  }else{
    if(status==='rejected'&&!note(body.note))throw Error('Enter why the warehouse rejected this return.');
    await s.Dispatch.update(run.id,{unsold_return_request_id:''});
  }
  await s.AuditLog.create({id:reviewId,action:body.action,module:'distribution',entity_type:'Dispatch',entity_id:run.id,user_id:user.id,description:'Unsold stock return '+status+': '+(run.dispatch_number||run.id),unsold_return_payload:payload,unsold_return_review:{request_id:event.id,status,note:note(body.note),reviewed_at:new Date().toISOString(),reviewed_by:user.id}});
  return {request:await requestView(svc,event,{employee,canReceive:receiving})};
}
