import { createHash } from 'node:crypto';
import { commercialActor } from './commercial-actor.js';
import { supplyRun, assertRunSupplyStock } from './commercial-runs.js';
import { readRecords } from './commercial-workspace.js';
import { reportScope, periodDates, finishedProduct } from './commercial-rules.js';
import { requireStaff, stockIssue, stockReceive, stockTransfer, postJournal, getRuleAccount, audit, today, round2, round3 } from './field-ops.js';
import { stockUnit } from '../../lib/item-units.js';
import { saleItemPostings } from '../../lib/item-posting.js';
import { driverReturnRun, driverReturnWorkspace, assertDriverReturnCustomer } from './driver-returns.js';

const kind = 'field_expired_return';
const requestKind = 'field_expired_request';
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key]]));
const viewFields = ['id', 'record_number', 'customer_id', 'customer_name', 'location_name', 'product_id', 'product_name', 'quantity', 'unit', 'reported_date', 'dispatch_id', 'driver_name', 'vehicle_name', 'commercial_id', 'commercial_name', 'returned_expiry_date', 'returned_lot_number', 'status', 'replacement_dispatch_id', 'replacement_date', 'receipt_reference', 'receipt_file_uris', 'replacement_receipt_file_uris', 'replacement_receipt_reference', 'notes', 'return_received_at', 'request_type', 'replace_now', 'return_id', 'posted_return_id', 'verified_by', 'verified_at', 'review_note', 'rejected_by', 'rejected_at'];
export const expiredReturnView = row => pick(row, viewFields);

async function returnBin(stores, vehicle, branchId = '') {
  const code = 'ER-' + vehicle.id;
  const existing = await readRecords(stores.Warehouse, { code });
  if (existing.length > 1) throw new Error('The expired return location needs management review');
  if (existing[0]) {
    if (existing[0].warehouse_type !== 'quarantine' || existing[0].is_active === false || existing[0].vehicle_id !== vehicle.id) throw new Error('The vehicle expired-return location is not available');
    return existing[0];
  }
  return stores.Warehouse.create({ code, name: `${vehicle.name || 'Vehicle'} - expired customer returns`, warehouse_type: 'quarantine',
    vehicle_id: vehicle.id, field_return_bin: true, branch_id: branchId, is_active: true });
}

async function customerLocation(stores, customer, locationId) {
  if (locationId) {
    const location = await stores.CustomerLocation.get(locationId);
    if (!location || location.customer_id !== customer.id || location.is_active === false) throw new Error('Choose an active outlet belonging to this customer');
    return location;
  }
  const existing = await readRecords(stores.CustomerLocation, { customer_id: customer.id, field_main_address: true, is_active: true });
  if (existing.length > 1) throw new Error('Choose the customer outlet for this return');
  if (existing.length) return existing[0];
  return stores.CustomerLocation.create({ customer_id: customer.id, customer_name: customer.business_name,
    name: 'Main customer address', field_main_address: true, is_headquarters: true, is_active: true,
    ...pick(customer, ['address', 'town', 'neighbourhood', 'phone', 'contact_person', 'gps_lat', 'gps_lng', 'gps_accuracy_m', 'gps_captured_at', 'delivery_instructions']) });
}

