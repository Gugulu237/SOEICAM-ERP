import { requireStaff, stockTransfer, audit, round2, round3, today } from './field-ops.js';
import { finishedProduct, periodDates } from './commercial-rules.js';
import { normalizeRole } from './roles.js';
import { stockUnit, unitFactor } from '../../lib/item-units.js';
import { ensureVehicleStockLocation } from './vehicle-locations.js';
import { receiveVehicleExpiredReturns } from './commercial-returns.js';
import { DISPATCH_MANAGER_ROLES } from '../../lib/operations-access.js';

// These operations execute inside the function route's serializable transaction.
// All validation is completed before the first stock write. A load is custody,
// not a sale, and no accounting entry is posted by this module.
const managers = DISPATCH_MANAGER_ROLES;
const openStates = ['loaded', 'in_transit'];
const storageTypes = ['finished_goods', 'cold_room', 'general'];
const present = value => value !== undefined && value !== null && value !== '';
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
  if (!dispatch.warehouse_id || !dispatch.vehicle_id) throw new Error('Choose a source warehouse and an assigned vehicle');
  const [source, assignedVehicle] = await Promise.all([
    svc.entities.Warehouse.get(dispatch.warehouse_id), svc.entities.Vehicle.get(dispatch.vehicle_id),
  ]);
  if (!source || source.is_active === false || !storageTypes.includes(source.warehouse_type)) throw new Error('Load and return finished products through an active finished-goods storage warehouse');
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
  if (!dispatch.driver_id || !dispatch.salesperson_id || dispatch.driver_id === dispatch.salesperson_id) throw new Error('Assign both a driver and a commercial sales agent before loading');
  const [driver, commercial] = await Promise.all([
    svc.entities.Employee.get(dispatch.driver_id), svc.entities.Employee.get(dispatch.salesperson_id),
  ]);
  if (!driver || driver.status !== 'active' || normalizeRole(driver.role) !== 'driver') throw new Error('This run needs an active assigned driver');
  if (!commercial || commercial.status !== 'active' || normalizeRole(commercial.role) !== 'commercial') throw new Error('This run needs an active assigned commercial sales agent');
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
  if (runs.some(run => run.id !== dispatch.id && (run.vehicle_id === vehicle.id || run.vehicle_warehouse_id === destination.id || run.driver_id === dispatch.driver_id || run.salesperson_id === dispatch.salesperson_id))) throw new Error('This vehicle or paired team already has an open delivery run. Return its stock first.');
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
  const { source, destination, vehicle, toLoad, date } = await prepareLoad(svc, dispatch);
  let totalValue = 0;
  for (const { line, product, quantity } of toLoad) {
    const result = await stockTransfer(svc, {
      productId: product.id, productName: product.name, fromWarehouseId: source.id, toWarehouseId: destination.id, toWarehouseName: destination.name,
      quantity, movementType: 'vehicle_load', documentType: 'Dispatch', documentId: dispatch.id, movementDate: dispatch.dispatch_date || date,
      reason: `Loaded to ${vehicle.name || 'vehicle'} - ${dispatch.dispatch_number || ''}`, saleableOnly: true,
    });
    totalValue = round2(totalValue + result.totalValue);
    await svc.entities.DispatchLine.update(line.id, { product_name: product.name, unit: stockUnit(product), loaded_quantity: quantity, unit_cost: round2(result.totalValue / quantity), loaded_value: round2(result.totalValue) });
  }
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
    return { product_id: item.product_id, requested_quantity: quantity, loaded_quantity: quantity };
  });
  const candidate = {
    id: `request:${request.id}`, warehouse_id: request.source_warehouse_id, vehicle_id: request.vehicle_id,
    driver_id: body.driverId || request.driver_id, salesperson_id: body.commercialId || request.commercial_id || request.salesperson_id,
  };
  const existing = await records(svc.entities.Dispatch, { request_id: request.id });
  if (request.dispatch_id || existing.length) throw new Error('This request already has a dispatch. Review the existing dispatch before issuing stock again.');
  // Reuse the exact loading checks before creating even a draft dispatch.
  const prepared = await prepareLoad(svc, candidate, inputLines);
  const checkedLines = prepared.toLoad.map(({ product, quantity }, index) => {
    const unit = stockUnit(product), requestedUnit = request.items[index].unit;
    if (requestedUnit) {
      let factor;
      try { factor = unitFactor(requestedUnit, unit); } catch { throw new Error(`Use the registered stock unit ${unit} for ${product.name}`); }
      if (factor !== 1) throw new Error(`Use the registered stock unit ${unit} for ${product.name}; convert the requested quantity before approval`);
    }
    return { product_id: product.id, product_name: product.name, unit, requested_quantity: quantity, loaded_quantity: quantity, unit_price: amount(product.selling_price) };
  });
  const route = request.route_id ? await svc.entities.Route.get(request.route_id) : null;
  if (request.route_id && (!route || route.is_active === false)) throw new Error('Choose an active delivery route before approving the request');
  const dispatch = await svc.entities.Dispatch.create({
    dispatch_number: `DSP-REQ-${request.id.slice(-12).toUpperCase()}`, dispatch_date: request.request_date, source: 'driver_request', request_id: request.id,
    vehicle_id: prepared.vehicle.id, vehicle_name: prepared.vehicle.name || prepared.vehicle.registration || '', vehicle_warehouse_id: prepared.destination.id,
    driver_id: prepared.driver.id, driver_name: prepared.driver.full_name || '', salesperson_id: prepared.commercial.id, salesperson_name: prepared.commercial.full_name || '',
    warehouse_id: prepared.source.id, warehouse_name: prepared.source.name || '', route_id: route?.id || '', route_name: route?.name || '', status: 'draft', notes: String(request.notes || '').slice(0, 2000),
  });
  for (const line of checkedLines) await svc.entities.DispatchLine.create({ dispatch_id: dispatch.id, ...line });
  const pending = await svc.entities.Dispatch.update(dispatch.id, { status: 'pending_approval' });
  const approved = await approve(svc, user, pending);
  const result = await load(svc, user, approved.dispatch);
  await svc.entities.DispatchRequest.update(request.id, { status: 'processed', dispatch_id: dispatch.id, driver_id: prepared.driver.id, driver_name: prepared.driver.full_name || '', salesperson_id: prepared.commercial.id, salesperson_name: prepared.commercial.full_name || '', approved_by: user.id, approved_at: new Date().toISOString() });
  await audit(svc, { action: 'approve_dispatch_request', module: 'distribution', entityType: 'DispatchRequest', entityId: request.id, userId: user.id, description: `Stock request ${request.request_number || request.id} approved and loaded for its paired delivery team` });
  return { dispatch: await svc.entities.Dispatch.get(dispatch.id), ...result };
}

