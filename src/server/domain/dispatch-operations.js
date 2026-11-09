import {degustationQuantity,degustationState,degustationHistory} from './degustation-stock.js';
import {issueDegustation} from './degustation.js';
import {stockStaff,eligibleStockRecipient,ensureEmployeeStockLocation,validEmployeeStockLocation} from './employee-custody.js';
import { requireStaff, stockTransfer, audit, round2, round3, today, appropriatedDegustation, postJournal } from './field-ops.js';
import { finishedProduct, periodDates } from './commercial-rules.js';
import { normalizeRole } from './roles.js';
import { stockUnit, unitFactor } from '../../lib/item-units.js';
import { ensureVehicleStockLocation } from './vehicle-locations.js';
import { receiveVehicleExpiredReturns } from './commercial-returns.js';
import { DISPATCH_MANAGER_ROLES, canIssueDeliveryStock } from '../../lib/operations-access.js';
import {validPostingRuleAccount} from '../../lib/posting-rule-types.js';
import {createHash} from 'node:crypto';
import {journalCents,checkedJournalLines,journalPayload} from './journal-validation.js';
import {centralInventoryMode} from './centralized-inventory-policy.js';
import {centralCutoverQuantities} from './central-cutover-reconciliation.js';

// These operations execute inside the function route's serializable transaction.
// All validation is completed before the first stock write. A load is custody,
// not a sale. Giveaway units are expensed separately in the same transaction.
const managers = DISPATCH_MANAGER_ROLES;
const openStates = ['loaded', 'in_transit'];
const storageTypes = ['finished_goods', 'cold_room', 'general'];
const present = value => value !== undefined && value !== null && value !== '';
function appropriationReconciliation(dispatch,balances,giveaways,returns){
  const summary=dispatch.degustation_appropriation,marked=balances.map(balance=>({balance,marker:appropriatedDegustation(balance)})).filter(row=>row.marker);
  const given=giveaways.filter(m=>m.degustation_appropriation_id),returned=returns.filter(m=>m.degustation_appropriation_id);
  const fail=()=>{throw Error('Reconcile the expensed Dégustation custody quantities and original costs before moving this stock.');};
  if(!summary){if(marked.length||given.length||returned.length)fail();return null;}
  const exact=(value,round)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&round(value)===value&&Number.isSafeInteger(Math.round(value*(round===round3?1000:100)));
  if(!summary.id||summary.policy!=='legacy-degustation-appropriation-v1'||!summary.expense_account_id||!exact(summary.total_quantity,round3)||!exact(summary.total_value,round2))fail();
  const products=new Map(),add=(id,quantity,value,kind)=>{const row=products.get(id)||{remaining_quantity:0,remaining_value:0,given_quantity:0,given_value:0,returned_quantity:0,returned_value:0};row[kind+'_quantity']=round3(row[kind+'_quantity']+quantity);row[kind+'_value']=round2(row[kind+'_value']+value);products.set(id,row);};
  for(const {balance,marker} of marked){if(marker.id!==summary.id||marker.dispatch_id!==dispatch.id||marker.expense_account_id!==summary.expense_account_id)fail();add(balance.product_id,marker.quantity,marker.value,'remaining');}
  for(const [kind,movements] of [['given',given],['returned',returned]])for(const movement of movements){
    if(movement.degustation_appropriation_id!==summary.id||movement.dispatch_id!==dispatch.id||movement.degustation_appropriation_expense_account_id!==summary.expense_account_id||!movement.degustation_appropriation_inventory_account_id||movement.degustation_already_expensed!==true||!exact(movement.degustation_appropriation_quantity,round3)||movement.degustation_appropriation_quantity!==Number(movement.quantity)||!exact(movement.degustation_appropriation_value,round2)||Number(movement.total_value)!==0||kind==='returned'&&movement.degustation_restored_value!==movement.degustation_appropriation_value)fail();
    add(movement.product_id,movement.degustation_appropriation_quantity,movement.degustation_appropriation_value,kind);
  }
  const totals=[...products.values()].reduce((sum,row)=>Object.fromEntries(Object.keys(sum).map(key=>[key,(key.endsWith('quantity')?round3:round2)(sum[key]+row[key])])),{remaining_quantity:0,remaining_value:0,given_quantity:0,given_value:0,returned_quantity:0,returned_value:0});
  if(round3(totals.remaining_quantity+totals.given_quantity+totals.returned_quantity)!==summary.total_quantity||round2(totals.remaining_value+totals.given_value+totals.returned_value)!==summary.total_value)fail();
  const restoration=dispatch.degustation_appropriation_return;
  if(restoration&&(restoration.total_quantity!==totals.returned_quantity||restoration.total_value!==totals.returned_value))fail();
  return {...summary,...totals,products};
}
const number = (value, label) => {
  if (!present(value) || !['string', 'number'].includes(typeof value) || !String(value).trim() || !Number.isFinite(Number(value))) throw new Error(`Enter a valid ${label}`);
  return Number(value);
};
const nonnegative = (value, label) => {
  const result = number(value, label);
  if (result < 0) throw new Error(`Enter a non-negative ${label}`);
  return result;
};
const amount = value => present(value) && Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export const DISPATCH_TOP_UP_POLICY='add-to-current-stock-v1';
const additionError=()=>Error('Reconcile the current load and its original stock movements before adding more goods.');
const additionCanonical=value=>Array.isArray(value)?value.map(additionCanonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,additionCanonical(value[key])])):value;
const additionHash=value=>createHash('sha256').update(JSON.stringify(additionCanonical(value))).digest('hex');
const additionQuantity=value=>{const n=Number(value),scaled=Math.round(n*1000);if(!['number','string'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(n)||n<0||n>1e9||!Number.isSafeInteger(scaled)||Math.abs(n*1000-scaled)>0.0001)throw additionError();return scaled;};
const additionValue=value=>{if(value==null)throw additionError();try{return journalCents(value);}catch{throw additionError();}};
const additionPick=(row,keys)=>Object.fromEntries(keys.split(' ').filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
const movementProof=row=>additionPick(row,'id product_id quantity movement_type source_warehouse_id destination_warehouse_id lot_number expiry_date unit_cost total_value document_type document_id movement_date status production_order_id batch_number dispatch_id dispatch_load_addition_id dispatch_load_addition_policy degustation_issue_event_id degustation_at_issue recorded_by journal_id journal_number');
const journalProof=row=>additionPick(row,'id journal_number entry_date description source_module source_document_type source_document_id status total_debit total_credit posting_payload posted_by');
const journalLineProof=row=>additionPick(row,'id journal_id status account_id debit credit description party_type party_id');
const proofSort=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b)))).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
const proofEqual=(left,right)=>JSON.stringify(proofSort(left))===JSON.stringify(proofSort(right));