async function replace(stores, record, context, date, actorId) {
  await assertRunSupplyStock({ entities: stores }, context, [{ product_id: record.product_id, quantity: record.quantity }], date);
  const issue = await stockIssue({ entities: stores }, { productId: record.product_id, productName: record.product_name,
    warehouseId: context.stock_warehouse_id, quantity: record.quantity, movementType: 'promotional_issue', documentType: 'SpoilageRecord',
    documentId: record.id, dispatchId: context.dispatch_id, movementDate: date, saleableOnly: true,
    reason: `No-charge expired-product replacement for ${record.customer_name} (${record.record_number})` });
  let journal = null;
  if (issue.totalValue > 0) {
    const lines = await saleItemPostings(stores, [{ product_id: record.product_id, quantity: record.quantity, line_total: 0, line_cost: issue.totalValue }],
      { netTotal: 0, costTotal: issue.totalValue, fallback: field => getRuleAccount({ entities: stores }, field === 'cogs_account_id' ? 'direct_material_cogs' : 'finished_goods_inventory') });
    const posted = await postJournal({ entities: stores }, { entryDate: date, sourceModule: 'field_returns', sourceDocumentType: 'SpoilageRecord', sourceDocumentId: record.id,
      description: `Expired-product replacement ${record.record_number} - ${record.customer_name}`, userId: actorId,
      lines: lines.map(line => ({ ...line, description: line.debit ? 'Cost of no-charge replacement' : 'Fresh inventory issued for replacement' })) });
    journal = posted.journal;
  }
  await stores.SpoilageRecord.update(record.id, { status: 'replaced', replaced_by: actorId, replaced_at: new Date().toISOString(), replacement_date: date,
    replacement_dispatch_id: context.dispatch_id, replacement_warehouse_id: context.stock_warehouse_id,
    replacement_cost: issue.totalValue, unit_cost: round2(issue.totalValue / record.quantity), total_value: issue.totalValue,
    journal_id: journal?.id || '', journal_number: journal?.journal_number || '' });
}

// Requests preserve field evidence, but cannot move inventory or post accounting.
// Approval runs in the function route's database transaction and rechecks live stock.
async function reviewReturn(base44, user, body) {
  const svc = base44.asServiceRole, stores = svc.entities;
  const actor = await requireStaff(base44, user, ['admin', 'warehouse_manager'], 'verifying expired exchanges');
  if (actor.role !== 'admin' && actor.employee?.status !== 'active') throw Error('An active Warehouse manager account is required');
  base44.auth.assertModule?.('distribution');
  if (body.action === 'expiredReturnReviewQueue') {
    const requests = await readRecords(stores.SpoilageRecord, { record_type: requestKind, status: 'pending_verification' });
    return { requests: requests.map(expiredReturnView).sort((a, b) => a.reported_date.localeCompare(b.reported_date)) };
  }
  const request = await stores.SpoilageRecord.get(body.requestId);
  if (!request || request.record_type !== requestKind) throw Error('Choose an expired exchange request');
  if (request.status === 'verified' && body.action === 'verifyExpiredReturn') {
    return { request: expiredReturnView(request), record: expiredReturnView(await stores.SpoilageRecord.get(request.posted_return_id)), reused: true };
  }
  if (request.status !== 'pending_verification') throw Error('This request has already been reviewed');
  if (request.recorded_by === user.id) throw Error('A different manager must verify this request');
  const note = String(body.reviewNote || '').trim().slice(0, 2000), timestamp = new Date().toISOString();
  if (body.action === 'rejectExpiredReturn') {
    if (!note) throw Error('Enter the reason for rejecting this request');
    await stores.SpoilageRecord.update(request.id, { status: 'rejected', rejected_by: user.id, rejected_at: timestamp, review_note: note });
    await audit(svc, { action: 'reject_expired_exchange', module: 'field_returns', entityType: 'SpoilageRecord', entityId: request.id, userId: user.id, description: note });
    return { request: expiredReturnView(await stores.SpoilageRecord.get(request.id)) };
  }
  const date = today();
  const [customer, product, context] = await Promise.all([
    stores.Customer.get(request.customer_id), stores.Product.get(request.product_id),
    supplyRun(svc, request.commercial_id, request.dispatch_id, date, true, true),
  ]);
  if (!customer || customer.is_active === false || !finishedProduct(product)) throw Error('The customer or finished product needs management review');
  if (context.vehicle_id !== request.vehicle_id || context.driver_id !== request.driver_id) throw Error('The requested delivery team changed; reject and report the correct run');
  if (request.replace_now) await assertRunSupplyStock(svc, context, [{ product_id: request.product_id, quantity: request.quantity }], date);
  let record;
  if (request.request_type === 'replacement') {
    record = await stores.SpoilageRecord.get(request.return_id);
    if (!record || record.record_type !== kind || record.commercial_id !== request.commercial_id || record.status !== 'reported'
      || record.product_id !== request.product_id || record.quantity !== request.quantity) throw Error('This collection is no longer awaiting this replacement');
    await replace(stores, record, context, date, user.id);
    await stores.SpoilageRecord.update(record.id, { replacement_receipt_file_uris: request.receipt_file_uris,
      replacement_receipt_reference: request.receipt_reference, replacement_recorded_by: request.recorded_by,
      replacement_verified_by: user.id, replacement_verified_at: timestamp });
  } else {
    const vehicle = await stores.Vehicle.get(context.vehicle_id);
    const location = await customerLocation(stores, customer, request.location_id);
    const bin = await returnBin(stores, vehicle);
    const evidence = pick(request, ['record_number', 'request_key', 'request_type', 'replace_now', 'customer_id', 'customer_name', 'product_id', 'product_name', 'quantity', 'unit', 'reported_date', 'dispatch_id', 'driver_id', 'driver_name', 'vehicle_id', 'vehicle_name', 'commercial_id', 'commercial_name', 'recorded_by', 'returned_expiry_date', 'returned_lot_number', 'reason', 'receipt_reference', 'receipt_file_uris', 'notes']);
    record = await stores.SpoilageRecord.create({ ...evidence, record_type: kind, request_id: request.id, status: 'reported',
      location_id: location.id, location_name: location.name, collection_warehouse_id: bin.id,
      unit_cost: 0, total_value: 0, verified_by: user.id, verified_at: timestamp, review_note: note });
    await stockReceive(svc, { productId: product.id, productName: product.name, warehouseId: bin.id, warehouseName: bin.name,
      quantity: request.quantity, unitCost: 0, qcStatus: 'quarantine', lotNumber: 'ER-' + record.id, expiryDate: request.returned_expiry_date,
      documentType: 'SpoilageRecord', documentId: record.id, movementType: 'customer_return', movementDate: date,
      reason: `Verified expired collection from ${customer.business_name}; not available for sale` });
    if (request.replace_now) await replace(stores, record, context, date, user.id);
  }
  await stores.SpoilageRecord.update(request.id, { status: 'verified', verified_by: user.id, verified_at: timestamp, review_note: note, posted_return_id: record.id });
  await audit(svc, { action: 'verify_expired_exchange', module: 'field_returns', entityType: 'SpoilageRecord', entityId: request.id, userId: user.id,
    description: `${request.quantity} ${request.unit} / ${request.customer_name}; reported by ${request.commercial_name}; ${request.replace_now ? 'fresh replacement posted' : 'collection quarantined'}; ${note}` });
  return { request: expiredReturnView(await stores.SpoilageRecord.get(request.id)), record: expiredReturnView(await stores.SpoilageRecord.get(record.id)) };
}

