import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { postgresAdapter } from './helpers/postgres-adapter.mjs';
import { functionRoute, request } from './helpers/cashier.mjs';
import { countedQuantity, countVariance } from '../src/lib/inventory-audit.js';
import { businessDate } from '../src/lib/business-date.js';
import { guardMutation } from '../src/server/access.js';

let storeModule, route;
async function environment() {
  const db = new PGlite({ parsers: { 1700: Number } });
  await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
  await db.exec(await readFile(new URL('../supabase/migrations/202610170001_erp_schema.sql', import.meta.url), 'utf8'));
  const adapter = postgresAdapter(db); let queue = Promise.resolve(), inside = false;
  globalThis.__inventoryDB = { unsafe: (sql, args) => { const next = queue.then(() => adapter.unsafe(sql, args)); queue = next.catch(() => {}); return next; } };
  const transaction = async fn => { if (inside) return fn(); await db.exec('BEGIN'); inside = true; try { const result = await fn(); await db.exec('COMMIT'); return result; } catch (e) { await db.exec('ROLLBACK'); throw e; } finally { inside = false; } };
  globalThis.__inventoryTransaction = transaction;
  if (!storeModule) {
    const output = await build({ stdin: { contents: "export {entityStore} from './src/server/entities.js';export {entityOperation} from './src/server/entity-api.js';", resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'node', write: false, plugins: [{ name: 'inventory-stores', setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'fixture' }));
      b.onResolve({ filter: /(?:^|\/)db\.js$/ }, () => ({ path: 'db', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path === 'db' ? 'export const database=()=>globalThis.__inventoryDB;export const transaction=fn=>globalThis.__inventoryTransaction(fn);' : '' }));
    } }] });
    storeModule = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
  }
  const entities = Object.fromEntries(['Product', 'Warehouse', 'StockBalance', 'StockMovement', 'PostingRule', 'Account', 'JournalEntry', 'JournalLine', 'TreasuryAccount', 'TreasuryTransaction', 'CompanySettings', 'AccountingPeriod', 'AuditLog'].map(n => [n, storeModule.entityStore(n)]));
  await entities.CompanySettings.create({ company_name: 'Fixture', next_journal_number: 1 });
  for (const [id, type, normal, balance] of [['inventory', 'asset', 'debit', 150], ['loss', 'expense', 'debit', 0], ['gain', 'other_income', 'credit', 0], ['cash', 'asset', 'debit', 1000]]) await entities.Account.create({ id, account_number: id, name: id, account_type: type, normal_balance: normal, balance, is_active: true, is_posting: true });
  await entities.TreasuryAccount.create({ id: 'till', name: 'Cash', account_type: 'cash', gl_account_id: 'cash', balance: 1000 });
  await entities.Product.create({ id: 'item', name: 'Flour', sku: 'FLR', inventory_type: 'raw_material', unit_of_measure: 'kg', inventory_account_id: 'inventory', configuration_status: 'configured', current_cost: 10 });
  await entities.Warehouse.create({ id: 'main', code: 'MAIN', name: 'Main warehouse', warehouse_type: 'raw_material', is_active: true });
  for (const [id, qty, value, qc] of [['lot1', 10, 100, 'quarantine'], ['lot2', 5, 50, 'approved']]) await entities.StockBalance.create({ id, product_id: 'item', product_name: 'Flour', warehouse_id: 'main', lot_number: id, batch_number: 'batch-' + id, expiry_date: '2027-01-01', production_order_id: 'production-1', quantity: qty, total_value: value, unit_cost: 10, qc_status: qc });
  const date = businessDate(); await entities.AccountingPeriod.create({ id: 'open', name: 'Current', fiscal_year: Number(date.slice(0, 4)), period_number: 1, start_date: date.slice(0, 4) + '-01-01', end_date: date.slice(0, 4) + '-12-31', status: 'open' });
  let actor = 'accountant', staffRole = 'cashier', active = true, moduleAllowed = true;
  const client = { auth: { me: async () => ({ id: actor, role: staffRole === 'admin' ? 'admin' : 'user' }), staff: async () => ({ id: 'staff-' + actor, role: staffRole, allowed_modules:['accounting','inventory_adjustments'], status: active ? 'active' : 'inactive', full_name: actor }), assertModule: () => { if (!moduleAllowed) throw Error('Accounting module denied'); } }, asServiceRole: { entities } };
  globalThis.__cashierClient = client; globalThis.__cashierTransaction = transaction; route ||= await functionRoute();
  const call = async body => { const response = await route(request(body), { params: Promise.resolve({ name: 'fieldOps' }) }); return { status: response.status, ...await response.json() }; };
  const ok = async body => { const result = await call(body); assert.equal(result.status, 200, result.error); return result; };
  const write = (action, a, extra = {}) => ({ action: 'inventoryAudit' + action, ...(a ? { auditId: a.id, revision: a.revision } : {}), requestKey: crypto.randomUUID(), ...extra });
  const change = async (action, a, extra) => (await ok(write(action, a, extra))).audit;
  const start = (balanceIds = ['lot1', 'lot2']) => change('Start', null, { title: 'Weekly physical count', balanceIds });
  const save = (a, counts = [8, 6], extra = {}) => change('Save', a, { rows: a.rows.map((r, i) => ({ balance_id: r.balance_id, counted_quantity: counts[i], reason: 'Verified with signed count sheet' })), evidenceReference: 'SHEET-001 witnessed count', lossAccountId: 'loss', gainAccountId: 'gain', ...extra });
  const actAs = (id, role = 'cashier', status = true, allowed = true) => { actor = id; staffRole = role; active = status; moduleAllowed = allowed; };
  const approve = async a => { actAs('gm', 'admin'); const result = await change('Approve', a, { note: 'Checked count sheet and confirmed variance' }); actAs('accountant'); return result; };
  return { db, entities, call, ok, write, change, start, save, actAs, approve, close: async () => { delete globalThis.__inventoryDB; delete globalThis.__inventoryTransaction; delete globalThis.__cashierClient; delete globalThis.__cashierTransaction; await db.close(); } };
}