function additionTransfers(movements,dispatch,expected){
 const outgoing=[],incoming=[];
 for(const row of movements){
  if(row.status!=='approved'||row.document_type!=='Dispatch'||row.document_id!==dispatch.id||row.movement_type!=='vehicle_load'||!additionQuantity(row.quantity))throw additionError();
  additionValue(row.total_value);
  if(row.source_warehouse_id===dispatch.warehouse_id&&!row.destination_warehouse_id)outgoing.push(row);
  else if(row.destination_warehouse_id===dispatch.vehicle_warehouse_id&&!row.source_warehouse_id)incoming.push(row);
  else throw additionError();
 }
 const shape=row=>JSON.stringify([row.product_id,row.lot_number||'',row.expiry_date||'',row.production_order_id||'',row.batch_number||'',additionQuantity(row.quantity),additionValue(row.total_value)]);
 if(JSON.stringify(outgoing.map(shape).sort())!==JSON.stringify(incoming.map(shape).sort()))throw additionError();
 const amounts=new Map();for(const row of outgoing){const sum=amounts.get(row.product_id)||{quantity:0,value:0};sum.quantity+=additionQuantity(row.quantity);sum.value+=additionValue(row.total_value);if(!Number.isSafeInteger(sum.quantity)||!Number.isSafeInteger(sum.value))throw additionError();amounts.set(row.product_id,sum);}
 if(amounts.size!==expected.size||[...expected].some(([id,row])=>amounts.get(id)?.quantity!==row.quantity||amounts.get(id)?.value!==row.value))throw additionError();
}

async function additionGiveawayProof(svc,dispatch,eventId,lines,userId){
 const id='DEG-ISSUE-'+eventId,movements=await records(svc.entities.StockMovement,{document_type:'Degustation',document_id:id}),expected=new Map(lines.filter(row=>row.degustation_quantity>0).map(row=>[row.product_id,additionQuantity(row.degustation_quantity)])),actual=new Map();let value=0;
 for(const row of movements){
  if(row.status!=='approved'||row.movement_type!=='promotional_issue'||row.source_warehouse_id!==dispatch.vehicle_warehouse_id||row.destination_warehouse_id||row.dispatch_id!==dispatch.id||row.degustation_issue_event_id!==eventId||row.degustation_at_issue!==true||row.recorded_by!==userId||row.degustation_already_expensed||!additionQuantity(row.quantity))throw additionError();
  actual.set(row.product_id,(actual.get(row.product_id)||0)+additionQuantity(row.quantity));value+=additionValue(row.total_value);
 }
 if(actual.size!==expected.size||[...expected].some(([productId,qty])=>actual.get(productId)!==qty))throw additionError();
 const journals=await records(svc.entities.JournalEntry,{source_module:'degustation',source_document_type:'Degustation',source_document_id:id});
 if(!value){if(journals.length||movements.some(row=>row.journal_id))throw additionError();return {movements:proofSort(movements.map(movementProof)),journal:null,lines:[]};}
 if(journals.length!==1)throw additionError();const journal=journals[0],journalLines=await records(svc.entities.JournalLine,{journal_id:journal.id});let checked;
 try{checked=checkedJournalLines(journalLines);}catch{throw additionError();}
 if(journal.status!=='posted'||journal.posted_by!==userId||additionValue(journal.total_debit)!==value||additionValue(journal.total_credit)!==value||additionValue(checked.debit)!==value||additionValue(checked.credit)!==value||journalLines.some(row=>row.status!=='posted')||movements.some(row=>row.journal_id!==journal.id)||journal.posting_payload!==journalPayload({entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines:checked.lines}))throw additionError();
 return {movements:proofSort(movements.map(movementProof)),journal:journalProof(journal),lines:proofSort(journalLines.map(journalLineProof))};
}

async function retryAddition(svc,user,dispatch,event,payload,fingerprint){
 const proof=event.dispatch_load_addition;
 if(event.action!=='add_dispatch_stock'||event.module!=='distribution'||event.entity_type!=='Dispatch'||event.entity_id!==dispatch.id||event.user_id!==user.id||event.audit_source!=='server_verified'||!proof||proof.id!==event.id||proof.policy!==DISPATCH_TOP_UP_POLICY||proof.dispatch_id!==dispatch.id||proof.payload!==payload||proof.fingerprint!==fingerprint||event.dispatch_load_addition_checksum!==additionHash(proof))throw Error('This loading reference was already used for different goods. Reopen the issue form.');
 const expected=new Map(proof.lines.map(row=>[row.product_id,{quantity:additionQuantity(row.quantity),value:additionValue(row.value)}]));
 if(expected.size!==proof.lines.length||proof.lines.length===0||additionValue(proof.total_value)!==proof.lines.reduce((sum,row)=>sum+additionValue(row.value),0))throw additionError();
 const movements=await records(svc.entities.StockMovement,{dispatch_load_addition_id:event.id});
 if(!proofEqual(movements.map(movementProof),proof.transfers)||movements.some(row=>row.dispatch_load_addition_policy!==DISPATCH_TOP_UP_POLICY||row.movement_date!==proof.date))throw additionError();
 additionTransfers(movements,dispatch,expected);
 const current=await records(svc.entities.DispatchLine,{dispatch_id:dispatch.id});
 for(const row of proof.lines){const line=current.find(line=>line.id===row.manifest_line_id);if(!line||line.product_id!==row.product_id||additionQuantity(line.loaded_quantity)<additionQuantity(row.after.loaded_quantity)||additionValue(line.loaded_value)<additionValue(row.after.loaded_value)||additionQuantity(line.degustation_quantity||0)<additionQuantity(row.after.degustation_quantity))throw additionError();}
 const giveaway=await additionGiveawayProof(svc,dispatch,event.id,proof.lines,user.id);
 if(additionHash(giveaway)!==additionHash(proof.giveaway))throw additionError();
 return {dispatch,totalValue:proof.total_value,vehicleWarehouseId:dispatch.vehicle_warehouse_id,reused:true,addition:{id:event.id,policy:DISPATCH_TOP_UP_POLICY,date:proof.date}};
}