export async function commercialReturnAction(base44, user, body) {
  if (['expiredReturnReviewQueue', 'verifyExpiredReturn', 'rejectExpiredReturn'].includes(body.action)) return reviewReturn(base44, user, body);
  const svc = base44.asServiceRole, stores = svc.entities;
  const actor = await requireStaff(base44, user, ['admin', 'commercial', 'driver'], 'expired collections and replacements');
  if (actor.role !== 'admin' && actor.employee?.status !== 'active') throw Error('An active staff account is required');
  base44.auth.assertModule?.(actor.role === 'driver' ? 'distribution' : 'commercial');
  if (body.action === 'driverReturnsWorkspace') {
    if (actor.role !== 'driver' || body.driverId && body.driverId !== actor.employee.id || body.commercialId) throw Error('Open your own driver workspace');
    const { records, ...workspace } = await driverReturnWorkspace(svc, actor.employee);
    const requests = await readRecords(stores.SpoilageRecord, { record_type: requestKind, driver_id: actor.employee.id });
    return { ...workspace, returns: records.map(expiredReturnView), requests: requests.map(expiredReturnView) };
  }
  if (body.action === 'commercialReturns') {
    const { employee, role } = await requireStaff(base44, user, ['admin', 'commercial'], 'viewing expired returns');
    const commercialId = reportScope(role, employee, body.commercialId);
    if (!commercialId) throw Error('Choose a Commercial agent');
    const [rows, requests] = await Promise.all([
      readRecords(stores.SpoilageRecord, { record_type: kind, commercial_id: commercialId }),
      readRecords(stores.SpoilageRecord, { record_type: requestKind, commercial_id: commercialId }),
    ]);
    return { returns: rows.map(expiredReturnView), requests: requests.map(expiredReturnView) };
  }
  const date = body.date || today();
  periodDates(date, date);
  if (date > today()) throw Error('A customer return cannot be recorded in the future');
  const driver = actor.role === 'driver' ? await driverReturnRun(svc, actor.employee, body, date) : null;
  const employee = driver ? driver.commercial : (await commercialActor(base44, user, body.commercialId, 'recording expired returns and replacements')).employee;
  if (!['recordExpiredReturn', 'replaceExpiredReturn'].includes(body.action)) throw Error('Unknown expired return action');
  if (typeof body.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestKey)) throw Error('Reopen the return form to obtain a valid request reference');
  const replacement = body.action === 'replaceExpiredReturn';
  const reference = String(body.receiptReference || '').trim().slice(0, 200);
  if (!reference) throw Error('Enter the return or replacement receipt reference');
  const photos = await base44.validateReceiptPhotos(body.receiptFileUris, employee.id);
  const fingerprint = createHash('sha256').update(JSON.stringify([body.action, date, body.customerId || '', body.locationId || '', body.dispatchId || '', body.productId || '',
    Number(body.quantity), body.expiryDate || '', body.lotNumber || '', !!body.replaceNow, body.returnId || '', reference, photos, body.notes || ''])).digest('hex');
  const previous = await readRecords(stores.SpoilageRecord, { record_type: requestKind, commercial_id: employee.id, request_key: body.requestKey });
  if (previous.length) {
    if (previous.length !== 1 || previous[0].payload_hash !== fingerprint || previous[0].recorded_by !== user.id) throw Error('This request reference was already used for different details');
    return { record: expiredReturnView(previous[0]), reused: true };
  }
  const context = driver?.context || await supplyRun(svc, employee.id, body.dispatchId, date, true);
  let original = null, customer, product, quantity, location = null;
  if (replacement) {
    original = await stores.SpoilageRecord.get(body.returnId);
    if (!original || original.record_type !== kind || original.commercial_id !== employee.id) throw Error("Choose one of this agent's expired return records");
    if (driver && original.driver_id !== actor.employee.id) throw Error('Only the driver assigned to this collection may replace it');
    if (original.status === 'replaced') return { record: expiredReturnView(original), reused: true };
    if (original.status !== 'reported' || date < original.reported_date) throw Error('This return is not awaiting a replacement on this date');
    const pending = await readRecords(stores.SpoilageRecord, { record_type: requestKind, return_id: original.id, status: 'pending_verification' });
    if (pending.length) throw Error('This replacement is already awaiting verification');
    quantity = original.quantity;
    [customer, product] = await Promise.all([stores.Customer.get(original.customer_id), stores.Product.get(original.product_id)]);
  } else {
    if (typeof body.replaceNow !== 'boolean') throw Error('Choose whether fresh goods are requested for replacement');
    if (!['number', 'string'].includes(typeof body.quantity) || !String(body.quantity).trim() || !Number.isFinite(Number(body.quantity)) || round3(body.quantity) <= 0 || Number(body.quantity) > 1e9) throw Error('Enter the exact positive quantity collected');
    quantity = round3(body.quantity);
    periodDates(body.expiryDate, body.expiryDate);
    if (body.expiryDate >= date) throw Error('The printed expiry date must be before the collection date');
    [customer, product] = await Promise.all([stores.Customer.get(body.customerId), stores.Product.get(body.productId)]);
    if (body.locationId) {
      location = await stores.CustomerLocation.get(body.locationId);
      if (!location || location.customer_id !== customer?.id || location.is_active === false) throw Error('Choose an active outlet belonging to this customer');
    }
  }
  if (!customer || customer.is_active === false) throw Error('Choose an active registered customer');
  if (driver) await assertDriverReturnCustomer(stores, driver.run, customer.id);
  if (!finishedProduct(product)) throw Error('Customer expired returns accept only finished products');
  if (replacement || body.replaceNow) await assertRunSupplyStock(svc, context, [{ product_id: product.id, quantity }], date);
  const record = await stores.SpoilageRecord.create({ record_type: requestKind, record_number: 'ER-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
    request_key: body.requestKey, payload_hash: fingerprint, request_type: replacement ? 'replacement' : 'collection', replace_now: replacement || body.replaceNow,
    return_id: original?.id || '', customer_id: customer.id, customer_name: customer.business_name,
    location_id: location?.id || original?.location_id || '', location_name: location?.name || original?.location_name || 'Main customer address',
    product_id: product.id, product_name: product.name, quantity, unit: stockUnit(product), reported_date: date,
    ...pick(context, ['dispatch_id', 'driver_id', 'driver_name', 'vehicle_id', 'vehicle_name']),
    commercial_id: employee.id, commercial_name: employee.full_name, recorded_by: user.id,
    returned_expiry_date: original?.returned_expiry_date || body.expiryDate, returned_lot_number: original?.returned_lot_number || String(body.lotNumber || '').trim().slice(0, 200),
    reason: 'expired', status: 'pending_verification', receipt_reference: reference, receipt_file_uris: photos, notes: String(body.notes || '').trim().slice(0, 2000) });
  await audit(svc, { action: 'request_expired_exchange', module: 'field_returns', entityType: 'SpoilageRecord', entityId: record.id, userId: user.id,
    description: `${quantity} ${record.unit} / ${customer.business_name}; awaiting independent Warehouse or GM verification; stock and accounting unchanged` });
  return { record: expiredReturnView(record) };
}

