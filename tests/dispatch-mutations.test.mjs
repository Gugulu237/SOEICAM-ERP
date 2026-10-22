import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { guardDispatchMutation } from '../src/server/domain/dispatch-mutations.js';

const context = role => role === 'admin' ? { user:{ id:'gm', role:'admin', email:'gm@example.test' } } : { user:{ id:role + '-user', role:'user', email:role + '@example.test' }, employee:{ id:role + '-staff', role, status:'active' } };
const gm = context('admin'), manager = context('warehouse_manager'), employee = context('employee');
const forbidden = error => error.status === 403;
const run = (status = 'draft', fields = {}) => ({ id:'run', status, ...fields });
const guard = (actor, payload, existing = run(), operation = 'update') => guardDispatchMutation(actor, 'Dispatch', operation, payload, existing, {});

test('generic dispatch creation and updates can prepare a draft and submit it, without forging lifecycle fields', async () => {
  await guard(employee, { status:'draft', dispatch_number:'DSP-1', source:'manual_push', dispatch_date:'2026-10-18', vehicle_id:'vehicle', driver_id:'driver', salesperson_id:'agent', warehouse_id:'store', notes:'Draft' }, null, 'create');
  await assert.rejects(guard(employee, { vehicle_id:'other', loaded_quantity:undefined }), forbidden);
  await guard(employee, { driver_id:'driver', salesperson_id:'agent', notes:'Loading plan' });
  await guard(employee, { status:'pending_approval' });
  for (const actor of [gm, manager, employee]) {
    for (const status of ['approved','loaded','in_transit','returned','completed','cancelled',null]) {
      await assert.rejects(guard(actor, { status }, null, 'create'), forbidden);
      if (status !== 'cancelled') await assert.rejects(guard(actor, { status }), forbidden);
    }
    for (const [key, value] of Object.entries({ approved_by:'gm', approved_at:'now', loaded_by:'gm', loaded_at:'now', departure_date:'now', vehicle_warehouse_id:'vehicle-stock', return_date:'now', total_loaded_value:123, total_returned_value:10, total_delivered_value:80, total_cash_collected:80, total_credit_sales:0, journal_id:'journal', closed_by:'gm', closed_at:'now' })) {
      await assert.rejects(guard(actor, { [key]:value }), forbidden);
      await assert.rejects(guard(actor, { [key]:value }, null, 'create'), forbidden);
    }
  }
});

test('submitted and loaded manifest details remain immutable for every generic caller, including the GM', async () => {
  for (const actor of [gm, manager, employee]) for (const status of ['pending_approval','approved','loaded','in_transit','returned','completed','cancelled']) {
    for (const payload of [{ driver_id:'replacement' }, { salesperson_id:'replacement' }, { dispatch_date:'2099-01-01' }, { vehicle_id:'replacement' }, { warehouse_id:'replacement' }, { source:'manual_push' }, { notes:'Rewrite' }, { status:'draft' }, { status:'approved', approved_by:'forged' }]) {
      await assert.rejects(guard(actor, payload, run(status)), forbidden);
    }
    await assert.rejects(guard(actor, {}, run(status), 'delete'), forbidden);
  }
  await guard(employee, {}, run(), 'delete');
});

test('dispatch management cancels unloaded runs; departure and closure require their checked workflows', async () => {
  for (const actor of [gm, manager]) {
    await assert.rejects(guard(actor, { status:'in_transit' }, run('loaded')), /assigned driver/);
    await assert.rejects(guard(actor, { status:'completed', closed_by:'Manager', closed_at:'2026-10-18T12:00:00.000Z' }, run('returned')),/checked Distribution/);
    for (const status of ['draft','pending_approval','approved']) await guard(actor, { status:'cancelled' }, run(status));
    await assert.rejects(guard(actor, { status:'in_transit', departure_date:'other' }, run('loaded')), forbidden);
    await assert.rejects(guard(actor, { status:'completed', total_loaded_value:0 }, run('returned')), forbidden);
    await assert.rejects(guard(actor, { status:'cancelled', notes:'Changed' }, run()), forbidden);
    for (const loadedEvidence of [{ loaded_at:'now' }, { loaded_by:'manager' }, { total_loaded_value:100 }]) await assert.rejects(guard(actor, { status:'cancelled' }, run('approved', loadedEvidence)), forbidden);
    for (const status of ['loaded','in_transit','returned','completed','cancelled']) await assert.rejects(guard(actor, { status:'cancelled' }, run(status)), forbidden);
  }
  for (const [status, next] of [['loaded','in_transit'],['returned','completed'],['draft','cancelled'],['approved','cancelled']]) await assert.rejects(guard(employee, { status:next }, run(status)), forbidden);
});

test('every staff template and custom management template must leave departure to the assigned driver workflow', async () => {
  const actors=['admin','production_manager','warehouse_manager','cashier','procurement','employee','commercial','hotesse','driver'].map(context);
  actors.push({user:{id:'supply-user',role:'user'},employee:{id:'supply',role:'supply_chain_manager',access_template:'warehouse_manager',status:'active'}});
  for(const actor of actors) {
    await assert.rejects(guard(actor,{status:'in_transit'},run('loaded')), /assigned driver/);
    await assert.rejects(guard(actor,{departure_date:'2099-01-01'},run()), forbidden);
  }
});