// A reviewed addition extends one custody run instead of forcing the holder to
// return unsold goods merely to receive more. Its immutable delta is separate
// from the original request and binds every transferred lot and giveaway.
export async function topUpDispatchStock(svc,user,dispatch,body){
 if(!user?.id||body.topUpPolicy!==DISPATCH_TOP_UP_POLICY||!dispatch?.id||body.existingDispatchId!==dispatch.id||!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(body.requestKey||''))throw Error('Review the current load before adding more goods.');
 const identity=[body.warehouseId,body.commercialId,body.driverId||'',body.vehicleId||''];
 if(identity.some(value=>typeof value!=='string')||JSON.stringify(identity)!==JSON.stringify([dispatch.warehouse_id,dispatch.salesperson_id,dispatch.driver_id||'',dispatch.vehicle_id||'']))throw Error('Add goods only to the same warehouse, employee, driver and vehicle.');
 if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>100||new Set(body.lines.map(row=>row?.product_id)).size!==body.lines.length)throw Error('Choose 1 to 100 distinct finished products');
 const lines=body.lines.map(row=>{if(typeof row?.product_id!=='string'||!row.product_id||!additionQuantity(row.quantity))throw additionError();const gift=degustationQuantity(row.degustation_quantity??0);if(gift>Number(row.quantity))throw Error('Dégustation quantity cannot exceed the total issued quantity.');return {product_id:row.product_id,quantity:additionQuantity(row.quantity)/1000,degustation_quantity:gift};}).sort((a,b)=>a.product_id.localeCompare(b.product_id));
 const date=body.date||today(),notes=String(body.notes||'').slice(0,2000),id='DLA-'+createHash('sha256').update(user.id+':'+body.requestKey).digest('hex'),payload=JSON.stringify([DISPATCH_TOP_UP_POLICY,dispatch.id,user.id,...identity,date,notes,lines]),fingerprint=additionHash(payload),previous=await svc.entities.AuditLog.get(id);
 if(previous)return retryAddition(svc,user,dispatch,previous,payload,fingerprint);
 if(svc.entities.CompanySettings&&await centralInventoryMode(svc.entities))throw Error('Use centralized company stock; goods issues are no longer required.');
 if(date!==today())throw Error('New stock loading is recorded on the current business date');
 if(!openStates.includes(dispatch.status)||!dispatch.dispatch_date||dispatch.dispatch_date>date||dispatch.unsold_return_request_id||dispatch.return_date||dispatch.unsold_return_received_request_id)throw Error('Resolve the pending or completed return before adding more goods.');
 const s=svc.entities;
 const [source,destination,vehicle,runs,manifestLines,balances,originalMoves,fieldSales,orders,activities,pendingExchanges,team]=await Promise.all([
  s.Warehouse.get(dispatch.warehouse_id),s.Warehouse.get(dispatch.vehicle_warehouse_id),dispatch.vehicle_id?s.Vehicle.get(dispatch.vehicle_id):null,
  records(s.Dispatch,{status:{$in:openStates}}),records(s.DispatchLine,{dispatch_id:dispatch.id}),records(s.StockBalance,{warehouse_id:dispatch.vehicle_warehouse_id}),
  records(s.StockMovement,{document_type:'Dispatch',document_id:dispatch.id,movement_type:'vehicle_load'}),records(s.FieldSale,{dispatch_id:dispatch.id}),records(s.SalesOrder,{dispatch_id:dispatch.id}),records(s.DriverActivity,{dispatch_id:dispatch.id,type:'trip_returned'}),
  records(s.SpoilageRecord,{record_type:'field_expired_request',...(dispatch.vehicle_id?{vehicle_id:dispatch.vehicle_id}:{dispatch_id:dispatch.id}),status:'pending_verification'}),validateTeam(svc,dispatch),
 ]);
 if(!source||source.is_active===false||!storageTypes.includes(source.warehouse_type)||!destination||destination.id===source.id||(vehicle?vehicle.is_active===false||vehicle.warehouse_id!==destination.id||destination.is_active===false||destination.warehouse_type!=='vehicle'||destination.vehicle_id&&destination.vehicle_id!==vehicle.id:dispatch.vehicle_id||!validEmployeeStockLocation(destination,dispatch.salesperson_id)))throw additionError();
 if(runs.some(run=>run.id!==dispatch.id&&(run.salesperson_id===dispatch.salesperson_id||run.vehicle_warehouse_id===destination.id||dispatch.vehicle_id&&run.vehicle_id===dispatch.vehicle_id||dispatch.driver_id&&run.driver_id===dispatch.driver_id)))throw Error('More than one open load shares this stock or delivery team. Reconcile the assignments before adding goods.');
 if(activities.length||pendingExchanges.length)throw Error('Resolve the recorded return or pending customer exchanges before adding more goods.');
 if(fieldSales.some(sale=>sale.stock_moved_at&&sale.status!=='approved_posted')||orders.some(order=>order.stock_moved_at&&!['delivered','invoiced'].includes(order.status)))throw Error('Complete accounting for stock already supplied before adding more goods.');
 const supplyMoves=await byIds(s.StockMovement,'document_id',[...fieldSales,...orders].map(row=>row.id));
 if(supplyMoves.some(row=>row.status==='approved'&&row.source_warehouse_id===destination.id&&!row.destination_warehouse_id&&(row.document_type==='FieldSale'&&row.movement_type==='field_delivery'&&fieldSales.some(sale=>sale.id===row.document_id&&sale.status!=='approved_posted')||row.document_type==='SalesOrder'&&row.movement_type==='customer_delivery'&&orders.some(order=>order.id===row.document_id&&!['delivered','invoiced'].includes(order.status)))))throw Error('Complete accounting for stock already supplied before adding more goods.');
 for(const balance of balances){const qty=additionQuantity(balance.quantity),value=additionValue(balance.total_value);if(!Number.isFinite(Number(balance.unit_cost))||Number(balance.unit_cost)<0||!qty&&value)throw additionError();appropriatedDegustation(balance);}
 const expected=new Map();let originalValue=0;
 for(const line of manifestLines){const qty=additionQuantity(line.loaded_quantity),value=additionValue(line.loaded_value);if(!line.product_id||expected.has(line.product_id)||!qty||additionQuantity(line.returned_quantity||0)||additionQuantity(line.degustation_returned_quantity||0)||additionQuantity(line.degustation_quantity||0)>qty)throw additionError();expected.set(line.product_id,{quantity:qty,value});originalValue+=value;}
 if(!expected.size||additionValue(dispatch.total_loaded_value)!==originalValue)throw additionError();
 additionTransfers(originalMoves,dispatch,expected);
 const before=await dispatchReconciliationData(svc,dispatch);if(before.hasVariance)throw additionError();
 const selected=await manifest(svc,lines.map(row=>({...row,loaded_quantity:row.quantity,requested_quantity:row.quantity}))),sourceBalances=await records(s.StockBalance,{warehouse_id:source.id});
 for(const {product,quantity} of selected){const usable=sourceBalances.filter(row=>row.product_id===product.id&&Number(row.quantity)>0&&(row.qc_status||'approved')==='approved'&&(!row.expiry_date||row.expiry_date>=date)&&!appropriatedDegustation(row));let available=0;for(const row of usable){available+=additionQuantity(row.quantity);additionValue(row.total_value);if(!Number.isFinite(Number(row.unit_cost))||Number(row.unit_cost)<0)throw additionError();}if(additionQuantity(quantity)>available)throw Error(`Insufficient saleable stock for ${product.name}: ${available/1000} available, ${quantity} required`);}
 const previousMovementIds=new Set(originalMoves.map(row=>row.id)),additions=[];let totalValue=0;
 for(const {line,product,quantity} of selected){
  const result=await stockTransfer(svc,{productId:product.id,productName:product.name,fromWarehouseId:source.id,toWarehouseId:destination.id,toWarehouseName:destination.name,quantity,movementType:'vehicle_load',documentType:'Dispatch',documentId:dispatch.id,movementDate:date,reason:'Additional goods / '+(dispatch.dispatch_number||dispatch.id),saleableOnly:true,preserveRecordedValue:true});
  const prior=manifestLines.find(row=>row.product_id===product.id),loadedQuantity=round3(Number(prior?.loaded_quantity||0)+quantity),loadedValue=(additionValue(prior?.loaded_value??0)+additionValue(result.totalValue))/100,degustation=round3(Number(prior?.degustation_quantity||0)+line.degustation_quantity);
  const after={loaded_quantity:loadedQuantity,loaded_value:loadedValue,degustation_quantity:degustation};
  const saved=prior?await s.DispatchLine.update(prior.id,{...after,requested_quantity:round3(Number(prior.requested_quantity??prior.loaded_quantity)+quantity),unit_cost:round2(loadedValue/loadedQuantity)}):await s.DispatchLine.create({dispatch_id:dispatch.id,product_id:product.id,product_name:product.name,unit:stockUnit(product),requested_quantity:quantity,...after,unit_cost:round2(loadedValue/loadedQuantity),unit_price:amount(product.selling_price)});
  totalValue=round2(totalValue+result.totalValue);additions.push({product_id:product.id,quantity,degustation_quantity:line.degustation_quantity,value:result.totalValue,manifest_line_id:saved.id,after});
 }
 const transferMoves=(await records(s.StockMovement,{document_type:'Dispatch',document_id:dispatch.id,movement_type:'vehicle_load'})).filter(row=>!previousMovementIds.has(row.id));
 additionTransfers(transferMoves,dispatch,new Map(additions.map(row=>[row.product_id,{quantity:additionQuantity(row.quantity),value:additionValue(row.value)}])));
 for(const row of transferMoves)await s.StockMovement.update(row.id,{dispatch_load_addition_id:id,dispatch_load_addition_policy:DISPATCH_TOP_UP_POLICY});
 await issueDegustation(svc,user,team.commercial,dispatch,selected,date,{eventId:id});
 const giveaway=await additionGiveawayProof(svc,dispatch,id,additions,user.id),now=new Date().toISOString();
 const saved=await s.Dispatch.update(dispatch.id,{total_loaded_value:(originalValue+additionValue(totalValue))/100,dispatch_load_addition_id:id,dispatch_load_addition_policy:DISPATCH_TOP_UP_POLICY,dispatch_load_addition_at:now});
 const after=await dispatchReconciliationData(svc,saved);if(after.hasVariance)throw additionError();
 const transfers=await records(s.StockMovement,{dispatch_load_addition_id:id});
 const proof={id,policy:DISPATCH_TOP_UP_POLICY,dispatch_id:dispatch.id,date,payload,fingerprint,total_value:totalValue,lines:additions,transfers:proofSort(transfers.map(movementProof)),giveaway};
 await s.AuditLog.create({id,action:'add_dispatch_stock',module:'distribution',entity_type:'Dispatch',entity_id:dispatch.id,user_id:user.id,audit_source:'server_verified',description:'Additional goods issued to '+(dispatch.salesperson_name||team.commercial.full_name)+' / '+(dispatch.dispatch_number||dispatch.id),reason:notes,dispatch_load_addition:proof,dispatch_load_addition_checksum:additionHash(proof)});
 return {dispatch:saved,totalValue,vehicleWarehouseId:destination.id,reused:false,addition:{id,policy:DISPATCH_TOP_UP_POLICY,date}};
}

