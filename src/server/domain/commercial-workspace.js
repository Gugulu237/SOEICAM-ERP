import { requireStaff, audit } from './field-ops.js';
import { COMMERCIAL_REPORT_ROLES, canViewAllCommercialReports } from '../../lib/operations-access.js';
import { registrationData, customerGpsData, normalizedPhone, reportScope, periodDates, commercialReport } from './commercial-rules.js';
import { commercialRunInventory } from './commercial-runs.js';
import { commercialActor } from './commercial-actor.js';
import { prepareDeliveryDefinition } from './customer-delivery.js';
import { effectiveRole } from './roles.js';
import { reportAgentCashDeposit } from './agent-cash-deposit.js';

// Positional pagination also works with the SDK version used by older functions.
export async function readRecords(entity, query = {}) {
  const rows = [];
  const seen = new Set();
  for (let skip = 0; ; skip += 200) {
    const page = await entity.filter(query, 'id', 200, skip);
    if (!Array.isArray(page)) throw new Error('Could not read all records');
    for (const row of page) {
      if (seen.has(row.id)) throw new Error('Records changed while loading; please retry');
      seen.add(row.id); rows.push(row);
    }
    if (page.length < 200) return rows;
  }
}

const customerView = (c) => Object.fromEntries(['id', 'customer_number', 'parent_id', 'parent_name', 'business_name', 'phone', 'contact_person', 'address', 'town', 'neighbourhood',
  'gps_lat', 'gps_lng', 'gps_accuracy_m', 'gps_captured_at', 'delivery_instructions', 'acquired_by_id', 'acquired_by_name', 'acquisition_date',
  'acquisition_verified', 'acquisition_notes', 'acquisition_source', 'registered_by_id', 'registered_by_name', 'registered_at', 'is_active','delivery_zone_id','delivery_days','route_id','gps_capture_source','delivery_revision'].map((key) => [key, c[key]]));

async function rowsByIds(entity, field, ids) {
  const rows = [];
  const unique = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 100) rows.push(...await readRecords(entity, { [field]: { $in: unique.slice(i, i + 100) } }));
  return rows;
}