test('quantity validation distinguishes explicit zero from blanks and preserves last-cent carrying values', () => {
  for (const value of ['', ' ', null, undefined, -1, true, [], 'bad', 0.0001, Infinity, 1e10]) assert.throws(() => countedQuantity(value));
  assert.equal(countedQuantity('0'), 0);
  assert.deepEqual(countVariance({ book_quantity: 3, book_value: 1, unit_cost: 0.33333 }, 0), { counted_quantity: 0, difference: -3, value_after: 0, value_difference: -1 });
  assert.equal(countVariance({ book_quantity: 3, book_value: 1, unit_cost: 0.33333 }, 2).value_difference, -0.33);
});

test('real route posts independent-approved counts once with balanced GL, preserved lots, history and unchanged cash', async () => {
  const env = await environment(); try {
    const e = env.entities; let a = await env.start();
    assert.equal(a.totals.counted, 0); a = await env.save(a);
    a = await env.change('Submit', a); assert.equal(a.status, 'submitted');
    assert.equal((await e.StockBalance.get('lot1')).quantity, 10);
    a = await env.approve(a); assert.equal((await e.JournalEntry.list()).length, 0);
    const body = env.write('Post', a), result = await env.ok(body); a = result.audit;
    assert.equal(a.status, 'posted'); assert.equal((await env.ok(body)).reused, true);
    const b = await e.StockBalance.get('lot1');
    assert.equal(b.quantity, 8); assert.equal(b.total_value, 80); assert.equal(b.qc_status, 'quarantine'); assert.equal(b.batch_number, 'batch-lot1'); assert.equal(b.expiry_date, '2027-01-01'); assert.equal(b.production_order_id, 'production-1');
    assert.equal((await e.StockBalance.get('lot2')).quantity, 6);
    assert.equal((await e.Account.get('inventory')).balance, 140); assert.equal((await e.Account.get('loss')).balance, 20); assert.equal((await e.Account.get('gain')).balance, 10);
    assert.equal((await e.JournalEntry.list()).length, 1); const lines = await e.JournalLine.list();
    assert.equal(lines.reduce((n, l) => n + l.debit - l.credit, 0), 0);
    assert.equal((await e.StockMovement.list()).length, 2); assert.equal((await e.Product.get('item')).current_cost, 10);
    assert.equal((await e.TreasuryTransaction.list()).length, 0); assert.equal((await e.TreasuryAccount.get('till')).balance, 1000);
    const detail = await env.ok({ action: 'inventoryAuditDetail', auditId: a.id }); assert.equal(detail.history.length, 5); assert.deepEqual(detail.history.map(h => h.revision), [1, 2, 3, 4, 5]);
    const workspace = await env.ok({ action: 'inventoryAuditWorkspace' }); assert.equal(workspace.total, 1); assert.equal(workspace.audits[0].status, 'posted'); assert.equal(workspace.audits[0].rows, undefined);
    const movements = await env.ok({ action: 'inventoryAuditMovements', balanceId: 'lot1' }); assert.equal(movements.total, 1); assert.equal(movements.rows[0].document_id, a.id);
    const admin = { user: { id: 'gm', role: 'admin' }, role: 'admin', employee: null };
    for (const [op, args] of [['create', [{ journal_id: a.journal_id, account_id: 'loss', debit: 1 }]], ['update', [lines[0].id, { debit: 999 }]], ['delete', [lines[0].id]], ['updateMany', [{ journal_id: a.journal_id }, { credit: 999 }]]]) await assert.rejects(storeModule.entityOperation(admin, 'JournalLine', op, args), /immutable/);
    const draft = await e.JournalEntry.create({ journal_number: 'DRAFT-1', description: 'Unrelated draft journal', entry_date: businessDate(), status: 'draft' });
    const draftLine = await e.JournalLine.create({ journal_id: draft.id, account_id: 'loss', debit: 1 });
    await assert.rejects(storeModule.entityOperation(admin, 'JournalLine', 'update', [draftLine.id, { journal_id: a.journal_id }]), /immutable/);
    assert.equal((await env.ok(Object.fromEntries(Object.entries(body).reverse()))).reused, true);
    assert.equal((await env.call({ ...body, note: 'different payload' })).status, 400);
    assert.equal((await env.call(env.write('Recount', a, { note: 'Try to alter posted history' }))).status, 400);
  } finally { await env.close(); }
});