export async function dispatchReconciliationData(svc, dispatch) {
  const ownsVehicleStock = openStates.includes(dispatch.status);
  if (ownsVehicleStock) {
    const runs = await records(svc.entities.Dispatch, { status: { $in: openStates } });
    if (runs.some(run => run.id !== dispatch.id && (run.vehicle_id === dispatch.vehicle_id || (dispatch.vehicle_warehouse_id && run.vehicle_warehouse_id === dispatch.vehicle_warehouse_id)))) throw new Error('Multiple open delivery runs share this vehicle. Reconcile the assignments before proceeding.');
  }
  const [lines, orders, fieldSales, balances, returnMovements, replacementMovements] = await Promise.all([
    records(svc.entities.DispatchLine, { dispatch_id: dispatch.id }), records(svc.entities.SalesOrder, { dispatch_id: dispatch.id }),
    records(svc.entities.FieldSale, { dispatch_id: dispatch.id }),
    ownsVehicleStock && dispatch.vehicle_warehouse_id ? records(svc.entities.StockBalance, { warehouse_id: dispatch.vehicle_warehouse_id }) : [],
    dispatch.vehicle_warehouse_id ? records(svc.entities.StockMovement, { document_type: 'Dispatch', document_id: dispatch.id, source_warehouse_id: dispatch.vehicle_warehouse_id, movement_type: 'warehouse_transfer', status: 'approved' }) : [],
    dispatch.vehicle_warehouse_id ? records(svc.entities.StockMovement, { document_type: 'SpoilageRecord', dispatch_id: dispatch.id, source_warehouse_id: dispatch.vehicle_warehouse_id, movement_type: 'promotional_issue', status: 'approved' }) : [],
  ]);
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
  const ids = new Set([...lineMap.keys(), ...sold.keys(), ...consumed.keys(), ...actual.keys(), ...returns.keys()]);
  const rows = [...ids].map(productId => {
    const line = lineMap.get(productId), loaded = round3(line?.loaded_quantity || 0), returned = round3(line?.returned_quantity ?? returns.get(productId) ?? 0);
    const confirmedSold = sold.get(productId) || 0, physicalSupplies = consumed.get(productId) || 0;
    const expected = round3(loaded - returned - physicalSupplies), onHand = actual.get(productId) || 0;
    return { ...line, product_id: productId, product_name: line?.product_name || names.get(productId) || '', loaded, returned, sold: confirmedSold, replaced: replacements.get(productId) || 0, consumed: physicalSupplies, expected, actual: onHand, variance: round3(onHand - expected), sales_value: values.get(productId) || 0 };
  });
  let cashSales = 0, creditSales = 0, totalSales = 0;
  for (const sale of [...postedFieldSales, ...postedOrders]) {
    const collected = amount(sale.amount_collected), total = amount(sale.total);
    cashSales = round2(cashSales + collected);
    creditSales = round2(creditSales + (present(sale.amount_due) ? amount(sale.amount_due) : Math.max(0, total - collected)));
    totalSales = round2(totalSales + total);
  }
  return { rows, orders: postedOrders, fieldSales: postedFieldSales, cashSales, creditSales, totalSales, hasVariance: rows.some(row => row.variance !== 0), remainingQty: round3(rows.reduce((sum, row) => sum + row.actual, 0)) };
}

