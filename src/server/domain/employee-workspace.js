import { staffDashboardData } from './staff-workspace.js';
import { hotesseData } from './outlet-workspace.js';
import { requireStaff, effectiveRole } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { finishedProduct } from './commercial-rules.js';
import { businessDate } from '../../lib/business-date.js';
import { reconcileDailyCash } from '../../lib/cash-settlement.js';
import { commercialRunInventory } from './commercial-runs.js';
import { canManageDeliveries } from '../../lib/operations-access.js';
import { catalogueFromStored, decorateEmployee, TEMPLATE_MODULES } from './role-catalogue.js';

export { businessDate };
const pick = (row, fields) => Object.fromEntries(fields.map((key) => [key, row?.[key]]));
const productFields = ['id', 'name', 'inventory_type', 'image_url', 'size', 'flavor', 'unit_of_measure', 'storage_unit', 'selling_price', 'is_active'];
const locationFields = ['id', 'customer_id', 'name', 'business_name', 'contact_person', 'phone', 'address', 'town', 'neighbourhood', 'gps_lat', 'gps_lng', 'gps_accuracy_m', 'delivery_instructions'];

async function byIds(entity, key, ids) {
  const unique = [...new Set(ids)].filter(Boolean), rows = [];
  for (let i = 0; i < unique.length; i += 100) rows.push(...await readRecords(entity, { [key]: { $in: unique.slice(i, i + 100) } }));
  return rows;
}

export function workspaceSubject(role, employee, requestedId) {
  if (role === 'admin') return requestedId || '';
  if (!TEMPLATE_MODULES[role] || !employee || effectiveRole({ role:'user' },employee) !== role || (employee.status && employee.status !== 'active')) throw new Error('An active linked staff account is required');
  if (requestedId && requestedId !== employee.id) throw new Error('You can access only your own workspace');
  return employee.id;
}

export function validateDriverActivity(dispatch, employee, body, order, returned = false) {
  if (!employee || dispatch?.driver_id !== employee.id) throw new Error('This run is not assigned to you');
  if (!/^[a-f0-9-]{36}$/i.test(body.requestKey || '')) throw new Error('Invalid activity reference');
  const type = body.type;
  if (!['trip_started', 'trip_returned', 'delivery_completed', 'delivery_partial', 'delivery_failed', 'incident'].includes(type)) throw new Error('Unknown driver activity');
  if (returned) throw new Error('This run has been reported back at base; contact dispatch for changes');
  if (type === 'trip_started') {
    if (!['loaded', 'in_transit'].includes(dispatch.status)) throw new Error('The warehouse must load this run before departure');
  } else if (type === 'incident') {
    if (!['approved', 'loaded', 'in_transit'].includes(dispatch.status)) throw new Error('This run is not active');
  } else if (dispatch.status !== 'in_transit') throw new Error('Start the run before recording deliveries or returning to base');
  if (type.startsWith('delivery_')) {
    if (!order || order.dispatch_id !== dispatch.id || (order.driver_id && order.driver_id !== employee.id)
      || !['confirmed', 'ready', 'dispatched', 'partially_delivered', 'delivered', 'invoiced'].includes(order.status)) throw new Error('This customer order is not an eligible stop on your run');
    if (['delivery_completed', 'delivery_partial'].includes(type) && !String(body.receiver || '').trim()) throw new Error('Enter the person who received the goods');
  }
  if (['delivery_partial', 'delivery_failed', 'incident'].includes(type) && !String(body.notes || '').trim()) throw new Error('Describe what happened and any quantities affected');
  if (body.fileUris != null && (!Array.isArray(body.fileUris) || body.fileUris.length > 8 || body.fileUris.some((uri) => typeof uri !== 'string' || !uri.startsWith('private/') || uri.length > 2000))) throw new Error('Attach valid private receipt files');
  return type;
}