test('warehouse adjustments work through real stores and their journal lines cannot be edited, removed or extended',async()=>{
  const env=await environment();try{
    env.actAs('warehouse','warehouse_manager');
    const workspace=await env.ok({action:'warehouseAdjustmentWorkspace',warehouseId:'main'});
    const body={action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),warehouseId:'main',date:businessDate(),accountId:'loss',reference:'COUNT-WH-01',reason:'Warehouse physical count verified',rows:workspace.rows.map((row,i)=>({balance_id:row.balance_id,fingerprint:row.fingerprint,counted_quantity:[8,6][i]}))};
    const result=await env.ok(body),e=env.entities;
    assert.equal(result.value_difference,-10);assert.equal((await e.Account.get('inventory')).balance,140);assert.equal((await e.Account.get('loss')).balance,10);
    assert.equal((await env.ok(Object.fromEntries(Object.entries(body).reverse()))).reused,true);
    const journal=await e.JournalEntry.get(result.journal_id),lines=await e.JournalLine.list();assert.equal(journal.source_module,'inventory_adjustment');
    const admin={user:{id:'gm',role:'admin'},role:'admin',employee:null};
    for(const [op,args] of [['create',[{journal_id:journal.id,account_id:'loss',debit:1}]],['bulkCreate',[[{journal_id:journal.id,account_id:'loss',debit:1}]]],['update',[lines[0].id,{debit:999}]],['delete',[lines[0].id]],['deleteMany',[{journal_id:journal.id}]],['updateMany',[{journal_id:journal.id},{credit:999}]]])await assert.rejects(storeModule.entityOperation(admin,'JournalLine',op,args),/immutable/);
    const audit=await e.AuditLog.get(result.id);assert.equal(audit.warehouse_adjustment_result.rows.length,2);
    assert.equal((await e.StockBalance.get('lot1')).qc_status,'quarantine');assert.equal((await e.TreasuryTransaction.list()).length,0);
  }finally{await env.close();}
});