// A warehouse return receives the vehicle's separate unsaleable collection bin.
// These customer returns never increase the dispatch's original loaded quantity.
export async function receiveVehicleExpiredReturns(svc, dispatch, source, user) {
  const stores = svc.entities;
  const pending = await readRecords(stores.SpoilageRecord, { record_type: requestKind, vehicle_id: dispatch.vehicle_id, status: 'pending_verification' });
  if (pending.length) throw Error('Verify or reject the vehicle expired exchange requests in Distribution before receiving this run');
  const bins = await readRecords(stores.Warehouse, { vehicle_id: dispatch.vehicle_id, field_return_bin: true, warehouse_type: 'quarantine' });
  let received = 0;
  for (const bin of bins) {
    const balances = await readRecords(stores.StockBalance, { warehouse_id: bin.id });
    const positive = balances.filter(row => Number(row.quantity) > 0);
    if (!positive.length) continue;
    const code = 'ER-BASE-' + source.id;
    const destinations = await readRecords(stores.Warehouse, { code });
    if (destinations.length > 1) throw new Error('The warehouse expired-return location needs management review');
    let destination = destinations[0];
    if (!destination) destination = await stores.Warehouse.create({ code, name: `${source.name} - expired customer returns`, warehouse_type: 'quarantine', is_active: true, field_return_base: true, source_warehouse_id: source.id });
    if (destination.is_active === false || destination.warehouse_type !== 'quarantine' || !destination.field_return_base || destination.source_warehouse_id !== source.id) throw new Error('The warehouse expired-return location needs management review');
    const quantities = new Map();
    positive.forEach(balance => quantities.set(balance.product_id, round3((quantities.get(balance.product_id) || 0) + Number(balance.quantity))));
    for (const [productId, quantity] of quantities) {
      await stockTransfer(svc, { productId, productName: positive.find(row => row.product_id === productId).product_name, fromWarehouseId: bin.id,
        toWarehouseId: destination.id, toWarehouseName: destination.name, quantity, movementType: 'quality_quarantine',
        documentType: 'Dispatch', documentId: dispatch.id, movementDate: today(), reason: 'Expired customer returns handed to warehouse; remain quarantined' });
      received += quantity;
    }
    const records = await readRecords(stores.SpoilageRecord, { record_type: kind, collection_warehouse_id: bin.id });
    for (const record of records.filter(row => !row.return_received_at)) await stores.SpoilageRecord.update(record.id, { return_received_at: new Date().toISOString(), return_received_by: user.id, return_received_warehouse_id: destination.id });
  }
  return received;
}
