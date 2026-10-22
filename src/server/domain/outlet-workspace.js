import { requireStaff } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { periodDates } from './commercial-rules.js';
import { validateOutletDailyReport, validateDeliveryShelfCheck } from './outlet-rules.js';
import { loadOutletStock } from './outlet-stock.js';
import { businessDate } from '../../lib/business-date.js';

const pick = (row, fields) => Object.fromEntries(fields.map(key => [key, row?.[key]]));
const locationFields = ['id', 'customer_id', 'customer_name', 'name', 'contact_person', 'phone', 'address', 'town', 'neighbourhood', 'gps_lat', 'gps_lng', 'delivery_instructions', 'assigned_hotesse_ids', 'is_active'];
const customerFields = ['id', 'customer_number', 'business_name', 'address', 'town', 'neighbourhood'];

async function activeCustomer(svc, id) {
  if (typeof id !== 'string' || !id) throw new Error('Choose a registered customer');
  const customer = await svc.entities.Customer.get(id);
  if (!customer || customer.is_active === false) throw new Error('Choose an active registered customer');
  return customer;
}

async function assignedStaff(svc, ids, required = false) {
  if (!Array.isArray(ids) || (required && !ids.length) || ids.length > 20 || ids.some(id => typeof id !== 'string' || !id || id.length > 256) || new Set(ids).size !== ids.length) throw new Error('Select valid staff assignments');
  const employees = ids.length ? await readRecords(svc.entities.Employee, { id: { $in: ids }, role: 'hotesse', status: 'active' }) : [];
  if (employees.length !== ids.length) throw new Error('Assignments require active Hotesse staff');
  return ids;
}

export async function hotesseData(svc, employeeId, date) {
  const [locations, reports] = await Promise.all([
    readRecords(svc.entities.CustomerLocation, { assigned_hotesse_ids: { $in: [employeeId] }, is_active: { $ne: false } }),
    readRecords(svc.entities.OutletVisit, { employee_id: employeeId, visit_date: { $gte: date.slice(0, 8) + '01', $lte: date } }),
  ]);
  const customerIds = [...new Set(locations.map(l => l.customer_id).filter(Boolean))];
  const customers = [];
  for (let offset = 0; offset < customerIds.length; offset += 100) customers.push(...await readRecords(svc.entities.Customer, { id: { $in: customerIds.slice(offset, offset + 100) }, is_active: { $ne: false } }));
  const customerMap = new Map(customers.map(customer => [customer.id, customer]));
  const assigned = locations.filter(l => l.assigned_hotesse_ids?.includes(employeeId) && customerMap.has(l.customer_id)).map(l => ({ ...l, customer_name: customerMap.get(l.customer_id).business_name }));
  const stocks = await Promise.all(assigned.map(location => loadOutletStock(svc, location, date)));
  const outletProducts = Object.fromEntries(assigned.map((location, i) => [location.id, stocks[i].products]));
  return { locations: assigned.map((location, i) => ({ ...pick(location, locationFields), daily_report_submitted: stocks[i].daily_report_submitted, stock_snapshot_key: stocks[i].snapshot_key })), reports,
    outletDeliveries: Object.fromEntries(assigned.map((location, i) => [location.id, stocks[i].deliveries])),
    outletProducts, products: [...new Map(stocks.flatMap(stock => stock.products).map(product => [product.id, product])).values()] };
}

