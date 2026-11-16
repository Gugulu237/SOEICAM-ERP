import { businessDate } from '../../lib/business-date.js';
import { stockOrigin, isExistingStockOrigin } from '../../lib/stock-origin.js';
import { isYogurt } from '../../lib/yogurt-production.js';
import { readRecords } from './commercial-workspace.js';
import { requireStaff } from './field-ops.js';

export async function reviewStockLot(client, user, body) {
  const { role, employee } = await requireStaff(client, user, ['admin', 'production_manager', 'warehouse_manager', 'employee'], 'quality release');
  if (role !== 'admin' && employee?.status !== 'active') throw Error('An active staff account is required.');
  client.auth.assertModule?.('quality');
  const s = client.asServiceRole.entities;
  if (typeof body.balanceId !== 'string' || !['approved', 'rejected'].includes(body.status)) throw Error('Choose a stock lot awaiting quality review.');
  const lot = await s.StockBalance.get(body.balanceId);
  if (!lot || Number(lot.quantity) <= 0) throw Error('Choose a stock lot awaiting quality review.');
  const [order, location, movements] = await Promise.all([
    lot.production_order_id ? s.ProductionOrder.get(lot.production_order_id) : null,
    s.Warehouse.get(lot.warehouse_id),
    readRecords(s.StockMovement, { product_id: lot.product_id, destination_warehouse_id: lot.warehouse_id }),
  ]);
  if (!location || location.is_active === false || location.field_return_bin || lot.inventory_recovery_id ||
      lot.exchange_return_record_id || lot.stock_origin === 'sale_reversal' || isExistingStockOrigin(stockOrigin(lot, movements))) {
    throw Error('Review this stock through its recovery or inventory correction workflow.');
  }
  if (isYogurt(order)) throw Error('Review yogurt lots through the checked quality release workflow.');
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes.length > 2000) throw Error('Enter up to 2,000 characters of quality notes.');
  if (lot.qc_status === body.status && lot.qc_released_by_user_id) return { reviewed: true, reused: true };
  if (lot.qc_status !== 'quarantine') throw Error('This lot is no longer awaiting quality review.');
  const now = new Date().toISOString(), name = employee?.full_name || user.full_name || user.email || user.id;
  await s.StockBalance.update(lot.id, {
    qc_status: body.status, qc_notes: notes, qc_released_by: name,
    qc_released_by_user_id: user.id, qc_released_at: now,
  });
  await s.StockMovement.create({
    product_id: lot.product_id, product_name: lot.product_name, quantity: Number(lot.quantity),
    source_warehouse_id: lot.warehouse_id, destination_warehouse_id: lot.warehouse_id,
    lot_number: lot.lot_number || '', expiry_date: lot.expiry_date || '',
    movement_type: body.status === 'approved' ? 'quality_release' : 'quality_quarantine',
    status: 'approved', movement_date: businessDate(), unit_cost: Number(lot.unit_cost || 0), total_value: Number(lot.total_value || 0),
    document_type: 'QualityReview', document_id: lot.id, reason: notes || body.status, created_by: user.id,
  });
  if (order && ['awaiting_qc', 'released', 'rejected'].includes(order.status)) {
    const lots = await readRecords(s.StockBalance, { production_order_id: order.id });
    const status = lots.some(row => row.qc_status === 'quarantine') ? 'awaiting_qc'
      : lots.some(row => row.qc_status === 'rejected') ? 'rejected' : 'released';
    await s.ProductionOrder.update(order.id, { status });
  }
  await s.AuditLog.create({
    action: 'batch_' + body.status, module: 'quality', entity_type: 'StockBalance', entity_id: lot.id,
    user_id: user.id, user_name: name, description: lot.product_name, reason: notes,
  });
  return { reviewed: true };
}