async function records(entity, query = {}) {
  const result = [], seen = new Set();
  for (let offset = 0; ; offset += 200) {
    const page = await entity.filter(query, 'id', 200, offset);
    if (!Array.isArray(page)) throw new Error('Could not read the complete dispatch records');
    for (const row of page) {
      if (seen.has(row.id)) throw new Error('Dispatch records changed. Refresh and retry.');
      seen.add(row.id); result.push(row);
    }
    if (page.length < 200) return result;
  }
}

async function byIds(entity, key, ids) {
  const unique = [...new Set(ids)].filter(Boolean), result = [];
  for (let offset = 0; offset < unique.length; offset += 100) result.push(...await records(entity, { [key]: { $in: unique.slice(offset, offset + 100) } }));
  return result;
}

async function locations(svc, dispatch) {
  if (!dispatch.warehouse_id) throw new Error('Choose a source warehouse');
  const [source, assignedVehicle] = await Promise.all([
    svc.entities.Warehouse.get(dispatch.warehouse_id), dispatch.vehicle_id ? svc.entities.Vehicle.get(dispatch.vehicle_id) : null,
  ]);
  if (!source || source.is_active === false || !storageTypes.includes(source.warehouse_type)) throw new Error('Load and return finished products through an active finished-goods storage warehouse');
  if(!dispatch.vehicle_id){
    const destination=dispatch.vehicle_warehouse_id?await svc.entities.Warehouse.get(dispatch.vehicle_warehouse_id):await ensureEmployeeStockLocation(svc.entities,dispatch.salesperson_id);
    if(!validEmployeeStockLocation(destination,dispatch.salesperson_id)||destination.id===source.id)throw Error('The assigned employee stock location changed. Ask dispatch management to check this run.');
    return {source,destination,vehicle:null};
  }
  if (!assignedVehicle || assignedVehicle.is_active === false) throw new Error('Assign an active vehicle for this delivery run');
  // Legacy vehicles may already have a dedicated location without its reverse
  // mapping. Recover that link (or provision an empty one) only while writing.
  const vehicle = assignedVehicle.warehouse_id ? assignedVehicle : (await ensureVehicleStockLocation(svc.entities, assignedVehicle)).vehicle;
  if (dispatch.vehicle_warehouse_id && dispatch.vehicle_warehouse_id !== vehicle.warehouse_id) throw new Error('The assigned vehicle stock location changed. Ask dispatch management to correct the run.');
  const destination = await svc.entities.Warehouse.get(vehicle.warehouse_id);
  if (!destination || destination.is_active === false || destination.warehouse_type !== 'vehicle') throw new Error('The vehicle needs an active vehicle warehouse');
  if (source.id === destination.id) throw new Error('Source and vehicle stock locations must differ');
  return { source, vehicle, destination };
}

async function validateTeam(svc, dispatch) {
  if (!dispatch.salesperson_id) throw new Error('Choose an employee to receive goods');
  const [driver, commercial] = await stockStaff(svc.entities,await Promise.all([
    dispatch.driver_id ? svc.entities.Employee.get(dispatch.driver_id) : null, svc.entities.Employee.get(dispatch.salesperson_id),
  ]));
  if (dispatch.driver_id && (!driver || driver.employee_removed_at || driver.status !== 'active' || normalizeRole(driver.access_template || driver.role) !== 'driver')) throw new Error('This run needs an active assigned driver');
  if (!eligibleStockRecipient(commercial)) throw new Error('Choose an active employee other than Hotesse to receive goods.');
  return { driver, commercial };
}