test('counts require all quantities, reasons, evidence, correct accounts, revision and independent GM approval', async () => {
  const env = await environment(); try {
    let a = await env.start();
    assert.match((await env.call(env.write('Submit', a))).error, /Count every/);
    a = await env.save(a, [8, 6], { evidenceReference: '' }); assert.match((await env.call(env.write('Submit', a))).error, /evidence/);
    a = await env.save(a, [8, 6], { lossAccountId: 'cash' }); assert.match((await env.call(env.write('Submit', a))).error, /loss.*account/);
    a = await env.save(a, [8, 6], { rows: a.rows.map(r => ({ balance_id: r.balance_id, counted_quantity: 1, reason: '' })) }); assert.match((await env.call(env.write('Submit', a))).error, /Explain the variance/);
    a = await env.save(a); const previous = a; a = await env.change('Submit', a);
    assert.match((await env.call(env.write('Save', previous, { rows: [] }))).error, /another session/);
    assert.match((await env.call(env.write('Approve', a, { note: 'Self approval attempt' }))).error, /Only the General Manager/);
    env.actAs('accountant', 'admin'); assert.match((await env.call(env.write('Approve', a, { note: 'Self approval attempt' }))).error, /you prepared/);
    env.actAs('other-accountant'); assert.match((await env.call(env.write('Cancel', a, { note: 'Cancel another count' }))).error, /count owner/);
    env.actAs('gm', 'admin'); a = await env.change('Return', a, { note: 'Please recount the damaged lot' }); assert.equal(a.status, 'draft');
    a = await env.save(a); a = await env.change('Submit', a);
    assert.match((await env.call(env.write('Approve', a, { note: 'Edited this count myself' }))).error, /you prepared/);
  } finally { await env.close(); }
});

test('stock changes after approval block posting; recount resets quantities and approval', async () => {
  const env = await environment(); try {
    let a = await env.approve(await env.change('Submit', await env.save(await env.start())));
    await env.entities.StockBalance.update('lot1', { quantity: 9, total_value: 90 });
    const failed = await env.call(env.write('Post', a)); assert.match(failed.error, /changed since/);
    assert.equal((await env.entities.JournalEntry.list()).length, 0);
    assert.equal((await env.ok({ action: 'inventoryAuditDetail', auditId: a.id })).stale.length, 1);
    a = await env.change('Recount', a, { note: 'Stock issued during count' }); assert.equal(a.status, 'draft'); assert.equal(a.rows[0].book_quantity, 9); assert.equal(a.rows[0].counted_quantity, null); assert.equal(a.approved_by, ''); assert.equal(a.evidence_reference, '');
    await env.entities.StockBalance.update('lot1', { warehouse_id: 'moved' });
    assert.match((await env.call(env.write('Recount', a, { note: 'Moved stock recount' }))).error, /moved warehouses/);
  } finally { await env.close(); }
});

test('closed or missing periods block posting and late failures roll back stock, movements, GL and audit event', async () => {
  const env = await environment(); try {
    const e = env.entities, a = await env.approve(await env.change('Submit', await env.save(await env.start()))), body = env.write('Post', a);
    await e.AccountingPeriod.update('open', { status: 'closed' }); assert.match((await env.call(body)).error, /open accounting period/);
    await e.AccountingPeriod.update('open', { status: 'open', start_date: '1990-01-01', end_date: '1990-12-31' }); assert.match((await env.call(body)).error, /open accounting period/);
    const date = businessDate(); await e.AccountingPeriod.update('open', { start_date: date, end_date: date });
    const update = e.Product.update; e.Product.update = async () => { throw Error('Late cost update failed'); };
    assert.match((await env.call(body)).error, /Late cost/);
    assert.equal((await e.StockBalance.get('lot1')).quantity, 10); assert.equal((await e.StockBalance.get('lot2')).quantity, 5); assert.equal((await e.StockMovement.list()).length, 0); assert.equal((await e.JournalEntry.list()).length, 0); assert.equal((await e.JournalLine.list()).length, 0); assert.equal((await e.Account.get('inventory')).balance, 150); assert.equal((await e.Account.get('loss')).balance, 0);
    assert.equal((await env.ok({ action: 'inventoryAuditDetail', auditId: a.id })).audit.status, 'approved');
    e.Product.update = update; assert.equal((await env.ok(body)).audit.status, 'posted');
  } finally { await env.close(); }
});