export async function employeeWorkspaceAction(base44, user, body) {
  const { employee, role } = await requireStaff(base44, user, Object.keys(TEMPLATE_MODULES), 'employee workspace');
  const svc = base44.asServiceRole;

  if (body.action === 'dispatchActivity') {
    if (!canManageDeliveries(role)) throw new Error('Only dispatch management can review driver reports');
    if (role !== 'admin' && employee?.status !== 'active') throw new Error('An active management staff record is required');
    const dispatch = await svc.entities.Dispatch.get(body.dispatchId);
    if (!dispatch) throw new Error('Run not found');
    return { activities: await readRecords(svc.entities.DriverActivity, { dispatch_id: dispatch.id }) };
  }

  if (body.action === 'driverActivity') {
    if (role !== 'driver' || !employee || (employee.status && employee.status !== 'active')) throw new Error('Only the assigned active driver can record this activity');
    const dispatch = await svc.entities.Dispatch.get(body.dispatchId);
    if (dispatch?.driver_id !== employee.id) throw new Error('This run is not assigned to you');
    const activities = await readRecords(svc.entities.DriverActivity, { dispatch_id: dispatch.id });
    const singleTripEvent = ['trip_started', 'trip_returned'].includes(body.type);
    const previous = activities.find((a) => a.driver_id === employee.id && (a.request_key === body.requestKey || (singleTripEvent && a.type === body.type)));
    if (previous) return { activity: previous, reused: true };
    const order = body.type?.startsWith('delivery_') && body.orderId ? await svc.entities.SalesOrder.get(body.orderId) : null;
    const type = validateDriverActivity(dispatch, employee, body, order, activities.some((a) => a.type === 'trip_returned'));
    const now = new Date().toISOString();
    if (type === 'trip_started' && dispatch.status === 'loaded') {
      await svc.entities.Dispatch.updateMany({ id: dispatch.id, driver_id: employee.id, status: 'loaded' }, { $set: { status: 'in_transit', departure_date: now } });
      const after = await svc.entities.Dispatch.get(dispatch.id);
      if (after.status !== 'in_transit' || after.driver_id !== employee.id) throw new Error('The run assignment or status changed. Refresh before continuing.');
    }
    const latest = await svc.entities.Dispatch.get(dispatch.id);
    validateDriverActivity(latest, employee, body, order);
    const saved = await svc.entities.DriverActivity.upsert([{
      request_key: body.requestKey, dispatch_id: dispatch.id, dispatch_number: dispatch.dispatch_number,
      driver_id: employee.id, driver_name: employee.full_name, recorded_by: user.id, recorded_at: now,
      type, order_id: type.startsWith('delivery_') ? order.id : '', customer_name: type.startsWith('delivery_') ? order.customer_name : '',
      receiver: String(body.receiver || '').trim().slice(0, 200), notes: String(body.notes || '').trim().slice(0, 2000),
      receipt_reference: String(body.receiptReference || '').trim().slice(0, 200), proof_file_uris: body.fileUris || [],
    }], { key: singleTripEvent ? ['dispatch_id', 'driver_id', 'type'] : ['driver_id', 'request_key'] });
    return { activity: saved.records[0] };
  }

  if (body.action !== 'employeeDashboard') throw new Error('Unknown workspace action');
  const id = workspaceSubject(role, employee, body.employeeId);
  const catalogue = await base44.auth?.roleCatalogue?.() || catalogueFromStored(null);
  const assignedRole = employee?.assigned_role || employee?.role || role;
  const mode = role === 'admin' ? body.mode || 'admin' : assignedRole;
  const profile = catalogue.roles[mode];
  // A caller cannot select a stronger template; staff mode always comes from the session.
  const template = role === 'admin' ? mode === 'admin' ? 'admin' : profile?.template_role : role;
  if (!TEMPLATE_MODULES[template]) throw new Error('Choose a supported staff workspace');
  const dashboardMode = mode === 'supply_chain_manager' ? mode : template;
  const allowedModules = role === 'admin' ? mode === 'admin' ? null : profile.modules : employee.allowed_modules || TEMPLATE_MODULES[role];
  const fieldModule = { commercial:'commercial',driver:'distribution',hotesse:'outlets',cashier:'cashier' }[template];
  if (role !== 'admin' && fieldModule && !allowedModules.includes(fieldModule)) throw new Error('This workspace is disabled in your saved role permissions. Contact the General Manager.');
  const staff = role === 'admin' && mode !== 'admin' ? (await readRecords(svc.entities.Employee)).map(person=>decorateEmployee({role:'user'},person,catalogue)).filter(person=>(person.assigned_role || person.role)===mode) : [];
  const choices = staff.map((s) => pick(s, ['id', 'full_name', 'status']));
  const needsEmployee = ['commercial','driver','hotesse'].includes(template);
  if (!id && needsEmployee) return { mode, template, choices, employee: null, allowedModules };
  const subject = mode === 'admin' ? { id: user.id, full_name: user.full_name || user.email || 'General Manager', role: 'admin' }
    : role === 'admin' ? id ? decorateEmployee({role:'user'},await svc.entities.Employee.get(id),catalogue) : null : employee;
  if (id && mode !== 'admin' && (!subject || (subject.assigned_role || subject.role) !== mode)) throw new Error('Select a staff member with the matching role');
  const date = businessDate(), monthStart = date.slice(0, 8) + '01';
  const shared = { mode, template, allowedModules, roleLabel: profile?.label || employee?.role_label || 'General Manager', choices, date, monthStart, employee: subject ? pick(subject, ['id', 'full_name', 'status', 'bonus_plan', 'monthly_customer_target', 'monthly_supply_target', 'commission_rate_percent', 'new_customer_bonus']) : null };

  if (!needsEmployee) return { ...shared, ...await staffDashboardData(svc, dashboardMode, date, allowedModules, subject, role) };
  if (template === 'hotesse') return { ...shared, ...await hotesseData(svc, id, date) };

  if (template === 'commercial') {
    const [inventory, sales, pending, customers, cash, handovers] = await Promise.all([
      commercialRunInventory(svc, id, date),
      readRecords(svc.entities.FieldSale, { commercial_id: id, transaction_date: { $gte: monthStart, $lte: date } }),
      readRecords(svc.entities.FieldSale, { commercial_id: id, status: { $in: ['draft', 'returned', 'submitted', 'under_review', 'posting_failed'] } }),
      readRecords(svc.entities.Customer, { acquired_by_id: id }),
      readRecords(svc.entities.CashCollection, { commercial_id: id, $or: [{ collection_date: { $gte: monthStart, $lte: date } }, { received_at: { $gte: monthStart } }, { status: { $in: ['held_by_commercial', 'handover_submitted', 'partially_received', 'disputed'] } }] }),
      readRecords(svc.entities.CashHandover, { commercial_id: id, $or: [{ handover_date: { $gte: monthStart, $lte: date } }, { received_date: { $gte: monthStart } }, { status: { $in: ['submitted', 'partially_received', 'disputed'] } }] }),
    ]);
    // Include already-settled collections from an older outstanding day so the
    // daily total stays complete, and keep recently settled older days visible.
    const olderDates = [...new Set(cash.filter(c => c.collection_date && c.collection_date < monthStart).map(c => c.collection_date))];
    const completeCash = new Map(cash.map(c => [c.id, c]));
    const completeSales = new Map(sales.map(sale => [sale.id, sale]));
    for (let offset = 0; offset < olderDates.length; offset += 100) {
      for (const collection of await readRecords(svc.entities.CashCollection, { commercial_id: id, collection_date: { $in: olderDates.slice(offset, offset + 100) } })) completeCash.set(collection.id, collection);
      for (const sale of await readRecords(svc.entities.FieldSale, { commercial_id: id, transaction_date: { $in: olderDates.slice(offset, offset + 100) }, status: 'approved_posted', payment_type: 'cash' })) completeSales.set(sale.id, sale);
    }
    return { ...shared, runs: inventory.runs, products: inventory.products, balances: inventory.balances,
      sales: [...new Map([...sales, ...pending].map((s) => [s.id, pick(s, ['id', 'sale_number', 'customer_id', 'customer_name', 'transaction_date', 'status', 'total', 'subtotal', 'amount_collected', 'amount_due', 'payment_type', 'dispatch_id', 'decision_reason', 'created_date'])])).values()],
      customers: customers.map((c) => pick(c, ['id', 'business_name', 'acquisition_date', 'acquisition_verified', 'is_active'])),
      cash: cash.filter(c => c.status !== 'cancelled').map((c) => pick(c, ['id', 'outstanding_amount', 'status'])),
      cashDays: reconcileDailyCash([...completeCash.values()], handovers, [...completeSales.values()]) };
  }

  const since = businessDate(new Date(Date.now() - 30 * 86400000));
  const dispatches = await readRecords(svc.entities.Dispatch, { driver_id: id, $or: [
    { status: { $in: ['approved', 'loaded', 'in_transit', 'returned'] } }, { dispatch_date: { $gte: since, $lte: date }, status: { $in: ['completed', 'cancelled'] } },
  ] });
  const ids = dispatches.map((d) => d.id);
  const [manifest, orders, activities, fieldSales, replacementMovements, expiredCollections] = await Promise.all([
    byIds(svc.entities.DispatchLine, 'dispatch_id', ids), byIds(svc.entities.SalesOrder, 'dispatch_id', ids), byIds(svc.entities.DriverActivity, 'dispatch_id', ids),
    byIds(svc.entities.FieldSale, 'dispatch_id', ids),
    byIds(svc.entities.StockMovement, 'dispatch_id', ids),
    byIds(svc.entities.SpoilageRecord, 'dispatch_id', ids),
  ]);
  const stops = orders.filter((o) => (!o.driver_id || o.driver_id === id) && !['draft', 'credit_hold', 'cancelled'].includes(o.status));
  const postedSales = fieldSales.filter(sale => sale.status === 'approved_posted');
  const [customers, locations, orderLines, vehicleBalances, deliveryMovements] = await Promise.all([
    byIds(svc.entities.Customer, 'id', stops.map((o) => o.customer_id)), byIds(svc.entities.CustomerLocation, 'id', stops.map((o) => o.location_id)), byIds(svc.entities.SalesOrderLine, 'order_id', stops.map((o) => o.id)),
    byIds(svc.entities.StockBalance, 'warehouse_id', dispatches.filter(dispatch => ['loaded', 'in_transit'].includes(dispatch.status)).map(dispatch => dispatch.vehicle_warehouse_id)),
    byIds(svc.entities.StockMovement, 'document_id', [...postedSales, ...stops].map(document => document.id)),
  ]);
  const products = (await byIds(svc.entities.Product, 'id', [...manifest, ...orderLines].map((l) => l.product_id))).filter(finishedProduct);
  return { ...shared,
    dispatches: dispatches.map((d) => pick(d, ['id', 'dispatch_number', 'dispatch_date', 'status', 'route_name', 'vehicle_name', 'vehicle_warehouse_id', 'warehouse_name', 'salesperson_id', 'salesperson_name', 'driver_name', 'departure_date', 'notes'])),
    manifest: manifest.map((l) => pick(l, ['id', 'dispatch_id', 'product_id', 'product_name', 'unit', 'requested_quantity', 'loaded_quantity', 'returned_quantity'])),
    stops: stops.map((o) => ({ ...pick(o, ['id', 'dispatch_id', 'order_number', 'customer_name', 'location_name', 'status', 'delivery_date', 'notes']),
      location: pick(locations.find((l) => l.id === o.location_id && l.customer_id === o.customer_id) || customers.find((c) => c.id === o.customer_id), locationFields) })),
    orderLines: orderLines.map((l) => pick(l, ['id', 'order_id', 'product_id', 'product_name', 'unit', 'quantity'])),
    products: products.map((p) => pick(p, productFields.filter((key) => key !== 'selling_price'))),
    vehicleBalances: vehicleBalances.map(balance => pick(balance, ['warehouse_id', 'product_id', 'quantity', 'qc_status', 'expiry_date'])),
    supplyLines: deliveryMovements.filter(movement => {
      const sale = movement.document_type === 'FieldSale' && movement.movement_type === 'field_delivery' ? postedSales.find(row => row.id === movement.document_id) : null;
      const order = movement.document_type === 'SalesOrder' && movement.movement_type === 'customer_delivery' ? stops.find(row => row.id === movement.document_id) : null;
      const run = dispatches.find(row => row.id === (sale || order)?.dispatch_id);
      return movement.status === 'approved' && run?.vehicle_warehouse_id && movement.source_warehouse_id === run.vehicle_warehouse_id;
    }).map(movement => ({ ...pick(movement, ['product_id', 'quantity']),
      dispatch_id: [...postedSales, ...stops].find(row => row.id === movement.document_id)?.dispatch_id })),
    replacementLines: replacementMovements.filter(movement => movement.document_type === 'SpoilageRecord' && movement.movement_type === 'promotional_issue' && movement.status === 'approved' && dispatches.some(run => run.id === movement.dispatch_id && run.vehicle_warehouse_id === movement.source_warehouse_id)).map(movement => pick(movement, ['dispatch_id', 'product_id', 'quantity'])),
    expiredCollections: expiredCollections.filter(record => record.record_type === 'field_expired_return').map(record => pick(record, ['id', 'dispatch_id', 'customer_name', 'product_name', 'quantity', 'unit', 'reported_date', 'status', 'return_received_at'])),
    activities: activities.filter((a) => a.driver_id === id),
  };
}