async function manifest(svc, lines) {
  if (!lines.length) throw new Error('Add at least one finished product to load');
  const products = await byIds(svc.entities.Product, 'id', lines.map(line => line.product_id));
  const productMap = new Map(products.map(product => [product.id, product])), seen = new Set(), selected = [];
  for (const line of lines) {
    if (!line.product_id || seen.has(line.product_id)) throw new Error('Use one distinct line for each finished product');
    seen.add(line.product_id);
    const product = productMap.get(line.product_id);
    if (!finishedProduct(product) || product.is_active === false || product.configuration_status === 'draft') throw new Error('Dispatches accept only active, configured finished products');
    const unit = stockUnit(product);
    if (line.unit) {
      let factor;
      try { factor = unitFactor(line.unit, unit); } catch { throw new Error(`Use the registered stock unit ${unit} for ${product.name}`); }
      if (factor !== 1) throw new Error(`Use the registered stock unit ${unit} for ${product.name}; convert the loading quantity before approval`);
    }
    const quantity = round3(nonnegative(present(line.loaded_quantity) ? line.loaded_quantity : line.requested_quantity, 'loaded quantity'));
    const giveaway = degustationQuantity(line.degustation_quantity ?? 0);
    if (giveaway > quantity) throw Error('Dégustation quantity cannot exceed the total loaded quantity.');
    if (quantity > 0) selected.push({ line, product, quantity });
  }
  if (!selected.length) throw new Error('Add at least one positive quantity to load');
  return selected;
}

async function approve(svc, user, dispatch) {
  if (dispatch.status === 'approved') return { dispatch, reused: true };
  if (dispatch.status !== 'pending_approval') throw new Error('Submit the dispatch for approval before approving it');
  const [{ destination }] = await Promise.all([locations(svc, dispatch), validateTeam(svc, dispatch)]);
  await manifest(svc, await records(svc.entities.DispatchLine, { dispatch_id: dispatch.id }));
  const saved = await svc.entities.Dispatch.update(dispatch.id, { status: 'approved', vehicle_warehouse_id: destination.id, approved_by: user.id, approved_at: new Date().toISOString() });
  await audit(svc, { action: 'approve_dispatch', module: 'distribution', entityType: 'Dispatch', entityId: dispatch.id, userId: user.id, description: `Dispatch ${dispatch.dispatch_number || dispatch.id} approved for loading` });
  return { dispatch: saved };
}

async function prepareLoad(svc, dispatch, suppliedLines) {
  const [{ source, destination, vehicle }, team] = await Promise.all([locations(svc, dispatch), validateTeam(svc, dispatch)]);
  const [lines, runs, sourceBalances, vehicleBalances] = await Promise.all([
    suppliedLines || records(svc.entities.DispatchLine, { dispatch_id: dispatch.id }),
    records(svc.entities.Dispatch, { status: { $in: openStates } }),
    records(svc.entities.StockBalance, { warehouse_id: source.id }),
    records(svc.entities.StockBalance, { warehouse_id: destination.id }),
  ]);
  if (runs.some(run => run.id !== dispatch.id && ((vehicle && run.vehicle_id === vehicle.id) || run.vehicle_warehouse_id === destination.id || (dispatch.driver_id && run.driver_id === dispatch.driver_id) || run.salesperson_id === dispatch.salesperson_id))) throw new Error('This vehicle or paired team already has an open delivery run. Return its stock first.');
  if (vehicleBalances.some(balance => number(balance.quantity, 'vehicle stock quantity') !== 0)) throw new Error('The vehicle must be empty before loading a new run');
  // An explicit zero is intentional: do not fall back to the requested amount.
  const toLoad = await manifest(svc, lines), date = today();
  for (const { product, quantity } of toLoad) {
    const usable = sourceBalances.filter(balance => balance.product_id === product.id && (balance.qc_status || 'approved') === 'approved' && (!balance.expiry_date || balance.expiry_date >= date));
    const available = round3(usable.reduce((sum, balance) => sum + nonnegative(balance.quantity, 'source stock quantity'), 0));
    if (quantity > available) throw new Error(`Insufficient saleable stock for ${product.name}: ${available} available, ${quantity} required`);
  }
  return { source, destination, vehicle, ...team, toLoad, date };
}

async function load(svc, user, dispatch) {
  if (openStates.includes(dispatch.status)) return { totalValue: round2(dispatch.total_loaded_value), vehicleWarehouseId: dispatch.vehicle_warehouse_id, reused: true };
  if (dispatch.status !== 'approved') throw new Error('Stock can only be loaded once the dispatch has been approved');
  const { source, destination, vehicle, commercial, toLoad, date } = await prepareLoad(svc, dispatch);
  let totalValue = 0;
  for (const { line, product, quantity } of toLoad) {
    const result = await stockTransfer(svc, {
      productId: product.id, productName: product.name, fromWarehouseId: source.id, toWarehouseId: destination.id, toWarehouseName: destination.name,
      quantity, movementType: 'vehicle_load', documentType: 'Dispatch', documentId: dispatch.id, movementDate: dispatch.dispatch_date || date,
      reason: `Loaded to ${vehicle?.name || destination.name} - ${dispatch.dispatch_number || ''}`, saleableOnly: true, preserveRecordedValue: true,
    });
    totalValue = round2(totalValue + result.totalValue);
    await svc.entities.DispatchLine.update(line.id, { product_name: product.name, unit: stockUnit(product), loaded_quantity: quantity, unit_cost: round2(result.totalValue / quantity), loaded_value: round2(result.totalValue) });
  }
  await issueDegustation(svc, user, commercial, { ...dispatch, vehicle_warehouse_id: destination.id }, toLoad, date);
  const now = new Date().toISOString();
  // Loading and departure are separate employee attestations. A planned or
  // legacy draft date is not evidence that the driver has actually departed.
  await svc.entities.Dispatch.update(dispatch.id, { status: 'loaded', vehicle_warehouse_id: destination.id, total_loaded_value: totalValue, loaded_by: user.id, loaded_at: now, departure_date: null });
  await audit(svc, { action: 'load_dispatch', module: 'distribution', entityType: 'Dispatch', entityId: dispatch.id, userId: user.id, description: `Loaded ${dispatch.dispatch_number || dispatch.id}: ${toLoad.length} finished products` });
  return { totalValue, vehicleWarehouseId: destination.id };
}