test('matched counts close without mutations; managed delivery discrepancies record findings without adjustments', async () => {
  const env = await environment(); try {
    let a = await env.change('Submit', await env.save(await env.start(), [10, 5])); assert.equal(a.status, 'matched');
    await env.entities.Warehouse.update('main', { warehouse_type: 'commercial_custody' });
    a = await env.change('Submit', await env.save(await env.start(), [8, 6], { lossAccountId: '', gainAccountId: '' })); assert.equal(a.status, 'referred');
    assert.equal((await env.entities.StockMovement.list()).length, 0); assert.equal((await env.entities.JournalEntry.list()).length, 0); assert.equal((await env.entities.StockBalance.get('lot1')).quantity, 10);
    assert.equal((await env.call(env.write('Post', a))).status, 400);
  } finally { await env.close(); }
});

test('zero-stock surplus needs established cost; full write-off preserves fractional costs; invalid stock mappings cannot post', async () => {
  const env = await environment(); try {
    const e = env.entities;
    await e.StockBalance.update('lot1', { quantity: 0, total_value: 0, unit_cost: 0 });
    let a = await env.save(await env.start(['lot1']), [2]); assert.match((await env.call(env.write('Submit', a))).error, /no established carrying cost/);
    await e.StockBalance.update('lot1', { quantity: 3, total_value: 1, unit_cost: 0.333333 });
    a = await env.approve(await env.change('Submit', await env.save(await env.start(['lot1']), [0]))); a = await env.change('Post', a);
    assert.equal((await e.StockBalance.get('lot1')).quantity, 0); assert.equal((await e.StockBalance.get('lot1')).total_value, 0); assert.equal((await e.Account.get('loss')).balance, 1);
    await e.StockBalance.update('lot1', { quantity: 1, total_value: 0.01, unit_cost: 0.01 });
    await e.Product.update('item', { inventory_type: 'service' });
    a = await env.save(await env.start(['lot1']), [1.001]); assert.equal(a.rows[0].value_difference, 0); assert.match((await env.call(env.write('Submit', a))).error, /configured stock item/);
    await e.Product.update('item', { inventory_type: 'raw_material', inventory_account_id: 'cash' });
    a = await env.save(await env.start(['lot1']), [0]); assert.match((await env.call(env.write('Submit', a))).error, /inventory asset/);
  } finally { await env.close(); }
});

test('role/module checks and generic entity guards prevent bypassing inventory audit controls', async () => {
  const env = await environment(); try {
    for (const args of [['agent', 'commercial'], ['inactive', 'cashier', false], ['restricted', 'cashier', true, false]]) { env.actAs(...args); assert.equal((await env.call({ action: 'inventoryAuditWorkspace' })).status, 400); }
    env.actAs('accountant'); assert.equal((await env.ok({ action: 'inventoryAuditWorkspace' })).role, 'cashier');
    const cashier = { user: { id: 'accountant', role: 'user' }, employee: { id: 'staff', role: 'cashier', status: 'active' }, role: 'cashier' };
    await assert.rejects(storeModule.entityOperation(cashier, 'StockBalance', 'update', ['lot1', { quantity: 999 }]), /permit|access|module/i);
    const admin = { user: { id: 'gm', role: 'admin' }, employee: null, role: 'admin' };
    for (const payload of [{ inventory_audit_state: {} }, { source_module: 'inventory_audit' }, { document_type: 'InventoryAudit' }, { document_id: 'IA-' + 'a'.repeat(32) }]) assert.throws(() => guardMutation(admin, 'AuditLog', 'create', payload), /inventory (audit|count)/i);
    for (const op of ['update', 'delete']) assert.throws(() => guardMutation(admin, 'JournalEntry', op, {}, { source_module: 'inventory_audit' }), /inventory audit/i);
  } finally { await env.close(); }
});