export async function outletAction(base44, user, body) {
  const { role, employee } = await requireStaff(base44, user, ['admin', 'hotesse'], 'outlet reporting');
  if (role !== 'admin' && (!employee || (employee.status && employee.status !== 'active'))) throw new Error('An active linked Hotesse account is required');
  const svc = base44.asServiceRole;
  if (['submitOutletVisit', 'submitDeliveryShelfCheck'].includes(body.action)) {
    if (role !== 'hotesse') throw new Error('Only the assigned Hotesse can submit a daily outlet report');
    if (!/^[a-f0-9-]{36}$/i.test(body.requestKey || '')) throw new Error('Invalid report reference');
    const existing = (await readRecords(svc.entities.OutletVisit, { employee_id: employee.id, request_key: body.requestKey }))[0];
    if (existing) {
      const expectedType = body.action === 'submitDeliveryShelfCheck' ? 'delivery_shelf_check' : 'daily_sales';
      if (existing.location_id !== body.locationId || existing.report_type !== expectedType) throw new Error('This report reference is already used. Reopen the form.');
      return { report: existing, reused: true };
    }
    const location = await svc.entities.CustomerLocation.get(body.locationId);
    if (!location || location.is_active === false || !location.assigned_hotesse_ids?.includes(employee.id)) throw new Error('This active outlet is not assigned to you');
    const customer = await activeCustomer(svc, location.customer_id);
    const now = new Date();
    const visitDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Douala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const stock = await loadOutletStock(svc, location, visitDate);
    const deliveryCheck = body.action === 'submitDeliveryShelfCheck';
    const values = (deliveryCheck ? validateDeliveryShelfCheck : validateOutletDailyReport)(body, await svc.entities.CustomerLocation.get(body.locationId), employee, stock);
    const saved = await svc.entities.OutletVisit.upsert([{
      ...values, request_key: body.requestKey, employee_id: employee.id, employee_name: employee.full_name,
      location_id: location.id, location_name: location.name, customer_id: customer.id, customer_name: customer.business_name,
      visit_date: visitDate, recorded_at: now.toISOString(), recorded_by: user.id, status: 'submitted',
    }], { key: deliveryCheck ? ['location_id', 'report_type', 'delivery_key'] : ['location_id', 'visit_date', 'report_type'], updateExisting: false });
    if (saved.records[0].request_key !== body.requestKey || saved.records[0].employee_id !== employee.id) throw new Error('This outlet report has already been submitted by assigned staff. Refresh to view it.');
    return { report: saved.records[0] };
  }
  if (body.action === 'outletReports') {
    const { from, to } = periodDates(body.from, body.to);
    const query = { visit_date: { $gte: from, $lte: to }, ...(role === 'hotesse' ? { employee_id: employee.id } : {}) };
    return { reports: await readRecords(svc.entities.OutletVisit, query) };
  }
  if (role !== 'admin') throw new Error('Only the General Manager can manage outlet reporting');
  if (body.action === 'outletShelfOverview') {
    const date = businessDate();
    const [locations, customers, employees] = await Promise.all([
      readRecords(svc.entities.CustomerLocation, { is_active: { $ne: false } }),
      readRecords(svc.entities.Customer, { is_active: { $ne: false } }),
      readRecords(svc.entities.Employee, { role: 'hotesse', status: 'active' }),
    ]);
    const people = new Map(employees.map(row => [row.id, row.full_name])), parents = new Map(customers.map(row => [row.id, row.business_name]));
    const assigned = locations.filter(row => Array.isArray(row.assigned_hotesse_ids) && row.assigned_hotesse_ids.some(id => people.has(id)) && parents.has(row.customer_id));
    const stocks = await Promise.all(assigned.map(row => loadOutletStock(svc, row, date)));
    return { date, outlets: assigned.map((row, i) => ({ ...pick(row, locationFields), customer_name: parents.get(row.customer_id),
      staff_names: row.assigned_hotesse_ids.filter(id => people.has(id)).map(id => people.get(id)), ...stocks[i] })) };
  }
  if (body.action === 'outletRoster') {
    const [customers, locations, employees] = await Promise.all([
      readRecords(svc.entities.Customer, { is_active: { $ne: false } }),
      readRecords(svc.entities.CustomerLocation, { is_active: { $ne: false } }),
      readRecords(svc.entities.Employee, { role: 'hotesse' }),
    ]);
    const customerMap = new Map(customers.map(customer => [customer.id, customer]));
    return { customers: customers.map(customer => pick(customer, customerFields)), locations: locations.filter(l => customerMap.has(l.customer_id)).map(l => pick({ ...l, customer_name: customerMap.get(l.customer_id).business_name }, locationFields)), employees: employees.map(e => pick(e, ['id', 'full_name', 'status'])) };
  }
  if (body.action === 'createAssignedOutlet') {
    const customer = await activeCustomer(svc, body.customerId);
    const ids = await assignedStaff(svc, body.employeeIds, true);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestKey || '')) throw new Error('Invalid point-of-sale reference');
    const text = (value, max, label) => {
      if (typeof value !== 'string' || value.trim().length > max) throw new Error('Enter a valid ' + label);
      return value.trim();
    };
    const name = text(body.name, 150, 'point-of-sale name');
    if (!name) throw new Error('Enter a point-of-sale name');
    const id = 'pos-' + body.requestKey;
    const existing = await svc.entities.CustomerLocation.get(id);
    const sameRequest = row => row.customer_id === customer.id && row.assignment_request_key === body.requestKey && row.assignment_created_by === user.id;
    if (existing) {
      if (!sameRequest(existing)) throw new Error('This point-of-sale reference is already in use');
      return { location: pick(existing, locationFields), reused: true };
    }
    const outlets = await readRecords(svc.entities.CustomerLocation, { customer_id: customer.id });
    if (outlets.some(l => String(l.name || '').trim().toLowerCase() === name.toLowerCase())) throw new Error('This customer already has a point of sale with that name. Select the existing outlet or check inactive outlets in the customer profile.');
    const saved = await svc.entities.CustomerLocation.upsert([{
      id, customer_id: customer.id, customer_name: customer.business_name, name,
      address: text(body.address ?? '', 500, 'address'), town: text(body.town ?? '', 150, 'town'), neighbourhood: text(body.neighbourhood ?? '', 150, 'neighbourhood'),
      contact_person: customer.contact_person || '', phone: customer.phone || '',
      assigned_hotesse_ids: ids, is_active: true, assignment_request_key: body.requestKey, assignment_created_by: user.id,
      hotesse_assignment_by: user.id, hotesse_assignment_at: new Date().toISOString(),
    }], { key: ['id'], updateExisting: false });
    if (!sameRequest(saved.records[0])) throw new Error('This point-of-sale reference is already in use');
    return { location: pick(saved.records[0], locationFields) };
  }
  if (body.action === 'assignHotesse') {
    const location = await svc.entities.CustomerLocation.get(body.locationId);
    if (!location || location.is_active === false) throw new Error('Choose an active customer outlet');
    const customer = await activeCustomer(svc, location.customer_id);
    if (body.customerId && body.customerId !== customer.id) throw new Error('This point of sale belongs to another customer');
    const ids = await assignedStaff(svc, body.employeeIds);
    const saved = await svc.entities.CustomerLocation.update(location.id, { assigned_hotesse_ids: ids, customer_name: customer.business_name, hotesse_assignment_by: user.id, hotesse_assignment_at: new Date().toISOString() });
    return { success: true, location: pick(saved, locationFields) };
  }
  if (body.action === 'reviewOutletVisit') {
    const report = await svc.entities.OutletVisit.get(body.reportId);
    if (!report) throw new Error('Report not found');
    if (report.status === 'reviewed') return { report, reused: true };
    await svc.entities.OutletVisit.updateMany({ id: report.id, status: 'submitted' }, { $set: {
      status: 'reviewed', reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_notes: String(body.notes || '').trim().slice(0, 2000),
    } });
    return { report: await svc.entities.OutletVisit.get(report.id) };
  }
  throw new Error('Unknown outlet reporting action');
}
