import { readRecords } from './commercial-workspace.js';
import { dispatchReconciliationData } from './dispatch-operations.js';
import { today, round3, requireStaff } from './field-ops.js';
import { effectiveRole } from './roles.js';
import { stockUnit } from '../../lib/item-units.js';

const pick = (r, keys) => Object.fromEntries(keys.split(' ').map(k => [k, r?.[k]]));
const productView = p => pick(p, 'id name sku image_url inventory_type size flavor');
const lotView = b => pick(b, 'id lot_number expiry_date qc_status quantity');
const usable = (lots, date) => round3(lots.filter(b => Number(b.quantity) > 0 && (b.qc_status || 'approved') === 'approved' && (!b.expiry_date || b.expiry_date >= date)).reduce((n, b) => n + Number(b.quantity), 0));

export async function fieldInventoryAction(client, user, body) {
  const { role, employee } = await requireStaff(client, user, ['admin', 'driver', 'commercial'], 'viewing assigned inventory');
  client.auth.assertModule?.(role === 'commercial' ? 'commercial' : 'distribution');
  if (role !== 'admin' && body.employeeId && body.employeeId !== employee?.id) throw Error('You can access only your own inventory');
  const staff = role === 'admin' ? await client.asServiceRole.entities.Employee.get(body.employeeId) : employee;
  if (!staff || !['driver', 'commercial'].includes(effectiveRole({ role: 'user' }, staff)) || staff.status !== 'active') throw Error('Choose an active driver or Commercial agent');
  return fieldInventory(client.asServiceRole.entities, staff);
}

export async function fieldInventory(s, employee) {
  const role = effectiveRole({ role: 'user' }, employee), date = today();
  const runs = await readRecords(s.Dispatch, { [role === 'driver' ? 'driver_id' : 'salesperson_id']: employee.id, status: { $in: ['approved', 'loaded', 'in_transit'] } });
  const result = [];
  for (const run of runs) {
    const base = pick(run, 'id dispatch_number dispatch_date status vehicle_name vehicle_warehouse_id driver_name salesperson_name field_stock_request_id');
    try {
      const planned = run.status === 'approved';
      const [balances, lines, reports, expired, vehicle, warehouse, conflicts] = await Promise.all([
        planned ? [] : readRecords(s.StockBalance, { warehouse_id: run.vehicle_warehouse_id }),
        readRecords(s.DispatchLine, { dispatch_id: run.id }), readRecords(s.DriverActivity, { dispatch_id: run.id, type: 'trip_returned' }),
        readRecords(s.SpoilageRecord, { dispatch_id: run.id, record_type: 'field_expired_return' }),
        s.Vehicle.get(run.vehicle_id), s.Warehouse.get(run.vehicle_warehouse_id),
        planned ? [] : readRecords(s.Dispatch, { status: { $in: ['loaded', 'in_transit'] }, $or: [{ vehicle_id: run.vehicle_id }, { vehicle_warehouse_id: run.vehicle_warehouse_id }, { driver_id: run.driver_id }, { salesperson_id: run.salesperson_id }] }),
      ]);
      if (conflicts.some(r => r.id !== run.id)) throw Error('Another open run shares this vehicle or team. Distribution must reconcile the assignment before quantities can be attributed');
      if (!planned && (!vehicle || vehicle.warehouse_id !== run.vehicle_warehouse_id || !warehouse || warehouse.warehouse_type !== 'vehicle')) throw Error('The vehicle stock location changed. Ask Distribution to check this run');
      const reconciliation = planned ? null : await dispatchReconciliationData({ entities: s }, run);
      const records = reconciliation?.rows || lines.map(l => ({ ...l, loaded: l.loaded_quantity || l.requested_quantity, consumed: 0, returned: 0, replaced: 0, expected: 0 }));
      const ids = [...new Set(records.map(r => r.product_id))], products = ids.length ? await readRecords(s.Product, { id: { $in: ids } }) : [];
      const rows = records.map(r => {
        const p = products.find(p => p.id === r.product_id), lots = balances.filter(b => b.product_id === r.product_id && Number(b.quantity) !== 0), available = usable(lots, date);
        return { product: p ? productView(p) : { id: r.product_id, name: r.product_name || 'Unregistered product' }, unit: r.unit || stockUnit(p || {}),
          loaded: r.loaded, supplied: round3(r.consumed - r.replaced), replaced: r.replaced, returned: r.returned, expected: planned ? null : r.expected,
          on_hand: planned ? null : r.actual, usable: planned ? null : available, held: planned ? null : round3(r.actual - available), variance: planned ? null : r.variance, lots: lots.map(lotView) };
      });
      result.push({ ...base, planned, back_at_base: !!reports.length || !!run.return_date, rows, error: '', expired_returns: expired.filter(r => !r.return_received_at).map(r => pick(r, 'id product_name quantity unit returned_lot_number returned_expiry_date')) });
    } catch (error) { result.push({ ...base, rows: [], error: error.message, expired_returns: [] }); }
  }
  const legacy = [];
  if (role === 'commercial') {
    for (const warehouse of await readRecords(s.Warehouse, { warehouse_type: 'commercial_custody', custodian_employee_id: employee.id })) {
      const lots = (await readRecords(s.StockBalance, { warehouse_id: warehouse.id })).filter(b => Number(b.quantity) !== 0);
      const ids = [...new Set(lots.map(b => b.product_id))]; if (!ids.length) continue;
      const products = await readRecords(s.Product, { id: { $in: ids } });
      legacy.push({ id: warehouse.id, name: warehouse.name, rows: ids.map(id => {
        const p = products.find(p => p.id === id), rows = lots.filter(b => b.product_id === id), quantity = round3(rows.reduce((n, b) => n + Number(b.quantity), 0)), available = usable(rows, date);
        return { product: p ? productView(p) : { id, name: rows[0].product_name || id }, unit: stockUnit(p || {}), on_hand: quantity, usable: available, held: round3(quantity - available), lots: rows.map(lotView) };
      }) });
    }
  }
  return { date, updated_at: new Date().toISOString(), employee: pick(employee, 'id full_name'), runs: result, legacy };
}