async function approveRequest(svc, user, body) {
  if (typeof body.requestId !== 'string' || !body.requestId.trim()) throw new Error('Choose a stock request');
  const request = await svc.entities.DispatchRequest.get(body.requestId);
  if (!request) throw new Error('Stock request not found');
  if (request.status === 'processed') {
    const dispatch = request.dispatch_id ? await svc.entities.Dispatch.get(request.dispatch_id) : null;
    if (!dispatch || dispatch.request_id !== request.id) throw new Error('The processed request has no matching dispatch. Ask dispatch management to review it.');
    return { dispatch, totalValue: round2(dispatch.total_loaded_value), vehicleWarehouseId: dispatch.vehicle_warehouse_id, reused: true };
  }
  if (request.status !== 'pending_approval') throw new Error('This stock request is not awaiting approval');
  periodDates(request.request_date, request.request_date);
  if (!Array.isArray(request.items) || !request.items.length) throw new Error('The request needs at least one finished product');
  const inputLines = request.items.map(item => {
    if (!item || typeof item.product_id !== 'string' || !item.product_id) throw new Error('Each requested item needs a finished product');
    const quantity = round3(nonnegative(item.quantity, 'requested quantity'));
    if (quantity <= 0) throw new Error('Each requested item needs a positive quantity');
    return { product_id: item.product_id, requested_quantity: quantity, loaded_quantity: quantity, degustation_quantity: degustationQuantity(item.degustation_quantity ?? 0) };
  });
  const candidate = {
    id: `request:${request.id}`, warehouse_id: request.source_warehouse_id, vehicle_id: request.vehicle_id,
    driver_id: body.driverId ?? request.driver_id, salesperson_id: body.commercialId ?? request.commercial_id ?? request.salesperson_id,
  };
  const existing = await records(svc.entities.Dispatch, { request_id: request.id });
  if (request.dispatch_id || existing.length) throw new Error('This request already has a dispatch. Review the existing dispatch before issuing stock again.');
  // Reuse the exact loading checks before creating even a draft dispatch.
  const prepared = await prepareLoad(svc, candidate, inputLines);
  const checkedLines = prepared.toLoad.map(({ line, product, quantity }, index) => {
    const unit = stockUnit(product), requestedUnit = request.items[index].unit;
    if (requestedUnit) {
      let factor;
      try { factor = unitFactor(requestedUnit, unit); } catch { throw new Error(`Use the registered stock unit ${unit} for ${product.name}`); }
      if (factor !== 1) throw new Error(`Use the registered stock unit ${unit} for ${product.name}; convert the requested quantity before approval`);
    }
    return { product_id: product.id, product_name: product.name, unit, requested_quantity: quantity, loaded_quantity: quantity, degustation_quantity: line.degustation_quantity || 0, unit_price: amount(product.selling_price) };
  });
  const route = request.route_id ? await svc.entities.Route.get(request.route_id) : null;
  if (request.route_id && (!route || route.is_active === false)) throw new Error('Choose an active delivery route before approving the request');
  const dispatch = await svc.entities.Dispatch.create({
    dispatch_number: `DSP-REQ-${request.id.slice(-12).toUpperCase()}`, dispatch_date: request.request_date, source: 'driver_request', request_id: request.id,
    vehicle_id: prepared.vehicle?.id || '', vehicle_name: prepared.vehicle?.name || prepared.vehicle?.registration || '', vehicle_warehouse_id: prepared.destination.id,
    driver_id: prepared.driver?.id || '', driver_name: prepared.driver?.full_name || '', salesperson_id: prepared.commercial.id, salesperson_name: prepared.commercial.full_name || '',
    warehouse_id: prepared.source.id, warehouse_name: prepared.source.name || '', route_id: route?.id || '', route_name: route?.name || '', status: 'draft', notes: String(request.notes || '').slice(0, 2000),
  });
  for (const line of checkedLines) await svc.entities.DispatchLine.create({ dispatch_id: dispatch.id, ...line });
  const pending = await svc.entities.Dispatch.update(dispatch.id, { status: 'pending_approval' });
  const approved = await approve(svc, user, pending);
  const result = await load(svc, user, approved.dispatch);
  await svc.entities.DispatchRequest.update(request.id, { status: 'processed', dispatch_id: dispatch.id, driver_id: prepared.driver?.id || '', driver_name: prepared.driver?.full_name || '', salesperson_id: prepared.commercial.id, salesperson_name: prepared.commercial.full_name || '', approved_by: user.id, approved_at: new Date().toISOString() });
  await audit(svc, { action: 'approve_dispatch_request', module: 'distribution', entityType: 'DispatchRequest', entityId: request.id, userId: user.id, description: `Stock request ${request.request_number || request.id} approved and issued to its assigned employee` });
  return { dispatch: await svc.entities.Dispatch.get(dispatch.id), ...result };
}

