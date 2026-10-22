import { requireFinishedStorage } from '../../lib/finished-product-storage.js';
import { requireActiveContext, forbidden } from '../access.js';
import { assertModule } from './role-catalogue.js';
import { WAREHOUSE_MANAGERS, MANAGED_WAREHOUSE_TYPES } from '../../lib/warehouse-workspace.js';
import { businessDate } from '../../lib/business-date.js';
import { readRecords } from './commercial-workspace.js';
const round = (value,digits = 3) => Math.round((Number(value)+Number.EPSILON)*10**digits)/10**digits;

// Called only inside a serializable transaction, with an advisory lock on requestKey.
export async function warehouseTransfer(context,stores,input) {
  requireActiveContext(context); assertModule(context,'inventory');
  if (!WAREHOUSE_MANAGERS.includes(context.role)) throw forbidden('Warehouse management access is required to move stock.');
  const {productId,fromWarehouseId,toWarehouseId,requestKey} = input || {};
  if (![productId,fromWarehouseId,toWarehouseId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 200) || fromWarehouseId === toWarehouseId) throw Error('Select an item and two different warehouses.');
  if (!/^[a-f0-9-]{36}$/i.test(requestKey || '')) throw Error('Invalid transfer reference.');
  const quantity = Number(input.quantity), date = String(input.movementDate || businessDate()), reason = String(input.reason || '').trim();
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity !== round(quantity) || quantity > 1e9) throw Error('Enter a positive quantity with up to three decimal places.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || date > businessDate() || reason.length > 2000) throw Error('Enter a valid movement date and a note of up to 2,000 characters.');
  const payload = JSON.stringify([context.user.id,productId,fromWarehouseId,toWarehouseId,quantity,date,reason]);
  const previous = await readRecords(stores.StockMovement,{document_type:'WarehouseTransfer',document_id:requestKey});
  if (previous.length) {
    if (previous.some(row => row.warehouse_transfer_payload !== payload)) throw Error('This transfer reference was already used for different details. Close and reopen the form.');
    return {reused:true,quantity,totalValue:round(previous.reduce((sum,row) => sum+Number(row.total_value),0),2),movements:previous};
  }
  const [product,from,to] = await Promise.all([stores.Product.get(productId),stores.Warehouse.get(fromWarehouseId),stores.Warehouse.get(toWarehouseId)]);
  if (!product || product.is_active === false || product.configuration_status === 'draft' || product.inventory_type === 'service') throw Error('Choose an active, configured inventory item.');
  if (!from || !to || from.is_active === false || to.is_active === false) throw Error('Choose two active warehouses.');
  if ([from,to].some(w => MANAGED_WAREHOUSE_TYPES.includes(w.warehouse_type))) throw Error('Vehicle loads, agent issues and returns must use Distribution so the delivery inventory stays balanced.');
  requireFinishedStorage(product,to,{isolation:true});
  const today = businessDate();
  const balances = await readRecords(stores.StockBalance,{product_id:productId,warehouse_id:fromWarehouseId});
  // Held/expired goods may move only into isolation; their QC state is preserved or tightened.
  const isolation = ['quarantine','damaged'].includes(to.warehouse_type);
  const lots = balances.filter(row => Number(row.quantity)>0 && (isolation || (row.qc_status || 'approved') === 'approved' && (!row.expiry_date || row.expiry_date >= today)))
    .sort((a,b) => String(a.expiry_date || '9999').localeCompare(String(b.expiry_date || '9999')) || a.id.localeCompare(b.id));
  if (round(lots.reduce((sum,row) => sum+Number(row.quantity),0)) < quantity) throw Error('Insufficient eligible stock. Held or expired lots can only move into quarantine or damaged storage.');
  let remaining = quantity;
  const movements = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    if (Number(lot.quantity) !== round(lot.quantity)) throw Error('Reconcile the lot quantity precision before transferring it.');
    const take = Math.min(Number(lot.quantity),remaining), cost = Number(lot.unit_cost || 0);
    if (!Number.isFinite(cost) || cost < 0) throw Error('Reconcile the stock lot cost before transferring it.');
    const value = take === Number(lot.quantity) ? Number(lot.total_value || 0) : round(take*cost,2);
    if (!Number.isFinite(value) || value < 0 || Number(lot.total_value || 0) < value) throw Error('The lot value needs reconciliation before transfer.');
    const qc = isolation && (lot.qc_status || 'approved') === 'approved' ? 'quarantine' : lot.qc_status || 'approved';
    const targetLots = await readRecords(stores.StockBalance,{product_id:productId,warehouse_id:toWarehouseId,lot_number:lot.lot_number || '',qc_status:qc});
    const target = targetLots.find(row => (row.expiry_date || '') === (lot.expiry_date || '') && (row.production_order_id || '') === (lot.production_order_id || ''));
    if (target && (!Number.isFinite(Number(target.quantity)) || Number(target.quantity) < 0 || !Number.isFinite(Number(target.total_value)) || Number(target.total_value) < 0)) throw Error('Reconcile the destination stock balance before transferring more goods.');
    await stores.StockBalance.update(lot.id,{quantity:round(Number(lot.quantity)-take),total_value:round(Number(lot.total_value || 0)-value,2)});
    const targetQuantity = round(Number(target?.quantity || 0)+take), targetValue = round(Number(target?.total_value || 0)+value,2);
    const stock = {quantity:targetQuantity,total_value:targetValue,unit_cost:targetValue/targetQuantity};
    if (target) await stores.StockBalance.update(target.id,stock);
    else await stores.StockBalance.create({...stock,product_id:productId,product_name:product.name,warehouse_id:toWarehouseId,warehouse_name:to.name,lot_number:lot.lot_number || '',expiry_date:lot.expiry_date || '',qc_status:qc,...(lot.production_order_id ? {production_order_id:lot.production_order_id} : {}),...(lot.batch_number ? {batch_number:lot.batch_number} : {})});
    movements.push(await stores.StockMovement.create({product_id:productId,product_name:product.name,quantity:take,source_warehouse_id:fromWarehouseId,destination_warehouse_id:toWarehouseId,movement_type:to.warehouse_type === 'quarantine' ? 'quality_quarantine' : 'warehouse_transfer',lot_number:lot.lot_number || '',expiry_date:lot.expiry_date || undefined,unit_cost:cost,total_value:value,status:'approved',movement_date:date,document_type:'WarehouseTransfer',document_id:requestKey,warehouse_transfer_payload:payload,reason,created_by:context.user.email,...(lot.production_order_id ? {production_order_id:lot.production_order_id} : {}),...(lot.batch_number ? {batch_number:lot.batch_number} : {})}));
    remaining=round(remaining-take);
  }
  await stores.AuditLog.create({action:'warehouse_transfer',module:'inventory',entity_type:'StockMovement',entity_id:movements[0].id,user_id:context.user.id,description:`Transferred ${quantity} of ${product.name} from ${from.name} to ${to.name}. Reference ${requestKey}`});
  return {quantity,totalValue:round(movements.reduce((sum,row) => sum+Number(row.total_value),0),2),movements};
}