test('history and stock reads paginate beyond default entity limits without losing counts or lots', async () => {
  const env = await environment(); try {
    await env.entities.StockBalance.bulkCreate(Array.from({ length: 205 }, (_, i) => ({ id: 'extra-' + String(i).padStart(3, '0'), product_id: 'item', warehouse_id: 'main', lot_number: 'extra-' + i, quantity: 1, unit_cost: 10, total_value: 10 })));
    const startBody = env.write('Start', null, { title: 'Idempotent physical count', balanceIds: ['lot1'] }); const start = await env.ok(startBody); assert.equal((await env.ok(startBody)).audit.id, start.audit.id);
    for (let i = 0; i < 20; i++) await env.start(['lot1']);
    const first = await env.ok({ action: 'inventoryAuditWorkspace', page: 1 }), second = await env.ok({ action: 'inventoryAuditWorkspace', page: 2 });
    assert.equal(first.rows.length, 207); assert.equal(first.audits.length, 20); assert.equal(first.total, 21); assert.equal(first.has_more, true); assert.equal(second.audits.length, 1); assert.equal(second.has_more, false); assert.equal(new Set([...first.audits, ...second.audits].map(a => a.id)).size, 21);
    assert.match((await env.call(env.write('Start', null, { title: 'Too many lots selected', balanceIds: first.rows.slice(0, 101).map(r => r.balance_id) }))).error, /1 and 100/);
  } finally { await env.close(); }
});

test('accounting audit surpluses require Cold Room before submission and preserve the recorded stock on failure',async()=>{
 const env=await environment();try{
  await env.entities.Product.update('item',{inventory_type:'assembly'});
  const audit=await env.save(await env.start(['lot1']),[11]);
  const blocked=await env.call(env.write('Submit',audit));assert.equal(blocked.status,400);assert.match(blocked.error,/Cold Room/);assert.equal(Number((await env.entities.StockBalance.get('lot1')).quantity),10);
  assert.equal((await env.ok({action:'inventoryAuditDetail',auditId:audit.id})).audit.status,'draft');
 }finally{await env.close();}
});

test('accounting inventory reports legacy valuation issues per lot and cannot post without special adjustment access',async()=>{
 const env=await environment();try{
  await env.entities.StockBalance.update('lot1',{quantity:0,total_value:25});const data=await env.ok({action:'inventoryAuditWorkspace'});assert.match(data.rows.find(r=>r.balance_id==='lot1').issue,/Adjust quantity/);assert.equal(data.rows.find(r=>r.balance_id==='lot2').issue,undefined);
  const staff=globalThis.__cashierClient.auth.staff;globalThis.__cashierClient.auth.staff=async()=>({...await staff(),allowed_modules:['accounting']});const restricted=await env.ok({action:'inventoryAuditWorkspace'});assert.equal(restricted.can_post_adjustments,false);
  const blocked=await env.call({action:'inventoryAuditPost',auditId:'any',requestKey:crypto.randomUUID()});assert.equal(blocked.status,400);assert.match(blocked.error,/Special inventory adjustment access/);assert.equal((await env.entities.JournalEntry.list()).length,0);
 }finally{await env.close();}
});

test('count history export uses the same saved scope without scanning stock or the catalogue', async () => {
  const env=await environment();try {
    const a=await env.start();
    const normal=await env.ok({action:'inventoryAuditWorkspace'});
    const original=globalThis.__inventoryDB.unsafe,reads=[];
    globalThis.__inventoryDB.unsafe=(sql,args)=>{reads.push(sql);return original(sql,args);};
    const exported=await env.ok({action:'inventoryAuditWorkspace',historyOnly:true,page:1});
    assert.deepEqual(exported.audits,normal.audits);assert.equal(exported.total,1);assert.equal(exported.audits[0].id,a.id);assert.equal(exported.rows,undefined);
    assert.ok(reads.some(sql=>/FROM\s+public\."audit_log"/i.test(sql)));
    assert.ok(!reads.some(sql=>/FROM\s+public\."(?:product|stock_balance|warehouse)"/i.test(sql)));
    env.actAs('blocked','warehouse_manager');assert.equal((await env.call({action:'inventoryAuditWorkspace',historyOnly:true})).status,400);
  }finally{await env.close();}
});