export async function dispatchReconciliationData(svc, dispatch) {
  const ownsVehicleStock = openStates.includes(dispatch.status);
  if (ownsVehicleStock) {
    const runs = await records(svc.entities.Dispatch, { status: { $in: openStates } });
    if (runs.some(run => run.id !== dispatch.id && ((dispatch.vehicle_id && run.vehicle_id === dispatch.vehicle_id) || (dispatch.vehicle_warehouse_id && run.vehicle_warehouse_id === dispatch.vehicle_warehouse_id)))) throw new Error('Multiple open delivery runs share this vehicle. Reconcile the assignments before proceeding.');
  }
  const [lines, orders, fieldSales, balances, returnMovements, replacementMovements, giveawayMovements, centralized] = await Promise.all([
    records(svc.entities.DispatchLine, { dispatch_id: dispatch.id }), records(svc.entities.SalesOrder, { dispatch_id: dispatch.id }),
    records(svc.entities.FieldSale, { dispatch_id: dispatch.id }),
    ownsVehicleStock && dispatch.vehicle_warehouse_id ? records(svc.entities.StockBalance, { warehouse_id: dispatch.vehicle_warehouse_id }) : [],
    dispatch.vehicle_warehouse_id ? records(svc.entities.StockMovement, { document_type: 'Dispatch', document_id: dispatch.id, source_warehouse_id: dispatch.vehicle_warehouse_id, movement_type: 'warehouse_transfer', status: 'approved' }) : [],
    dispatch.vehicle_warehouse_id ? records(svc.entities.StockMovement, { document_type: 'SpoilageRecord', dispatch_id: dispatch.id, source_warehouse_id: dispatch.vehicle_warehouse_id, movement_type: 'promotional_issue', status: 'approved' }) : [],
    dispatch.vehicle_warehouse_id ? records(svc.entities.StockMovement, { document_type: 'Degustation', dispatch_id: dispatch.id, source_warehouse_id: dispatch.vehicle_warehouse_id, movement_type: 'promotional_issue', status: 'approved' }) : [],
    centralCutoverQuantities(svc.entities,dispatch),
  ]);
  const giveaways = degustationState(lines, giveawayMovements);
  const appropriation=appropriationReconciliation(dispatch,balances,giveawayMovements,returnMovements);
  const delivered = orders.filter(order => ['delivered', 'invoiced'].includes(order.status));
  const approvedFields = fieldSales.filter(sale => sale.status === 'approved_posted');
  const orderIds = new Set(orders.map(order => order.id)), fieldIds = new Set(fieldSales.map(sale => sale.id));
  const [orderLines, fieldLines, deliveryMovements] = await Promise.all([
    byIds(svc.entities.SalesOrderLine, 'order_id', delivered.map(order => order.id)), byIds(svc.entities.FieldSaleLine, 'field_sale_id', approvedFields.map(sale => sale.id)),
    byIds(svc.entities.StockMovement, 'document_id', [...orderIds, ...fieldIds]),
  ]);
  const issued = new Map(), consumed = new Map();
  const replacements = new Map();
  for (const movement of replacementMovements) {
    const quantity = amount(movement.quantity);
    consumed.set(movement.product_id, round3((consumed.get(movement.product_id) || 0) + quantity));
    replacements.set(movement.product_id, round3((replacements.get(movement.product_id) || 0) + quantity));
  }
  for (const movement of giveawayMovements) consumed.set(movement.product_id, round3((consumed.get(movement.product_id) || 0) + amount(movement.quantity)));
  for (const movement of deliveryMovements) {
    const orderIssue = movement.document_type === 'SalesOrder' && movement.movement_type === 'customer_delivery' && orderIds.has(movement.document_id);
    const fieldIssue = movement.document_type === 'FieldSale' && movement.movement_type === 'field_delivery' && fieldIds.has(movement.document_id);
    if ((!orderIssue && !fieldIssue) || movement.source_warehouse_id !== dispatch.vehicle_warehouse_id || movement.status !== 'approved' || movement.destination_warehouse_id) continue;
    const key = `${movement.document_type}:${movement.document_id}:${movement.product_id}`;
    issued.set(key, round3((issued.get(key) || 0) + amount(movement.quantity)));
    consumed.set(movement.product_id, round3((consumed.get(movement.product_id) || 0) + amount(movement.quantity)));
  }
  const postedOrderIds = new Set(delivered.filter(order => {
    const supplied = orderLines.filter(line => line.order_id === order.id);
    return supplied.length && supplied.every(line => amount(line.quantity) > 0 && (issued.get(`SalesOrder:${order.id}:${line.product_id}`) || 0) >= round3(line.quantity));
  }).map(order => order.id));
  const postedOrders = delivered.filter(order => postedOrderIds.has(order.id));
  const postedFieldSales = approvedFields.filter(sale => {
    const supplied = fieldLines.filter(line => line.field_sale_id === sale.id);
    return supplied.length && supplied.every(line => amount(line.quantity) > 0 && (issued.get(`FieldSale:${sale.id}:${line.product_id}`) || 0) >= round3(line.quantity));
  });
  const postedFieldIds = new Set(postedFieldSales.map(sale => sale.id));
  const sold = new Map(), values = new Map(), names = new Map();
  const addSale = (line, qty, value) => {
    sold.set(line.product_id, round3((sold.get(line.product_id) || 0) + qty)); values.set(line.product_id, round2((values.get(line.product_id) || 0) + value)); names.set(line.product_id, line.product_name || '');
  };
  for (const line of fieldLines) if (postedFieldIds.has(line.field_sale_id)) addSale(line, amount(line.quantity), amount(line.line_total));
  for (const line of orderLines) {
    if (!postedOrderIds.has(line.order_id)) continue;
    const key = `SalesOrder:${line.order_id}:${line.product_id}`, quantity = Math.min(amount(line.quantity), issued.get(key) || 0);
    if (quantity <= 0) continue;
    issued.set(key, round3((issued.get(key) || 0) - quantity));
    addSale(line, quantity, round2(amount(line.total ?? line.line_total) * quantity / (amount(line.quantity) || 1)));
  }
  const actual = new Map(), returns = new Map();
  for (const balance of balances) { actual.set(balance.product_id, round3((actual.get(balance.product_id) || 0) + Number(balance.quantity || 0))); names.set(balance.product_id, balance.product_name || names.get(balance.product_id)); }
  for (const movement of returnMovements) { returns.set(movement.product_id, round3((returns.get(movement.product_id) || 0) + amount(movement.quantity))); names.set(movement.product_id, movement.product_name || names.get(movement.product_id)); }
  const lineMap = new Map(lines.map(line => [line.product_id, line]));
  const ids = new Set([...lineMap.keys(), ...sold.keys(), ...consumed.keys(), ...actual.keys(), ...returns.keys(),...centralized.keys()]);
  const rows = [...ids].map(productId => {
    const line = lineMap.get(productId), loaded = round3(line?.loaded_quantity || 0), returned = round3(line?.returned_quantity ?? returns.get(productId) ?? 0);
    const confirmedSold = sold.get(productId) || 0, physicalSupplies = consumed.get(productId) || 0;
    const centralizedQuantity=centralized.get(productId)||0;
    const expected = round3(loaded - returned - physicalSupplies - centralizedQuantity), onHand = actual.get(productId) || 0;
    const expensed=appropriation?.products.get(productId);
    return { ...line, product_id: productId, product_name: line?.product_name || names.get(productId) || '', loaded, returned, centralized_quantity:centralizedQuantity, degustation_allocated: giveaways.get(productId)?.allocated || 0, degustation_given: giveaways.get(productId)?.given || 0, degustation_returned: giveaways.get(productId)?.returned || 0, degustation_remaining: giveaways.get(productId)?.remaining || 0,degustation_expensed_quantity:expensed?round3(expensed.remaining_quantity+expensed.given_quantity):0,degustation_expensed_value:expensed?round2(expensed.remaining_value+expensed.given_value):0, sold: confirmedSold, replaced: replacements.get(productId) || 0, consumed: physicalSupplies, expected, actual: onHand, variance: round3(onHand - expected), sales_value: values.get(productId) || 0 };
  });
  let cashSales = 0, creditSales = 0, totalSales = 0;
  for (const sale of [...postedFieldSales, ...postedOrders]) {
    const collected = amount(sale.amount_collected), total = amount(sale.total);
    cashSales = round2(cashSales + collected);
    creditSales = round2(creditSales + (present(sale.amount_due) ? amount(sale.amount_due) : Math.max(0, total - collected)));
    totalSales = round2(totalSales + total);
  }
  return { rows, degustations: degustationHistory(giveawayMovements),degustationAppropriation:appropriation?Object.fromEntries(Object.entries(appropriation).filter(([key])=>key!=='products')):null, degustationCost: round2(giveawayMovements.reduce((sum,m) => sum + Number(m.total_value || 0),0)+(appropriation?appropriation.total_value-appropriation.returned_value:0)), orders: postedOrders, fieldSales: postedFieldSales, cashSales, creditSales, totalSales, hasVariance: rows.some(row => row.variance !== 0), remainingQty: round3(rows.reduce((sum, row) => sum + row.actual, 0)) };
}

