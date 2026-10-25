import { readRecords } from './commercial-workspace.js';
import { finishedProduct } from './commercial-rules.js';
import { businessDate } from '../../lib/business-date.js';

export const commercialRunStates = ['approved', 'loaded', 'in_transit', 'returned', 'completed'];
export const supplyRunStates = ['loaded', 'in_transit'];
const fields = ['id', 'dispatch_number', 'dispatch_date', 'status', 'driver_id', 'driver_name', 'vehicle_id', 'vehicle_name', 'vehicle_warehouse_id', 'route_id', 'route_name'];
const productFields = ['id', 'name', 'inventory_type', 'image_url', 'size', 'unit_of_measure', 'storage_unit', 'sales_unit', 'selling_price', 'tax_rate', 'is_active'];
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key]]));
const round3 = value => Math.round(Number(value) * 1000) / 1000;
const active = employee => employee && employee.status === 'active';

// Dispatch owns the stock while it is on the road. Looking up that source never
// creates a second commercial-custody warehouse or moves the goods again.
async function runStockSource(svc, run, verifyingReturn = false) {
  if (!supplyRunStates.includes(run.status)) throw new Error('The warehouse must load this run before recording supplies');
  if (!run.vehicle_id || !run.vehicle_warehouse_id) throw new Error('This run has no loaded vehicle stock location. Ask dispatch management to check the load.');
  const [vehicle, warehouse, conflicts, activities] = await Promise.all([
    svc.entities.Vehicle.get(run.vehicle_id),
    svc.entities.Warehouse.get(run.vehicle_warehouse_id),
    readRecords(svc.entities.Dispatch, { status: { $in: supplyRunStates }, $or: [{ vehicle_id: run.vehicle_id }, { vehicle_warehouse_id: run.vehicle_warehouse_id }, { driver_id: run.driver_id }, { salesperson_id: run.salesperson_id }] }),
    readRecords(svc.entities.DriverActivity, { dispatch_id: run.id, type: 'trip_returned' }),
  ]);
  if (!vehicle || vehicle.is_active === false || vehicle.warehouse_id !== run.vehicle_warehouse_id
    || !warehouse || warehouse.is_active === false || warehouse.warehouse_type !== 'vehicle'
    || warehouse.id === run.warehouse_id) throw new Error('The assigned vehicle stock location changed. Ask dispatch management to check this run.');
  if (conflicts.some(other => other.id !== run.id)) throw new Error('More than one active run uses this vehicle stock or paired team. Dispatch management must reconcile the runs before supplies can be recorded.');
  if (!verifyingReturn && (activities.length || run.return_date)) throw new Error('This run has returned to base. Ask dispatch management before recording more supplies.');
  return { stock_warehouse_id: warehouse.id, stock_warehouse_name: warehouse.name || vehicle.name || run.vehicle_name || 'Vehicle stock' };
}

async function assignedRun(svc, commercialId, dispatchId, date) {
  const run = await svc.entities.Dispatch.get(dispatchId);
  if (!run?.dispatch_date || run.salesperson_id !== commercialId || run.dispatch_date > date || (!supplyRunStates.includes(run.status) && run.dispatch_date !== date) || !commercialRunStates.includes(run.status)) throw new Error('Choose a run assigned to you for this supply date');
  const [driver, commercial] = await Promise.all([
    run.driver_id ? svc.entities.Employee.get(run.driver_id) : null,
    svc.entities.Employee.get(commercialId),
  ]);
  if (!active(driver) || driver.role !== 'driver') throw new Error('This run needs an active assigned driver');
  if (!active(commercial) || commercial.role !== 'commercial' || commercial.id === driver.id) throw new Error('This run needs an active assigned Commercial sales agent');
  return { run, driver };
}

export async function commercialRuns(svc, commercialId, date) {
  const runs = await readRecords(svc.entities.Dispatch, { salesperson_id: commercialId, $or: [
    { status: { $in: supplyRunStates }, dispatch_date: { $lte: date } },
    { dispatch_date: date, status: { $in: commercialRunStates } },
  ] });
  return runs.map(row => pick(row, fields));
}