export async function commercialAction(base44, user, body) {
  const svc = base44.asServiceRole;
  const allowed = body.action === 'commercialPerformance' ? COMMERCIAL_REPORT_ROLES : ['admin', 'commercial'];
  const { employee, role } = await requireStaff(base44, user, allowed, 'commercial customer activity');
  if (role !== 'admin' && employee?.status && employee.status !== 'active') throw new Error('Your staff record is not active');
  if (body.action==='commercialPerformance') {
    if (role==='warehouse_manager' && !canViewAllCommercialReports(role,employee)) throw Object.assign(new Error('Only authorized top management may view company Commercial reports.'),{status:403});
    base44.auth?.assertModule?.(role==='warehouse_manager'?'sales_reports':'commercial');
  }

  if (body.action === 'commercialDepositCash') return reportAgentCashDeposit(base44, user, body);
  if (body.action === 'commercialCashiers') {
    const cashiers = await readRecords(svc.entities.Employee, { status: 'active' });
    return { cashiers: cashiers.filter(e => effectiveRole({ role: 'user' }, e) === 'cashier').map(e => ({ id: e.id, full_name: e.full_name })) };
  }

  if (body.action === 'updateCustomerGps') {
    await commercialActor(base44,user,body.commercialId,'update field customer GPS');
    const customer = await svc.entities.Customer.get(body.customerId);
    if (!customer || customer.is_active === false || (role !== 'admin' && customer.acquired_by_id !== employee?.id && customer.salesperson_id !== employee?.id)) throw new Error('You may update only an active customer registered by or assigned to you');
    const changes=await prepareDeliveryDefinition(svc.entities,customerGpsData(body.location || {}),customer,{user});
    const saved = await svc.entities.Customer.update(customer.id, changes);
    return { customer: customerView(saved) };
  }

  if (body.action === 'registerCustomer') {
    const { employee: agent } = await commercialActor(base44, user, body.commercialId, 'registering a field customer');
    if (!/^[a-f0-9-]{36}$/i.test(body.requestKey || '')) throw new Error('Invalid registration request; reopen the form');
    const data = registrationData(body.customer || {}, agent, user.id, new Date().toISOString());
    const customerNumber = `FC-${body.requestKey.toUpperCase()}`;
    const existing = (await readRecords(svc.entities.Customer, { customer_number: customerNumber }))[0];
    if (existing) {
      if (existing.acquired_by_id !== agent.id) throw new Error('This registration reference is already used');
      return { customer: customerView(existing), reused: true };
    }
    const customers = await readRecords(svc.entities.Customer);
    const duplicate = customers.some((c) => normalizedPhone(c.phone) === normalizedPhone(data.phone)
      && String(c.business_name || '').trim().toLocaleLowerCase() === data.business_name.toLocaleLowerCase());
    if (duplicate) throw new Error('This customer name and phone are already registered. Select the existing customer in the POS.');
    const possibleDuplicate = customers.some((c) => normalizedPhone(c.phone) === normalizedPhone(data.phone));
    // A retry preserves attribution to the authenticated Commercial.
    const delivery=await prepareDeliveryDefinition(svc.entities,{...data,parent_id:body.customer?.parent_id || '',delivery_zone_id:body.customer?.delivery_zone_id || '',delivery_days:body.customer?.delivery_days || ''},null,{user,role,employee:agent});
    const result = await svc.entities.Customer.upsert([{ ...delivery, customer_number: customerNumber,
      acquisition_notes: possibleDuplicate ? 'Shared phone number: check for an existing customer before verifying.' : '',
    }], { key: ['customer_number', 'acquired_by_id'] });
    const customer = result.records[0];
    return { customer: customerView(customer), reused: result.created === 0 };
  }

  if (body.action === 'verifyFieldCustomer') {
    if (role !== 'admin') throw new Error('Only an administrator can verify customer acquisition');
    if (!['pending', 'verified_unique', 'duplicate', 'rejected'].includes(body.status)) throw new Error('Invalid verification status');
    const customer = await svc.entities.Customer.get(body.customerId);
    if (!customer?.acquired_by_id) throw new Error('This customer has no recorded acquisition agent');
    const notes = String(body.notes || '').trim().slice(0, 1000);
    if (['duplicate', 'rejected'].includes(body.status) && !notes) throw new Error('Add a review reason');
    await svc.entities.Customer.update(customer.id, { acquisition_verified: body.status, acquisition_notes: notes,
      acquisition_verified_by: user.id, acquisition_verified_at: new Date().toISOString() });
    await audit(svc, { action: 'verify_customer_acquisition', module: 'customers', entityType: 'Customer', entityId: customer.id,
      userId: user.id, description: `Customer acquisition marked ${body.status}`, reason: notes });
    return { success: true };
  }

  const commercialId = reportScope(role, employee, body.commercialId);
  if (body.action === 'commercialDailySupplies') {
    if (!commercialId) throw new Error('Choose a Commercial agent');
    const { from: date } = periodDates(body.date, body.date);
    const [sales, inventory] = await Promise.all([
      readRecords(svc.entities.FieldSale, { commercial_id: commercialId, transaction_date: date }),
      commercialRunInventory(svc, commercialId, date),
    ]);
    const fields = ['id', 'sale_number', 'customer_name', 'location_name', 'transaction_date', 'status', 'payment_type', 'total', 'amount_collected', 'amount_due', 'submitted_at', 'driver_name', 'dispatch_id', 'dispatch_number', 'vehicle_name'];
    const lines = await rowsByIds(svc.entities.FieldSaleLine, 'field_sale_id', sales.map(sale => sale.id));
    const products = await rowsByIds(svc.entities.Product, 'id', lines.map(line => line.product_id));
    const view = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key]]));
    const manifest = await rowsByIds(svc.entities.DispatchLine, 'dispatch_id', inventory.runs.map(run => run.id));
    return { date, runs: inventory.runs, runBalances: inventory.balances, runProducts: inventory.products,
      runManifest: manifest.map(line => view(line, ['dispatch_id', 'product_id', 'product_name', 'unit', 'loaded_quantity', 'returned_quantity'])),
      sales: sales.map(sale => view(sale, fields)),
      lines: lines.map(line => view(line, ['id', 'field_sale_id', 'product_id', 'product_name', 'unit', 'quantity'])),
      products: products.map(product => view(product, ['id', 'name', 'inventory_type', 'image_url', 'size', 'flavor'])) };
  }
  if (body.action === 'fieldCustomers') {
    const query = commercialId ? { $or: [{ acquired_by_id: commercialId }, { salesperson_id: commercialId }] }
      : { acquired_by_id: { $exists: true, $ne: '' } };
    const customers = await readRecords(svc.entities.Customer, query);
    return { customers: customers.filter(customer => !customer.customer_removed_at).map(customerView) };
  }

  if (body.action === 'commercialPerformance') {
    const { from, to } = periodDates(body.from, body.to);
    const sales = await readRecords(svc.entities.FieldSale, { ...(commercialId ? { commercial_id: commercialId } : {}),
      transaction_date: { $gte: from, $lte: to }, status: 'approved_posted' });
    const registrations = await readRecords(svc.entities.Customer, { ...(commercialId ? { acquired_by_id: commercialId } : { acquired_by_id: { $exists: true, $ne: '' } }),
      acquisition_date: { $gte: from, $lte: to } });
    const supplied = await rowsByIds(svc.entities.Customer, 'id', sales.map((s) => s.customer_id));
    const customers = [...new Map([...registrations, ...supplied].map((c) => [c.id, customerView(c)])).values()];
    const staff = await readRecords(svc.entities.Employee, commercialId ? { id: commercialId } : { role: 'commercial' });
    const agents = staff.map((s) => ({ id: s.id, full_name: s.full_name, bonus_plan: s.bonus_plan || '' }));
    const lines = await rowsByIds(svc.entities.FieldSaleLine, 'field_sale_id', sales.map((s) => s.id));
    const productRows = await rowsByIds(svc.entities.Product, 'id', lines.map((l) => l.product_id));
    const products = productRows.map((p) => ({ id: p.id, name: p.name, inventory_type: p.inventory_type, image_url: p.image_url, size: p.size, flavor: p.flavor }));
    // A supplied customer may belong to another agent. Keep acquisition counts scoped to the selected agent.
    const reportCustomers = customers.map((c) => commercialId && c.acquired_by_id !== commercialId ? { ...c, acquired_by_id: '' } : c);
    return { ...commercialReport({ agents, customers: reportCustomers, sales, lines, from, to }), products, from, to };
  }
  throw new Error('Unknown commercial action');
}
