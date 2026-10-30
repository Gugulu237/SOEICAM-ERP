import { requireStaff } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { driverLoadSnapshot, deliveryPointKey } from '../../lib/driver-deliveries.js';

const contactFields = ['name', 'contact_person', 'phone', 'address', 'town', 'neighbourhood', 'gps_lat', 'gps_lng', 'gps_accuracy_m', 'delivery_instructions'];
const pick = row => Object.fromEntries(contactFields.map(key => [key, row[key]]));

// Only customers belonging to the assigned delivery team are exposed. Prices,
// customer balances and company-wide customer records never enter this view.
export async function driverDeliveryPoints(svc, runs) {
  if (!runs.length) return [];
  const s = svc.entities, runIds = runs.map(run => run.id), agents = [...new Set(runs.map(run => run.salesperson_id).filter(Boolean))];
  const [orders, sales, assigned] = await Promise.all([
    readRecords(s.SalesOrder, { dispatch_id: { $in: runIds } }),
    readRecords(s.FieldSale, { dispatch_id: { $in: runIds } }),
    agents.length ? readRecords(s.CustomerLocation, { assigned_commercial_id: { $in: agents }, is_active: true }) : [],
  ]);
  const ids = [...new Set([...orders, ...sales, ...assigned].map(row => row.customer_id).filter(Boolean))];
  const customers = await readRecords(s.Customer, { is_active: true, $or: [
    { id: { $in: ids } }, ...(agents.length ? [{ salesperson_id: { $in: agents } }, { acquired_by_id: { $in: agents } }] : []),
  ] });
  const locations = customers.length ? await readRecords(s.CustomerLocation, { customer_id: { $in: customers.map(row => row.id) }, is_active: true }) : [];
  return runs.flatMap(run => customers.filter(customer => customer.salesperson_id === run.salesperson_id && !!run.salesperson_id
    || customer.acquired_by_id === run.salesperson_id && !!run.salesperson_id
    || [...orders, ...sales].some(row => row.dispatch_id === run.id && row.customer_id === customer.id)
    || assigned.some(row => row.assigned_commercial_id === run.salesperson_id && row.customer_id === customer.id)).flatMap(customer => {
    const outlets = locations.filter(row => row.customer_id === customer.id);
    return (outlets.length ? outlets : [customer]).map(point => ({ ...pick(point), dispatch_id: run.id,
      customer_id: customer.id, customer_name: customer.business_name, location_id: outlets.length ? point.id : '' }));
  }));
}

export async function driverDeliveryAction(client, user, body) {
  const { role, employee } = await requireStaff(client, user, ['driver'], 'driver receipts and delivery planning');
  if (role !== 'driver' || employee?.status !== 'active' || employee.user_id && employee.user_id !== user.id) throw Error('Use your own active driver account');
  if (body.employeeId && body.employeeId !== employee.id || body.driverId && body.driverId !== employee.id || body.commercialId) throw Error('Use your own assigned driver workspace');
  client.auth.assertModule?.('distribution');
  if (!/^[a-f0-9-]{36}$/i.test(body.requestKey || '')) throw Error('Reopen the driver form for a valid request reference');
  const svc = client.asServiceRole, s = svc.entities, run = await s.Dispatch.get(body.dispatchId);
  if (!run || run.driver_id !== employee.id) throw Error('This run is not assigned to you');
  if (!['driverReceiveLoad', 'driverSaveDeliveryPlan'].includes(body.action)) throw Error('Unknown driver action');
  const receiving = body.action === 'driverReceiveLoad', type = receiving ? 'stock_received' : 'delivery_plan';
  const activities = await readRecords(s.DriverActivity, { dispatch_id: run.id });
  const previous = activities.find(row => row.driver_id === employee.id && row.request_key === body.requestKey);
  const payload = JSON.stringify(receiving ? body.loadSnapshot : body.stops);
  if (previous) {
    if (previous.type !== type || previous.driver_payload !== payload) throw Error('This request reference was already used for different details');
    return { activity: previous, reused: true };
  }
  if (!['approved', 'loaded', 'in_transit'].includes(run.status) || activities.some(row => row.type === 'trip_returned')) throw Error('This run is no longer active');
  let extra;
  if (receiving) {
    if (!['loaded', 'in_transit'].includes(run.status)) throw Error('The warehouse must load this run before receipt');
    const manifest = await readRecords(s.DispatchLine, { dispatch_id: run.id });
    if (!manifest.some(line => Number(line.loaded_quantity) > 0)) throw Error('There are no loaded goods to receive');
    const snapshot = driverLoadSnapshot(run, manifest);
    if (body.loadSnapshot !== snapshot) throw Error('The load changed. Refresh and check the quantities before confirming receipt');
    const receipt = activities.find(row => row.type === type && row.driver_id === employee.id && row.load_snapshot === snapshot);
    if (receipt) return { activity: receipt, reused: true };
    extra = { load_snapshot: snapshot };
  } else {
    if (!Array.isArray(body.stops) || body.stops.length > 100 || body.stops.some(point => !point || typeof point.customer_id !== 'string' || typeof point.location_id !== 'string')) throw Error('Choose up to 100 valid customer delivery points');
    const eligible = new Map((await driverDeliveryPoints(svc, [run])).map(point => [deliveryPointKey(point), point]));
    const keys = body.stops.map(deliveryPointKey);
    if (new Set(keys).size !== keys.length || keys.some(key => !eligible.has(key))) throw Error('Choose distinct customers assigned to this delivery team');
    extra = { planned_stops: body.stops.map(point => ({ customer_id: point.customer_id, location_id: point.location_id })) };
  }
  // The outer API transaction serializes this check with loading/reassignment.
  const latest = await s.Dispatch.get(run.id);
  if (latest.driver_id !== employee.id || latest.salesperson_id !== run.salesperson_id || latest.status !== run.status || latest.vehicle_warehouse_id !== run.vehicle_warehouse_id) throw Error('The run changed. Refresh before continuing');
  const saved = await s.DriverActivity.upsert([{ request_key: body.requestKey, dispatch_id: run.id, dispatch_number: run.dispatch_number,
    driver_id: employee.id, driver_name: employee.full_name, recorded_by: user.id, recorded_at: new Date().toISOString(),
    type, driver_payload: payload, ...extra }], { key: ['driver_id', 'request_key'] });
  return { activity: saved.records[0] };
}
