import {createHash} from 'node:crypto';
import {stockOrigin,isExistingStockOrigin} from '../../lib/stock-origin.js';
import {companySalesWarehouse} from '../../lib/sales-stock.js';
import {isAssemblyInventoryType} from '../../lib/item-types.js';
import {principalRole} from './roles.js';
import {readRecords} from './commercial-workspace.js';

export const EXISTING_STOCK_ACTIONS = ['existingStockWorkspace','correctExistingStock'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint = row => hash(Object.entries(row).sort(([a],[b]) => a.localeCompare(b)));

// Called only after warehouseAdjustmentAction checks active staff and the
// dedicated adjustment grant. The function route wraps the write in a transaction.
export async function existingStockAction(stores,user,employee,body) {
  const isGM = principalRole(user,employee) === 'admin';
  let eventId,payload;
  if (body.action === 'correctExistingStock') {
    if (!/^[a-f0-9-]{36}$/i.test(body.requestKey || '')) throw Error('Reopen the correction for a valid save reference.');
    eventId = 'WA-' + hash([user.id,body.requestKey]).slice(0,40);payload = hash(body);
    const old = await stores.AuditLog.get(eventId);
    if (old) {
      if (old.warehouse_adjustment_payload !== payload) throw Error('This correction reference was used for different details.');
      return {...old.warehouse_adjustment_result,reused:true};
    }
  }
  const [balances,movements,products,warehouses] = await Promise.all([
    readRecords(stores.StockBalance),readRecords(stores.StockMovement),readRecords(stores.Product),readRecords(stores.Warehouse),
  ]);
  const productById = new Map(products.map(p => [p.id,p])),locationById = new Map(warehouses.map(w => [w.id,w]));
  const candidates = balances.filter(b => {
    const p = productById.get(b.product_id);
    return p && p.is_active !== false && !p.item_removed_at && p.configuration_status !== 'draft' && p.inventory_type !== 'service' &&
      Number(b.quantity)>0 && companySalesWarehouse(locationById.get(b.warehouse_id)) &&
      isExistingStockOrigin(stockOrigin(b,movements)) &&
      ['approved','quarantine','quarantined','rejected'].includes(b.qc_status || 'approved') &&
      ((b.qc_status || 'approved') !== 'approved' || b.expiry_date);
  });
  if (body.action === 'existingStockWorkspace') return {
    can_correct_rejected:isGM,
    lots:candidates.map(b => ({id:b.id,product_name:productById.get(b.product_id).name,warehouse_name:locationById.get(b.warehouse_id).name,
      lot_number:b.lot_number || '',quantity:Number(b.quantity),total_value:Number(b.total_value),qc_status:b.qc_status || 'approved',
      expiry_date:b.expiry_date || '',origin:stockOrigin(b,movements),finished:isAssemblyInventoryType(productById.get(b.product_id).inventory_type),fingerprint:fingerprint(b)})),
  };
  if (body.action !== 'correctExistingStock') throw Error('Unknown existing-stock operation.');
  const reference=typeof body.reference==='string'?body.reference.trim():'',reason=typeof body.reason==='string'?body.reason.trim():'';
  if (reference.length<3 || reference.length>200 || reason.length<5 || reason.length>1000) throw Error('Enter a correction reference and reason.');
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length>200) throw Error('Select between 1 and 200 existing stock lots.');
  const chosen=[],seen=new Set();
  for (const input of body.rows) {
    const b=candidates.find(row=>row.id===input?.id);
    if (!b || seen.has(b.id)) throw Error('Choose distinct opening or adjusted stock lots. Production, recovered and issued stock cannot be corrected here.');
    if (input.fingerprint!==fingerprint(b)) throw Error('Stock changed since this review. Refresh and check the stock again.');
    if (b.qc_status==='rejected' && (!isGM || body.confirm_rejected_stock!==true)) throw Error('The General Manager must confirm that rejected imported stock is physically usable and was rejected by mistake.');
    seen.add(b.id);chosen.push(b);
  }
  const now=new Date().toISOString();
  for (const b of chosen) await stores.StockBalance.update(b.id,{
    qc_status:'approved',expiry_date:'',qc_released_by_user_id:user.id,qc_released_at:now,
    qc_notes:'Existing stock correction: '+reference+' - '+reason,
  });
  const result={id:eventId,corrected:chosen.length,rows:chosen.map(b=>({id:b.id,product_id:b.product_id,quantity:Number(b.quantity),total_value:Number(b.total_value),previous_qc_status:b.qc_status || 'approved',previous_expiry_date:b.expiry_date || '',origin:stockOrigin(b,movements)}))};
  await stores.AuditLog.create({id:eventId,action:'correct_existing_stock',module:'inventory_adjustment',entity_type:'WarehouseAdjustment',entity_id:eventId,
    user_id:user.id,user_name:employee?.full_name || user.full_name || user.email,description:reference,reason,
    warehouse_adjustment_payload:payload,warehouse_adjustment_result:result,rejected_stock_confirmed:body.confirm_rejected_stock===true});
  return result;
}