test('every line mutation reads its actual parent and only edits a draft, without reparenting or forging loaded costs', async () => {
  let parent = run(), reads = 0;
  const stores = { Dispatch:{ get:async id => { reads++; assert.equal(id, 'run'); return parent; } } };
  const line = { id:'line', dispatch_id:'run', product_id:'yogurt' };
  for (const operation of ['create','bulkCreate','update','updateMany','delete','deleteMany']) {
    await guardDispatchMutation(gm, 'DispatchLine', operation, operation.includes('reate') ? { dispatch_id:'run', product_id:'yogurt', loaded_quantity:10, requested_quantity:10, unit_price:200 } : {}, operation.includes('reate') ? null : line, stores);
  }
  assert.equal(reads, 6);
  await assert.rejects(guardDispatchMutation(gm, 'DispatchLine', 'update', { dispatch_id:'different-run' }, line, stores), forbidden);
  for (const key of ['unit_cost','loaded_value','returned_quantity','status','approved_by','journal_id']) await assert.rejects(guardDispatchMutation(gm, 'DispatchLine', 'update', { [key]:1 }, line, stores), forbidden);
  for (const status of ['pending_approval','approved','loaded','in_transit','returned','completed']) {
    parent = run(status);
    for (const operation of ['create','update','delete']) await assert.rejects(guardDispatchMutation(gm, 'DispatchLine', operation, operation === 'create' ? { dispatch_id:'run' } : {}, operation === 'create' ? null : line, stores), forbidden);
  }
  parent = null;
  await assert.rejects(guardDispatchMutation(gm, 'DispatchLine', 'create', { dispatch_id:'run' }, null, stores), forbidden);
  await guardDispatchMutation({}, 'Product', 'create', { anything:true }, null, {});
});

test('the entity API checks every bulk dispatch or line mutation before the first write', async () => {
  const data = { Dispatch:[run('draft', { id:'draft' }), run('loaded', { id:'loaded' })], DispatchLine:[{ id:'draft-line', dispatch_id:'draft' }, { id:'loaded-line', dispatch_id:'loaded' }] }, writes = [];
  const matches = (row, query) => query.$and ? query.$and.every(part => matches(row, part)) : Object.entries(query).every(([key, value]) => value?.$in ? value.$in.includes(row[key]) : row[key] === value);
  const stores = Object.fromEntries(Object.entries(data).map(([entity, rows]) => [entity, {
    filter:async query => rows.filter(row => matches(row, query)),
    get:async id => rows.find(row => row.id === id),
    create:async payload => { writes.push(['create', entity, payload]); return { id:'new', ...payload }; },
    updateMany:async (query, payload) => { writes.push(['update', entity, payload]); const records = rows.filter(row => matches(row, query)).map(row => ({ ...row, ...payload })); return { records }; },
    deleteMany:async () => { writes.push(['delete', entity]); return {}; },
  }]));
  globalThis.__dispatchMutationStores = stores;
  try {
    const output = await build({ entryPoints:['src/server/entity-api.js'], bundle:true, platform:'node', format:'esm', write:false, plugins:[{ name:'dispatch-stores', setup(builder) {
      builder.onResolve({ filter:/^server-only$/ }, () => ({ path:'empty', namespace:'dispatch-stores' }));
      builder.onResolve({ filter:/(?:^|\/)entities\.js$/ }, () => ({ path:'entities', namespace:'dispatch-stores' }));
      builder.onResolve({ filter:/(?:^|\/)db\.js$/ }, () => ({ path:'db', namespace:'dispatch-stores' }));
      builder.onLoad({ filter:/.*/, namespace:'dispatch-stores' }, args => ({ contents:args.path === 'entities' ? 'export const serviceEntities = globalThis.__dispatchMutationStores; export const entityStore = name => serviceEntities[name];' : args.path === 'db' ? 'export const database=()=>{throw Error("Unexpected catalogue read in unrelated test");};export const transaction = run => run();' : '' }));
    } }] });
    const { entityOperation } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
    await assert.rejects(entityOperation(gm, 'Dispatch', 'bulkCreate', [[{ status:'draft' }, { status:'loaded' }]]), forbidden);
    await assert.rejects(entityOperation(gm, 'DispatchLine', 'bulkCreate', [[{ dispatch_id:'draft' }, { dispatch_id:'loaded' }]]), forbidden);
    await assert.rejects(entityOperation(gm, 'Dispatch', 'updateMany', [{}, { driver_id:'different' }]), forbidden);
    await assert.rejects(entityOperation(gm, 'DispatchLine', 'updateMany', [{}, { loaded_quantity:500 }]), forbidden);
    await assert.rejects(entityOperation(gm, 'DispatchLine', 'deleteMany', [{}]), forbidden);
    assert.equal(writes.length, 0);
    await entityOperation(employee, 'Dispatch', 'update', ['draft', { status:'pending_approval' }]);
    await assert.rejects(entityOperation(manager, 'Dispatch', 'update', ['loaded', { status:'in_transit' }]), /assigned driver/);
    await assert.rejects(entityOperation(gm, 'Dispatch', 'updateMany', [{id:'loaded'}, { status:'in_transit' }]), /assigned driver/);
    assert.equal(data.Dispatch.find(row => row.id === 'loaded').status, 'loaded');
    await entityOperation(gm, 'DispatchLine', 'create', [{ dispatch_id:'draft', product_id:'yogurt', loaded_quantity:10 }]);
    assert.equal(writes.length, 2);
  } finally { delete globalThis.__dispatchMutationStores; }
});
