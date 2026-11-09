import {centralizedInventoryPolicy} from './centralized-inventory-policy.js';
import {readRecords} from './commercial-workspace.js';

// This is a bookkeeping handoff to manual tracking, not a customer giveaway,
// a sale, or a physical return. Original expensing evidence stays unchanged.
export const PROMOTIONAL_HANDOFF_POLICY='central-promotional-manual-v1';
export async function centralPromotionalHandoff(stores,dispatch){
 const id=dispatch?.central_promotional_handoff_id;
 if(!id)return {quantities:new Map(),balances:[],quantity:0,value:0};
 const invalid=()=>Error('Reconcile the promotional stock handoff to manual tracking.');
 const policy=await centralizedInventoryPolicy(stores),event=await stores.AuditLog.get(id),proof=event?.central_promotional_handoff;
 if(!policy||event?.action!=='handoff_expensed_degustation'||event.module!=='inventory'||event.entity_type!=='Dispatch'||event.entity_id!==dispatch.id||event.audit_source!=='server_verified'||!event.user_id||!proof||proof.policy!==PROMOTIONAL_HANDOFF_POLICY||proof.activation_id!==policy.activation_id||proof.dispatch_id!==dispatch.id||proof.source_warehouse_id!==dispatch.vehicle_warehouse_id||proof.appropriation_id!==dispatch.degustation_appropriation?.id||!Array.isArray(proof.balances)||!proof.balances.length||new Set(proof.balances.map(row=>row.id)).size!==proof.balances.length)throw invalid();
 const movements=await readRecords(stores.StockMovement,{document_type:'CentralPromotionalHandoff',document_id:id}),quantities=new Map();let quantity=0,value=0;
 if(movements.length!==proof.balances.length)throw invalid();
 for(const original of proof.balances){
  const current=await stores.StockBalance.get(original.id),movement=movements.find(row=>row.central_promotional_source_balance_id===original.id),q=Number(original.quantity),v=Number(original.degustation_appropriation_value);
  if(!Number.isFinite(q)||q<=0||!Number.isFinite(v)||v<0||Number(original.unit_cost)!==0||Number(original.total_value)!==0||original.warehouse_id!==proof.source_warehouse_id||original.degustation_appropriation_id!==proof.appropriation_id||original.degustation_appropriation_dispatch_id!==dispatch.id||original.degustation_appropriation_expense_account_id!==dispatch.degustation_appropriation.expense_account_id||Number(original.degustation_appropriation_quantity)!==q)throw invalid();
  if(!current||Number(current.quantity)!==0||Number(current.total_value)!==0||Number(current.unit_cost)!==0||current.central_promotional_handoff_id!==id||Object.keys(current).some(key=>key.startsWith('degustation_appropriation_')))throw invalid();
  if(!movement||movement.status!=='approved'||movement.movement_type!=='promotional_issue'||movement.source_warehouse_id!==proof.source_warehouse_id||movement.destination_warehouse_id||movement.dispatch_id!==dispatch.id||movement.movement_date!==proof.date||movement.central_promotional_handoff_id!==id||Number(movement.quantity)!==q||Number(movement.unit_cost)!==0||Number(movement.total_value)!==0||Number(movement.central_promotional_original_cost)!==v||movement.journal_id)throw invalid();
  if(['product_id','lot_number','expiry_date'].some(key=>(original[key]||'')!==(current[key]||'')||(original[key]||'')!==(movement[key]||'')))throw invalid();
  quantities.set(original.product_id,(quantities.get(original.product_id)||0)+q);quantity+=q;value+=v;
 }
 quantity=Math.round(quantity*1000)/1000;value=Math.round(value*100)/100;
 if(quantity!==proof.total_quantity||value!==proof.original_cost)throw invalid();
 return {quantities,balances:proof.balances,quantity,value};
}
