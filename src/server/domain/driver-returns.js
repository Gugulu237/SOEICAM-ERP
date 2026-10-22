import { readRecords } from './commercial-workspace.js';
import { supplyRun, commercialRunInventory } from './commercial-runs.js';
import { today } from './field-ops.js';

const pick = (row, fields) => Object.fromEntries(fields.split(' ').map(k => [k, row?.[k]]));

// Drivers act as themselves. The paired Commercial remains the commercial
// attribution; the authenticated login is recorded separately on every write.
export async function driverReturnRun(svc, employee, body, date) {
  if (employee?.status !== 'active' || (body.driverId && body.driverId !== employee.id) || body.commercialId) throw Error('Use your own assigned driver workspace');
  const run = await svc.entities.Dispatch.get(body.dispatchId);
  if (!run || run.driver_id !== employee.id) throw Error('Choose your own assigned vehicle run');
  const context = await supplyRun(svc, run.salesperson_id, run.id, date, true);
  const commercial = await svc.entities.Employee.get(run.salesperson_id);
  return { context, commercial, run };
}

async function customersForRuns(s, runs) {
  if (!runs.length) return { customers: [], locations: [] };
  const runIds = runs.map(r => r.id), agents = [...new Set(runs.map(r => r.salesperson_id))].filter(Boolean);
  const [orders, supplies, assignedLocations] = await Promise.all([
    readRecords(s.SalesOrder, { dispatch_id: { $in: runIds } }), readRecords(s.FieldSale, { dispatch_id: { $in: runIds } }),
    readRecords(s.CustomerLocation, { assigned_commercial_id: { $in: agents }, is_active: true }),
  ]);
  const ids = [...new Set([...orders, ...supplies, ...assignedLocations].map(row => row.customer_id))].filter(Boolean);
  const customers = await readRecords(s.Customer, { is_active: true, $or: [{ salesperson_id: { $in: agents } }, { acquired_by_id: { $in: agents } }, { id: { $in: ids } }] });
  const locations = customers.length ? await readRecords(s.CustomerLocation, { customer_id: { $in: customers.map(c => c.id) }, is_active: true }) : [];
  return { customers: customers.map(c => pick(c, 'id business_name customer_number')), locations: locations.map(l => pick(l, 'id customer_id name')) };
}

export async function assertDriverReturnCustomer(s, run, customerId) {
  const { customers } = await customersForRuns(s, [run]);
  if (!customers.some(c => c.id === customerId)) throw Error('Choose a customer assigned to this delivery team or supplied on this run');
}

export async function driverReturnWorkspace(svc, employee) {
  const s = svc.entities, date = today();
  const assigned = await readRecords(s.Dispatch, { driver_id: employee.id, status: { $in: ['loaded', 'in_transit'] }, dispatch_date: { $lte: date } });
  const inventory = await Promise.all([...new Set(assigned.map(r => r.salesperson_id))].filter(Boolean).map(id => commercialRunInventory(svc, id, date)));
  const ids = new Set(assigned.map(r => r.id)), runs = inventory.flatMap(i => i.runs).filter(r => ids.has(r.id));
  const permittedRuns = new Set(runs.filter(r => r.can_supply).map(r => r.id));
  const [people, products, records] = await Promise.all([
    customersForRuns(s, assigned.filter(r => permittedRuns.has(r.id))),
    readRecords(s.Product, { inventory_type: { $in: ['assembly', 'finished_product'] } }),
    readRecords(s.SpoilageRecord, { record_type: 'field_expired_return', driver_id: employee.id }),
  ]);
  return { runs, runBalances: inventory.flatMap(i => i.balances).filter(b => permittedRuns.has(b.dispatch_id)), ...people,
    products: products.map(p => pick(p, 'id name image_url inventory_type unit_of_measure storage_unit is_active configuration_status')), records };
}
