import {centralizedInventoryPolicy,CENTRAL_INVENTORY_POLICY} from './centralized-inventory-policy.js';
import {readRecords} from './commercial-workspace.js';
import {journalCents} from './journal-validation.js';

const invalid=()=>Error('Reconcile the protected company-stock cutover before reviewing this delivery load.');
const milli=value=>{const n=Number(value),scaled=Math.round(n*1000);if(!['number','string'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(n)||n<0||!Number.isSafeInteger(scaled)||Math.abs(n*1000-scaled)>0.0001)throw invalid();return scaled;};
const cents=value=>{if(value==null)throw invalid();try{return journalCents(value);}catch{throw invalid();}};
const text=value=>typeof value==='string'&&!!value;
const layerKeys=['lot_number','expiry_date','qc_status','production_order_id','batch_number'];
const layerMatches=(row,line)=>layerKeys.every(key=>(row[key]||'')===(line[key]||''));
const balanceLayerMatches=(row,line)=>layerKeys.filter(key=>key!=='qc_status').every(key=>(row[key]||'')===(line[key]||''));

// A book-location cutover is neither a sale nor a physical warehouse return.
// Reconciliation retains original manifest numbers and discloses this separate
// evidenced quantity. Destination balances may later be sold or replenished.
export async function centralCutoverQuantities(stores,dispatch){
 if(!Object.keys(dispatch||{}).some(key=>key.startsWith('central_inventory_cutover_')))return new Map();
 const policy=await centralizedInventoryPolicy(stores);
 if(!policy||dispatch.central_inventory_cutover_id!==policy.activation_id||dispatch.central_inventory_cutover_policy!==CENTRAL_INVENTORY_POLICY||dispatch.central_inventory_cutover_date!==policy.effective_date||dispatch.central_inventory_cutover_no_physical_return!==true)throw invalid();
 const event=await stores.AuditLog.get(policy.activation_id),proof=event?.central_inventory_cutover;
 if(!proof||proof.policy!==CENTRAL_INVENTORY_POLICY||proof.id!==policy.activation_id||proof.central_warehouse_id!==policy.central_warehouse_id||!Array.isArray(proof.runs)||new Set(proof.runs.map(row=>row?.dispatch_id)).size!==proof.runs.length)throw invalid();
 const matches=proof.runs.filter(row=>row?.dispatch_id===dispatch.id);
 if(matches.length!==1)throw invalid();
 const run=matches[0];
 if(!text(run.source_warehouse_id)||run.source_warehouse_id!==dispatch.vehicle_warehouse_id||run.source_warehouse_id===policy.central_warehouse_id||typeof run.completed!=='boolean'||run.completed&&dispatch.status!=='completed'||!Array.isArray(run.lines)||milli(run.quantity)!==milli(dispatch.central_inventory_cutover_quantity))throw invalid();
 const sourceIds=new Set(),destinationIds=new Set(),movementIds=new Set(),quantities=new Map();let totalQuantity=0,totalValue=0;
 for(const line of run.lines){
  if(!line||!text(line.product_id)||!text(line.source_balance_id)||!text(line.destination_balance_id)||!text(line.source_movement_id)||!text(line.destination_movement_id)||line.source_balance_id===line.destination_balance_id||line.source_movement_id===line.destination_movement_id||sourceIds.has(line.source_balance_id)||destinationIds.has(line.destination_balance_id)||movementIds.has(line.source_movement_id)||movementIds.has(line.destination_movement_id)||!milli(line.quantity))throw invalid();
  sourceIds.add(line.source_balance_id);destinationIds.add(line.destination_balance_id);movementIds.add(line.source_movement_id);movementIds.add(line.destination_movement_id);
  totalQuantity+=milli(line.quantity);totalValue+=cents(line.total_value);
  if(!Number.isSafeInteger(totalQuantity)||!Number.isSafeInteger(totalValue))throw invalid();
  quantities.set(line.product_id,(quantities.get(line.product_id)||0)+milli(line.quantity));
 }
 if(totalQuantity!==milli(run.quantity)||totalValue!==cents(run.total_value))throw invalid();
 const movements=await readRecords(stores.StockMovement,{document_type:'CentralInventoryCutover',document_id:policy.activation_id,dispatch_id:dispatch.id});
 if(movements.length!==movementIds.size||new Set(movements.map(row=>row.id)).size!==movements.length||movements.some(row=>!movementIds.has(row.id)))throw invalid();
 const balanceIds=[...new Set([...sourceIds,...destinationIds])],balances=[];
 for(let offset=0;offset<balanceIds.length;offset+=100)balances.push(...await readRecords(stores.StockBalance,{id:{$in:balanceIds.slice(offset,offset+100)}}));
 const byId=new Map(balances.map(row=>[row.id,row]));
 for(const line of run.lines){
  const sourceBalance=byId.get(line.source_balance_id),destinationBalance=byId.get(line.destination_balance_id);
  for(const [balance,warehouse] of [[sourceBalance,run.source_warehouse_id],[destinationBalance,policy.central_warehouse_id]]){
   if(!balance||balance.product_id!==line.product_id||balance.warehouse_id!==warehouse||!balanceLayerMatches(balance,line)||balance.central_inventory_cutover_id!==policy.activation_id||balance.central_inventory_cutover_policy!==CENTRAL_INVENTORY_POLICY||balance.degustation_appropriation_id)throw invalid();
  }
  if(destinationBalance.central_inventory_cutover_source_balance_id!==line.source_balance_id||destinationBalance.central_inventory_cutover_dispatch_id!==dispatch.id)throw invalid();
  const outgoing=movements.find(row=>row.id===line.source_movement_id),incoming=movements.find(row=>row.id===line.destination_movement_id);
  for(const row of [outgoing,incoming]){
   if(!row||row.status!=='approved'||row.movement_type!=='warehouse_transfer'||row.product_id!==line.product_id||row.movement_date!==policy.effective_date||milli(row.quantity)!==milli(line.quantity)||cents(row.total_value)!==cents(line.total_value)||!layerMatches(row,line)||row.central_inventory_cutover_id!==policy.activation_id||row.central_inventory_cutover_policy!==CENTRAL_INVENTORY_POLICY||row.central_inventory_cutover_source_balance_id!==line.source_balance_id||row.central_inventory_cutover_destination_balance_id!==line.destination_balance_id||row.no_physical_return!==true||!Number.isFinite(Number(row.unit_cost))||Number(row.unit_cost)<0)throw invalid();
  }
  if(outgoing.source_warehouse_id!==run.source_warehouse_id||outgoing.destination_warehouse_id||incoming.destination_warehouse_id!==policy.central_warehouse_id||incoming.source_warehouse_id||Number(outgoing.unit_cost)!==Number(incoming.unit_cost))throw invalid();
 }
 return new Map([...quantities].map(([product,quantity])=>[product,quantity/1000]));
}