async function returnStock(svc, user, dispatch, body={}) {
  if (dispatch.status === 'returned') return { totalValue: round2(dispatch.total_returned_value), reused: true };
  if (!openStates.includes(dispatch.status)) throw new Error('Only a loaded or in-transit run can return stock');
  if (!dispatch.vehicle_warehouse_id) throw new Error('This dispatch has no vehicle stock location');
  const { source, destination, vehicle } = await locations(svc, dispatch);
  const runs = await records(svc.entities.Dispatch, { status: { $in: openStates } });
  if (runs.some(run => run.id !== dispatch.id && (run.vehicle_id === vehicle.id || run.vehicle_warehouse_id === destination.id))) throw new Error('Multiple open delivery runs share this vehicle. Reconcile the assignments before returning stock.');
  const [balances, lines] = await Promise.all([records(svc.entities.StockBalance, { warehouse_id: destination.id }), records(svc.entities.DispatchLine, { dispatch_id: dispatch.id })]);
  const quantities = new Map();
  for (const balance of balances) {
    const quantity = nonnegative(balance.quantity, 'vehicle stock quantity');
    if (quantity > 0) quantities.set(balance.product_id, round3((quantities.get(balance.product_id) || 0) + quantity));
  }
  const products = await byIds(svc.entities.Product, 'id', [...quantities.keys()]);
  if(body.countedLines!==undefined){
    const counted=body.countedLines,ids=new Set([...lines.map(l=>l.product_id),...quantities.keys()]);
    if(!Array.isArray(counted)||counted.length!==ids.size||new Set(counted.map(r=>r?.product_id)).size!==ids.size)throw Error('Enter the physical return count for every loaded product');
    for(const row of counted){if(!ids.has(row?.product_id)||!['string','number'].includes(typeof row.quantity)||String(row.quantity).trim()===''||!Number.isFinite(Number(row.quantity))||Number(row.quantity)<0||round3(row.quantity)!==round3(quantities.get(row.product_id) || 0))throw Error('Physical return counts differ from current vehicle stock. Reconcile the difference before receiving the return.');}
  }
  const productMap = new Map(products.map(product => [product.id, product]));
  for (const productId of quantities.keys()) if (!finishedProduct(productMap.get(productId))) throw new Error('The vehicle contains non-finished stock. Reconcile the vehicle before returning this run.');
  let totalValue = 0;
  for (const [productId, quantity] of quantities) {
    const product = productMap.get(productId);
    const result = await stockTransfer(svc, { productId, productName: product.name, fromWarehouseId: destination.id, toWarehouseId: source.id, toWarehouseName: source.name, quantity, movementType: 'warehouse_transfer', documentType: 'Dispatch', documentId: dispatch.id, movementDate: today(), reason: `Unsold stock returned from ${vehicle.name || 'vehicle'} - ${dispatch.dispatch_number || ''}` });
    totalValue = round2(totalValue + result.totalValue);
    const line = lines.find(row => row.product_id === productId);
    if (line) await svc.entities.DispatchLine.update(line.id, { returned_quantity: round3((line.returned_quantity || 0) + quantity) });
  }
  const expiredReturned = await receiveVehicleExpiredReturns(svc, dispatch, source, user);
  const recon = await dispatchReconciliationData(svc, dispatch);
  await svc.entities.Dispatch.update(dispatch.id, { status: 'returned', total_returned_value: totalValue, total_delivered_value: recon.totalSales, total_cash_collected: recon.cashSales, total_credit_sales: recon.creditSales, return_date: new Date().toISOString(),...(body.countedLines?{return_counted_by:user.id,return_counted_lines:body.countedLines}: {}) });
  await audit(svc, { action: 'return_dispatch_stock', module: 'distribution', entityType: 'Dispatch', entityId: dispatch.id, userId: user.id, description: `Returned unsold stock from ${dispatch.dispatch_number || dispatch.id}; ${quantities.size} finished products${recon.hasVariance ? '; reconciliation variance requires review' : ''}` });
  return { totalValue, expiredReturned };
}

export async function dispatchAction(base44, user, body) {
  const { employee, role } = await requireStaff(base44, user, managers, 'dispatch stock management');
  if (role !== 'admin' && employee?.status !== 'active') throw new Error('An active management staff record is required');
  if (!['approveDispatchRequest', 'approveDispatch', 'loadDispatch', 'returnDispatchStock', 'dispatchReconciliation'].includes(body.action)) throw new Error('Unknown dispatch stock action');
  const svc = base44.asServiceRole;
  if (body.action === 'approveDispatchRequest') return approveRequest(svc, user, body);
  if (typeof body.dispatchId !== 'string' || !body.dispatchId.trim()) throw new Error('Choose a dispatch');
  const dispatch = await svc.entities.Dispatch.get(body.dispatchId);
  if (!dispatch) throw new Error('Dispatch not found');
  if (body.action === 'approveDispatch') return approve(svc, user, dispatch);
  if (body.action === 'loadDispatch') return load(svc, user, dispatch);
  if (body.action === 'returnDispatchStock') return returnStock(svc, user, dispatch,body);
  return dispatchReconciliationData(svc, dispatch);
}