async function returnStock(svc, user, dispatch, body={}, {returnRequestId}={}) {
  if (dispatch.status === 'returned') return { totalValue: round2(dispatch.total_returned_value), reused: true };
  if (dispatch.unsold_return_request_id && dispatch.unsold_return_request_id !== returnRequestId) throw Error('Receive the pending unsold return through the warehouse return queue.');
  if (!openStates.includes(dispatch.status)) throw new Error('Only a loaded or in-transit run can return stock');
  if (!dispatch.vehicle_warehouse_id) throw new Error('This dispatch has no vehicle stock location');
  const { source, destination, vehicle } = await locations(svc, dispatch);
  const runs = await records(svc.entities.Dispatch, { status: { $in: openStates } });
  if (runs.some(run => run.id !== dispatch.id && ((vehicle && run.vehicle_id === vehicle.id) || run.vehicle_warehouse_id === destination.id))) throw new Error('Multiple open delivery runs share this vehicle. Reconcile the assignments before returning stock.');
  const [balances, lines] = await Promise.all([records(svc.entities.StockBalance, { warehouse_id: destination.id }), records(svc.entities.DispatchLine, { dispatch_id: dispatch.id })]);
  const quantities = new Map();
  for (const balance of balances) {
    const quantity = nonnegative(balance.quantity, 'vehicle stock quantity');
    if (quantity > 0) quantities.set(balance.product_id, round3((quantities.get(balance.product_id) || 0) + quantity));
  }
  const beforeReturn = await dispatchReconciliationData(svc, dispatch);
  if (beforeReturn.rows.some(row => row.degustation_allocated > 0) && beforeReturn.hasVariance) throw Error('Reconcile the sale and Dégustation stock before receiving this run.');
  const products = await byIds(svc.entities.Product, 'id', [...quantities.keys()]);
  if(body.countedLines!==undefined){
    const counted=body.countedLines,ids=new Set([...lines.map(l=>l.product_id),...quantities.keys()]);
    if(!Array.isArray(counted)||counted.length!==ids.size||new Set(counted.map(r=>r?.product_id)).size!==ids.size)throw Error('Enter the physical return count for every loaded product');
    for(const row of counted){if(!ids.has(row?.product_id)||!['string','number'].includes(typeof row.quantity)||String(row.quantity).trim()===''||!Number.isFinite(Number(row.quantity))||Number(row.quantity)<0||round3(row.quantity)!==round3(quantities.get(row.product_id) || 0))throw Error('Physical return counts differ from current vehicle stock. Reconcile the difference before receiving the return.');}
  }
  const productMap = new Map(products.map(product => [product.id, product]));
  for (const productId of quantities.keys()) if (!finishedProduct(productMap.get(productId))) throw new Error('The vehicle contains non-finished stock. Reconcile the vehicle before returning this run.');
  const appropriated=balances.map(appropriatedDegustation).filter(Boolean);
  for(const marker of appropriated){
    const [expense,inventory]=await Promise.all([svc.entities.Account.get(marker.expense_account_id),svc.entities.Account.get(marker.inventory_account_id)]);
    if(!validPostingRuleAccount(expense,'marketing_degustation_expense')||!validPostingRuleAccount(inventory,'finished_goods_inventory'))throw Error('Review the original Dégustation expense and inventory accounts before receiving this return.');
  }
  if(appropriated.some(marker=>marker.value>0)){
    const periods=await records(svc.entities.AccountingPeriod,{start_date:{$lte:today()},end_date:{$gte:today()}});
    if(!periods.length||periods.some(period=>period.status!=='open'))throw Error('Return expensed Dégustation in an open accounting period.');
  }
  let totalValue = 0;const restored=[];
  for (const [productId, quantity] of quantities) {
    const product = productMap.get(productId);
    const result = await stockTransfer(svc, { productId, productName: product.name, fromWarehouseId: destination.id, toWarehouseId: source.id, toWarehouseName: source.name, quantity, preserveRecordedValue:true,restoreAppropriatedValue:true,dispatchId:dispatch.id, movementType: 'warehouse_transfer', documentType: 'Dispatch', documentId: dispatch.id, movementDate: today(), reason: `Unsold stock returned from ${vehicle?.name || destination.name} - ${dispatch.dispatch_number || ''}` });
    restored.push(...result.layers.filter(layer=>layer.appropriation).map(layer=>({...layer.appropriation,quantity:layer.quantity,value:layer.restoredValue})));
    totalValue = round2(totalValue + result.totalValue);
    const line = lines.find(row => row.product_id === productId);
    if (line) await svc.entities.DispatchLine.update(line.id, { returned_quantity: round3((line.returned_quantity || 0) + quantity), degustation_returned_quantity: round3((line.degustation_returned_quantity || 0) + (beforeReturn.rows.find(row=>row.product_id===productId)?.degustation_remaining || 0)) });
  }
  let restoration=null;
  if(restored.length){
    const values=new Map(),add=(id,value)=>values.set(id,round2((values.get(id)||0)+value));
    for(const row of restored){add(row.inventory_account_id,row.value);add(row.expense_account_id,-row.value);}
    const total=round2(restored.reduce((sum,row)=>sum+row.value,0));let journal=null;
    if(total>0)({journal}=await postJournal(svc,{entryDate:today(),description:'Return of expensed Dégustation / '+(dispatch.dispatch_number||dispatch.id),sourceModule:'degustation',sourceDocumentType:'DegustationReturn',sourceDocumentId:'DEG-RETURN-'+dispatch.id,userId:user.id,lines:[...values].filter(([,value])=>value!==0).map(([account_id,value])=>({account_id,debit:Math.max(0,value),credit:Math.max(0,-value)}))}));
    restoration={id:'DEG-RETURN-'+dispatch.id,date:today(),total_quantity:round3(restored.reduce((sum,row)=>sum+row.quantity,0)),total_value:total,journal_id:journal?.id||'',journal_number:journal?.journal_number||''};
  }
  const expiredReturned = await receiveVehicleExpiredReturns(svc, dispatch, source, user);
  const recon = await dispatchReconciliationData(svc, dispatch);
  await svc.entities.Dispatch.update(dispatch.id, { status: 'returned', total_returned_value: totalValue, total_delivered_value: recon.totalSales, total_cash_collected: recon.cashSales, total_credit_sales: recon.creditSales, return_date: new Date().toISOString(),...(restoration?{degustation_appropriation_return:restoration}:{}),...(returnRequestId?{unsold_return_request_id:'',unsold_return_received_request_id:returnRequestId}:{}),...(body.countedLines?{return_counted_by:user.id,return_counted_lines:body.countedLines}: {}) });
  await audit(svc, { action: 'return_dispatch_stock', module: 'distribution', entityType: 'Dispatch', entityId: dispatch.id, userId: user.id, description: `Returned unsold stock from ${dispatch.dispatch_number || dispatch.id}; ${quantities.size} finished products${recon.hasVariance ? '; reconciliation variance requires review' : ''}` });
  return { totalValue, expiredReturned };
}

export async function dispatchAction(base44, user, body, options={}) {
  const { employee, role } = await requireStaff(base44, user, managers, 'dispatch stock management');
  if (role !== 'admin' && employee?.status !== 'active') throw new Error('An active management staff record is required');
  if (!['approveDispatchRequest', 'approveDispatch', 'loadDispatch', 'returnDispatchStock', 'dispatchReconciliation'].includes(body.action)) throw new Error('Unknown dispatch stock action');
  if (['approveDispatchRequest','approveDispatch','loadDispatch'].includes(body.action) && !canIssueDeliveryStock(role)) throw new Error('Only warehouse management or the General Manager can issue delivery goods');
  const svc = base44.asServiceRole;
  if(['approveDispatchRequest','approveDispatch','loadDispatch'].includes(body.action)&&svc.entities.CompanySettings&&await centralInventoryMode(svc.entities))throw Error('Use centralized company stock; goods issues are no longer required.');
  if (body.action === 'approveDispatchRequest') return approveRequest(svc, user, body);
  if (typeof body.dispatchId !== 'string' || !body.dispatchId.trim()) throw new Error('Choose a dispatch');
  const dispatch = await svc.entities.Dispatch.get(body.dispatchId);
  if (!dispatch) throw new Error('Dispatch not found');
  if (body.action === 'approveDispatch') return approve(svc, user, dispatch);
  if (body.action === 'loadDispatch') return load(svc, user, dispatch);
  if (body.action === 'returnDispatchStock') return returnStock(svc, user, dispatch,body,options);
  return dispatchReconciliationData(svc, dispatch);
}