export async function supplyRun(svc, commercialId, dispatchId, date, required, verifyingReturn = false) {
  if (!dispatchId) {
    if (required) throw new Error('Select your paired driver run. Ask dispatch management to assign you and a driver to a run for this supply date.');
    return { dispatch_id: '', driver_id: '', driver_name: '', vehicle_id: '', vehicle_name: '', stock_warehouse_id: '', stock_warehouse_name: '' };
  }
  const { run, driver } = await assignedRun(svc, commercialId, dispatchId, date);
  const source = required || supplyRunStates.includes(run.status) ? await runStockSource(svc, run, verifyingReturn) : { stock_warehouse_id: '', stock_warehouse_name: '' };
  return { dispatch_id: run.id, dispatch_number: run.dispatch_number, driver_id: driver.id, driver_name: driver.full_name,
    vehicle_id: run.vehicle_id || '', vehicle_name: run.vehicle_name || '', route_id: run.route_id || '', ...source };
}

export async function runManifest(svc, dispatchId, warehouseId) {
  const [lines, sales, orders, replacements] = await Promise.all([
    readRecords(svc.entities.DispatchLine, { dispatch_id: dispatchId }),
    readRecords(svc.entities.FieldSale, { dispatch_id: dispatchId }),
    readRecords(svc.entities.SalesOrder, { dispatch_id: dispatchId }),
    readRecords(svc.entities.StockMovement, { dispatch_id: dispatchId, source_warehouse_id: warehouseId, document_type: 'SpoilageRecord', movement_type: 'promotional_issue', status: 'approved' }),
  ]);
  const documentIds = [...new Set([...sales, ...orders].map(document => document.id))], movements = [];
  // A vehicle can have years of history. Read only this run's delivery documents.
  for (let offset = 0; offset < documentIds.length; offset += 100) {
    movements.push(...await readRecords(svc.entities.StockMovement, { source_warehouse_id: warehouseId, status: 'approved',
      document_id: { $in: documentIds.slice(offset, offset + 100) }, movement_type: { $in: ['field_delivery', 'customer_delivery'] },
      document_type: { $in: ['FieldSale', 'SalesOrder'] } }));
  }
  const loaded = new Map();
  for (const line of lines) {
    const quantity = Number(line.loaded_quantity);
    const returned = Number(line.returned_quantity || 0);
    if (!line.product_id || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(returned) || returned < 0 || returned > quantity) throw new Error('This run has an invalid load manifest. Ask dispatch management to check it.');
    loaded.set(line.product_id, round3((loaded.get(line.product_id) || 0) + quantity - returned));
  }
  const saleIds = new Set(sales.map(sale => sale.id)), orderIds = new Set(orders.map(order => order.id));
  for (const movement of replacements) {
    const quantity = Number(movement.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('An expired replacement movement needs management review');
    loaded.set(movement.product_id, round3((loaded.get(movement.product_id) || 0) - quantity));
  }
  // Count source lot issues exactly once. A journal, invoice or pending-delivery
  // receipt is not another stock issue. Physical partial deliveries also consume
  // the run's allowance even when their accounting review is still unfinished.
  for (const movement of movements) {
    if (!((movement.document_type === 'FieldSale' && movement.movement_type === 'field_delivery' && saleIds.has(movement.document_id))
      || (movement.document_type === 'SalesOrder' && movement.movement_type === 'customer_delivery' && orderIds.has(movement.document_id)))) continue;
    const quantity = Number(movement.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('This run has an invalid delivery movement. Ask dispatch management to reconcile it.');
    loaded.set(movement.product_id, round3((loaded.get(movement.product_id) || 0) - quantity));
  }
  return loaded;
}

// Preflight before sale rows are created. stockIssue consumes these same physical
// balances inside the enclosing database transaction.
export async function assertRunSupplyStock(svc, context, lines, date = businessDate()) {
  if (!context?.dispatch_id || !context.stock_warehouse_id) throw new Error('Select a loaded driver run before submitting a supply');
  if (!Array.isArray(lines) || !lines.length || lines.length > 50) throw new Error('Add finished products and exact quantities supplied');
  const seen = new Set();
  for (const line of lines) {
    if (!line || typeof line.product_id !== 'string' || seen.has(line.product_id) || typeof line.quantity === 'boolean'
      || !Number.isFinite(Number(line.quantity)) || round3(line.quantity) <= 0) throw new Error('Enter distinct finished products with positive quantities');
    seen.add(line.product_id);
  }
  const [manifest, balances, products] = await Promise.all([
    runManifest(svc, context.dispatch_id, context.stock_warehouse_id),
    readRecords(svc.entities.StockBalance, { warehouse_id: context.stock_warehouse_id, product_id: { $in: [...seen] } }),
    readRecords(svc.entities.Product, { id: { $in: [...seen] } }),
  ]);
  const availableDate = date > businessDate() ? date : businessDate();
  for (const line of lines) {
    const product = products.find(row => row.id === line.product_id), quantity = round3(line.quantity);
    if (!finishedProduct(product) || product.is_active === false || product.configuration_status === 'draft') throw new Error('Only active finished products loaded for this run can be supplied');
    if (!(manifest.get(product.id) > 0) || quantity > manifest.get(product.id)) throw new Error(`${product.name} exceeds the quantities loaded for this run`);
    const available = round3(balances.filter(balance => balance.product_id === product.id && Number(balance.quantity) > 0
      && (balance.qc_status || 'approved') === 'approved' && (!balance.expiry_date || balance.expiry_date >= availableDate))
      .reduce((sum, balance) => sum + Number(balance.quantity), 0));
    if (quantity > available) throw new Error(`Only ${available} available on this driver run for ${product.name}`);
  }
}

// Dashboards receive real finished-goods balances per assigned run, with no
// stock cost or accounting data exposed to field employees.
export async function commercialRunInventory(svc, commercialId, date) {
  const runs = await commercialRuns(svc, commercialId, date), balances = [], productIds = new Set();
  const views = await Promise.all(runs.map(async run => {
    if (!supplyRunStates.includes(run.status)) return { ...run, can_supply: false, stock_error: '' };
    try {
      const context = await supplyRun(svc, commercialId, run.id, date, true);
      const [manifest, stock] = await Promise.all([runManifest(svc, run.id, context.stock_warehouse_id), readRecords(svc.entities.StockBalance, { warehouse_id: context.stock_warehouse_id })]);
      const remaining = new Map(manifest), today = businessDate();
      const runBalances = stock.filter(row => Number(row.quantity) > 0 && (manifest.get(row.product_id) || 0) > 0)
        .sort((left, right) => String(left.expiry_date || '9999-12-31').localeCompare(String(right.expiry_date || '9999-12-31')));
      for (const row of runBalances) {
        const saleable = (row.qc_status || 'approved') === 'approved' && (!row.expiry_date || row.expiry_date >= today);
        const usable = saleable ? Math.max(0, Math.min(round3(row.quantity), remaining.get(row.product_id) || 0)) : 0;
        if (saleable) remaining.set(row.product_id, round3((remaining.get(row.product_id) || 0) - usable));
        productIds.add(row.product_id);
        balances.push({ ...pick(row, ['warehouse_id', 'product_id', 'quantity', 'qc_status', 'expiry_date']),
          usable_quantity: usable, run_remaining_quantity: Math.max(0, manifest.get(row.product_id) || 0), dispatch_id: run.id });
      }
      return { ...run, ...context, can_supply: true, stock_error: '' };
    } catch (error) { return { ...run, can_supply: false, stock_error: error.message }; }
  }));
  const allProducts = productIds.size ? await readRecords(svc.entities.Product, { id: { $in: [...productIds] } }) : [];
  const products = allProducts.filter(product => finishedProduct(product) && product.is_active !== false && product.configuration_status !== 'draft');
  const allowed = new Set(products.map(product => product.id));
  return { runs: views, balances: balances.filter(row => allowed.has(row.product_id)), products: products.map(product => pick(product, productFields)) };
}
