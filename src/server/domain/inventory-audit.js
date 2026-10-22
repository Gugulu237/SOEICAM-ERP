import { warehouseCountState } from '../../lib/warehouse-count.js';
import { adjustmentAccess } from './inventory-adjustment-access.js';
import { requireFinishedStorage } from '../../lib/finished-product-storage.js';
import { createHash } from 'node:crypto';
import { requireStaff, postJournal } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { stockUnit } from '../../lib/item-units.js';
import { businessDate } from '../../lib/business-date.js';
import { MANAGED_WAREHOUSE_TYPES } from '../../lib/warehouse-workspace.js';
import { countedQuantity, countVariance, auditTotals, roundMoney, roundQuantity } from '../../lib/inventory-audit.js';

export const INVENTORY_AUDIT_ACTIONS = ['inventoryAuditWorkspace', 'inventoryAuditDetail', 'inventoryAuditMovements', 'inventoryAuditStart', 'inventoryAuditSave', 'inventoryAuditSubmit', 'inventoryAuditApprove', 'inventoryAuditReturn', 'inventoryAuditRecount', 'inventoryAuditCancel', 'inventoryAuditPost'];
// PostgreSQL JSONB reorders object keys; fingerprints must survive a round trip.
const hash = value => createHash('sha256').update(JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)).digest('hex');
const eventQuery = { module: 'inventory_audit', entity_type: 'InventoryAudit' };
const label = (value, name, required = true) => {
  if (typeof value !== 'string' || value.trim().length > 1000 || (required && value.trim().length < 5)) throw Error(`Enter ${name} (5–1,000 characters)`);
  return value.trim();
};
const view = (row, keys) => Object.fromEntries(keys.split(' ').map(key => [key, row[key]]));
async function catalogue(s) {
  const [products, warehouses, accounts, rules, treasury] = await Promise.all([readRecords(s.Product), readRecords(s.Warehouse), readRecords(s.Account), readRecords(s.PostingRule, { is_active: true }), readRecords(s.TreasuryAccount)]);
  return { products: new Map(products.map(p => [p.id, p])), warehouses: new Map(warehouses.map(w => [w.id, w])), accounts: new Map(accounts.map(a => [a.id, a])), rules, cashIds: new Set(treasury.map(t => t.gl_account_id)) };
}
function inventoryAccount(product, c) {
  const key = ['assembly', 'finished_product'].includes(product.inventory_type) ? 'finished_goods_inventory' : 'raw_material_inventory';
  return product.inventory_account_id || c.rules.find(r => r.rule_key === key)?.account_id || '';
}
function snapshot(balance, c) {
  const product = c.products.get(balance.product_id), warehouse = c.warehouses.get(balance.warehouse_id);
  if (!product || !warehouse) throw Error(`Stock lot ${balance.id} has no registered item or warehouse`);
  const row = { balance_id: balance.id, product_id: product.id, product_name: product.name, sku: product.sku || '', unit: stockUnit(product),
    warehouse_id: warehouse.id, warehouse_name: warehouse.name, warehouse_type: warehouse.warehouse_type || '',
    lot_number: balance.lot_number || '', batch_number: balance.batch_number || '', expiry_date: balance.expiry_date || '', qc_status: balance.qc_status || 'approved', production_order_id: balance.production_order_id || '',
    book_quantity: Number(balance.quantity || 0), book_value: Number(balance.total_value || 0), unit_cost: Number(balance.unit_cost || 0), inventory_account_id: inventoryAccount(product, c),
    counted_quantity: null, reason: '', difference: null, value_difference: null };
  row.fingerprint = hash([balance, product.inventory_account_id || '', stockUnit(product), row.inventory_account_id, warehouse.warehouse_type, warehouse.is_active, product.inventory_type, product.is_active]);
  return row;
}
function validAccount(c, id, types, normal, name) {
  const a = c.accounts.get(id);
  if (!a || a.is_active === false || a.is_posting === false || !types.includes(a.account_type) || a.normal_balance !== normal || a.is_treasury || a.account_number === '1050' || c.cashIds.has(id)) throw Error(`Choose an active ${name} account with the appropriate normal balance`);
  return a;
}
async function events(s, id) { return readRecords(s.AuditLog, { ...eventQuery, entity_id: id }); }
function current(rows) { return rows.sort((a, b) => b.inventory_audit_state.revision - a.inventory_audit_state.revision)[0]?.inventory_audit_state; }
async function load(s, id) {
  if (typeof id !== 'string' || !/^IA-[a-f0-9]{32}$/.test(id)) throw Error('Choose a valid inventory count');
  const history = await events(s, id), state = current(history);
  if (!state) throw Error('Inventory count not found');
  return { state, history };
}
async function append(s, state, action, user, employee, eventId, payload, note = '') {
  const actor = employee?.full_name || user.full_name || user.email || user.id;
  const now = new Date().toISOString(), next = { ...state, revision: state.revision + 1, updated_at: now, totals: auditTotals(state.rows) };
  await s.AuditLog.create({ id: eventId, action, module: 'inventory_audit', entity_type: 'InventoryAudit', entity_id: state.id, user_id: user.id, user_name: actor, description: `${state.title}: ${action.replace('inventoryAudit', '')}`, reason: note,
    inventory_audit_state: next, inventory_audit_payload: payload, created_date: now });
  return next;
}
async function freshness(s, state, c) {
  const rows = await readRecords(s.StockBalance, { id: { $in: state.rows.map(r => r.balance_id) } }), byId = new Map(rows.map(r => [r.id, r]));
  const issues = [];
  for (const row of state.rows) {
    try { if (!byId.has(row.balance_id) || snapshot(byId.get(row.balance_id), c).fingerprint !== row.fingerprint) issues.push(`${row.product_name} / ${row.lot_number || 'no lot'} changed since the count snapshot`); }
    catch (error) { issues.push(error.message); }
  }
  return issues;
}
async function requireFresh(s, state, c) {
  const issues = await freshness(s, state, c);
  if (issues.length) throw Error(`${issues[0]}. Start a fresh recount; approval and old quantities cannot be carried forward`);
}
function authorizeEditor(state, role, user) {
  if (role !== 'admin' && state.created_by !== user.id) throw Error('Only the count owner or General Manager may change or post this count');
}
function validateCounts(state, requireCost = true) {
  if (state.rows.some(r => r.counted_quantity == null)) throw Error('Count every selected lot; enter zero explicitly for an empty lot');
  if (!state.evidence_reference || state.evidence_reference.length < 5) throw Error('Record the signed count sheet or supporting evidence reference');
  for (const row of state.rows) {
    if (row.difference && row.reason.length < 5) throw Error(`Explain the variance for ${row.product_name}`);
    if (requireCost && row.difference && (row.book_quantity > 0 ? row.book_value / row.book_quantity : row.unit_cost) <= 0) throw Error(`${row.product_name} has no established carrying cost; reconcile its valuation before adjusting quantity`);
  }
}
function journalPlan(state, c) {
  const groups = new Map(), add = (a, debit, credit) => {
    const key = `${a.id}:${debit ? 'debit' : 'credit'}`, line = groups.get(key) || { account_id: a.id, account_number: a.account_number, account_name: a.name, debit: 0, credit: 0 };
    line.debit = roundMoney(line.debit + debit); line.credit = roundMoney(line.credit + credit); groups.set(key, line);
  };
  for (const row of state.rows.filter(r => r.difference)) {
    const product = c.products.get(row.product_id);
    if (!product || product.inventory_type === 'service' || product.configuration_status === 'draft') throw Error(`${row.product_name} must be a configured stock item before adjustment`);
    if(row.difference>0)requireFinishedStorage(product,c.warehouses.get(row.warehouse_id),{isolation:true});
    const inventory = validAccount(c, row.inventory_account_id, ['asset'], 'debit', 'inventory asset'), value = Math.abs(row.value_difference);
    if (!value) continue;
    if (row.value_difference < 0) { add(validAccount(c, state.loss_account_id, ['expense', 'other_expense', 'cogs'], 'debit', 'inventory loss'), value, 0); add(inventory, 0, value); }
    else { add(inventory, value, 0); add(validAccount(c, state.gain_account_id, ['other_income'], 'credit', 'inventory surplus'), 0, value); }
  }
  return [...groups.values()];
}

// The function route wraps every write (stock, journal and audit event) in one
// serializable transaction. Count revisions are append-only AuditLog snapshots.
export async function inventoryAuditAction(client, user, body) {
  const { role, employee } = await requireStaff(client, user, ['admin', 'cashier'], 'accounting inventory audits');
  if (employee?.status && employee.status !== 'active' || role !== 'admin' && employee?.status !== 'active') throw Error('An active accounting staff account is required');
  client.auth.assertModule?.('accounting');
  const permissions=await adjustmentAccess(client,role,employee,{requirePermission:body.action==='inventoryAuditPost'});
  const s = client.asServiceRole.entities;
  if (body.action === 'inventoryAuditWorkspace') {
    const page = Number(body.page || 1);
    if (!Number.isSafeInteger(page) || page < 1) throw Error('Choose a valid history page');
    const historyOnly = body.historyOnly === true;
    const [c, balances, starts] = await Promise.all([historyOnly ? null : catalogue(s), historyOnly ? [] : readRecords(s.StockBalance), s.AuditLog.filter({ ...eventQuery, action: 'inventoryAuditStart' }, { sort: '-created_date,-id', limit: 20, skip: (page - 1) * 20 })]);
    const ids = starts.items.map(r => r.entity_id), history = ids.length ? await readRecords(s.AuditLog, { ...eventQuery, entity_id: { $in: ids } }) : [];
    const audits = ids.map(id => current(history.filter(h => h.entity_id === id))).filter(Boolean).map(a => { const { rows: omitted, ...summary } = a; return summary; });
    // Exporting count history must not reload all stock and the item catalogue on every page.
    if (historyOnly) return { audits, page, total: starts.total, has_more: starts.has_more };
    const rows = balances.map(b => { try { const row=snapshot(b,c),state=warehouseCountState(row);return {...row,unit_cost:state.carrying_cost ?? row.unit_cost,...(state.count_issue || state.requires_reconciliation?{issue:state.count_issue || 'Use Adjust quantity to verify and correct this lot valuation before starting an audited count.'}: {})}; } catch (error) { return { balance_id: b.id, product_name: b.product_name || b.product_id, warehouse_id: b.warehouse_id, book_quantity: b.quantity, book_value: b.total_value, issue: error.message }; } });
    return { role, can_post_adjustments:permissions.can_adjust, user_id: user.id, rows, warehouses: [...c.warehouses.values()].map(w => view(w, 'id name warehouse_type is_active')),
      accounts: [...c.accounts.values()].filter(a => a.is_active !== false && a.is_posting !== false && ['expense', 'other_expense', 'cogs', 'other_income'].includes(a.account_type)).map(a => view(a, 'id account_number name account_type normal_balance')),
      audits, page, total: starts.total, has_more: starts.has_more };
  }
  if (body.action === 'inventoryAuditMovements') {
    const page = Number(body.page || 1);
    if (!Number.isSafeInteger(page) || page < 1) throw Error('Choose a valid movement history page');
    const balance = await s.StockBalance.get(body.balanceId);
    if (!balance) throw Error('Stock lot not found');
    const result = await s.StockMovement.filter({ product_id: balance.product_id, lot_number: balance.lot_number || '', $or: [{ source_warehouse_id: balance.warehouse_id }, { destination_warehouse_id: balance.warehouse_id }] }, { sort: '-movement_date,-created_date,-id', limit: 50, skip: (page - 1) * 50 });
    return { rows: result.items.map(r => view(r, 'id movement_date movement_type quantity unit_cost total_value source_warehouse_id destination_warehouse_id lot_number document_type document_id journal_id reason status')), total: result.total, has_more: result.has_more };
  }
  if (body.action === 'inventoryAuditDetail') {
    const { state, history } = await load(s, body.auditId), c = await catalogue(s);
    return { audit: state, stale: ['draft', 'submitted', 'approved'].includes(state.status) ? await freshness(s, state, c) : [], history: history.sort((a, b) => a.inventory_audit_state.revision - b.inventory_audit_state.revision).map(h => ({ ...view(h, 'id action user_name user_id created_date reason'), revision: h.inventory_audit_state.revision, status: h.inventory_audit_state.status, totals: h.inventory_audit_state.totals })) };
  }
  if (!INVENTORY_AUDIT_ACTIONS.includes(body.action)) throw Error('Unknown inventory audit action');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestKey || '')) throw Error('Reopen the count to get a valid request reference');
  const payload = hash(body), eventId = 'IAE-' + hash([user.id, body.requestKey]).slice(0, 40), previous = await s.AuditLog.get(eventId);
  if (previous) {
    if (previous.inventory_audit_payload !== payload) throw Error('This request reference was used for different count details. Reload before retrying');
    return { audit: (await load(s, previous.entity_id)).state, reused: true };
  }
  const c = await catalogue(s);
  if (body.action === 'inventoryAuditStart') {
    if (!Array.isArray(body.balanceIds) || !body.balanceIds.length || body.balanceIds.length > 100 || new Set(body.balanceIds).size !== body.balanceIds.length || body.balanceIds.some(id => typeof id !== 'string' || id.length > 200)) throw Error('Select between 1 and 100 distinct stock lots');
    const balances = await readRecords(s.StockBalance, { id: { $in: body.balanceIds } });
    if (balances.length !== body.balanceIds.length || new Set(balances.map(b => b.warehouse_id)).size !== 1) throw Error('Select existing stock lots within one warehouse');
    const rows = balances.map(b => snapshot(b, c));
    for (const r of rows) { const state=warehouseCountState(r);if(state.count_issue || state.requires_reconciliation)throw Error(state.count_issue || 'Use Adjust quantity to verify and correct this lot valuation before starting an audited count.');countedQuantity(r.book_quantity); countVariance(r, r.book_quantity); }
    const state = { id: 'IA-' + hash([user.id, body.requestKey]).slice(0, 32), title: label(body.title, 'a count title'), status: 'draft', revision: 0, created_by: user.id, counter_name: employee?.full_name || user.full_name || user.email || user.id, makers: [user.id], created_at: new Date().toISOString(), count_date: businessDate(), snapshot_at: new Date().toISOString(),
      warehouse_id: rows[0].warehouse_id, warehouse_name: rows[0].warehouse_name, managed_location: MANAGED_WAREHOUSE_TYPES.includes(rows[0].warehouse_type), evidence_reference: '', loss_account_id: '', gain_account_id: '', rows };
    return { audit: await append(s, state, body.action, user, employee, eventId, payload) };
  }
  const { state: original } = await load(s, body.auditId), state = structuredClone(original);
  if (body.revision !== state.revision) throw Error('This count changed in another session. Reload it before continuing');
  let note = '';
  if (body.action === 'inventoryAuditApprove' || body.action === 'inventoryAuditReturn') {
    if (role !== 'admin') throw Error('Only the General Manager can review inventory variances');
    if (state.status !== 'submitted') throw Error('Only a submitted count can be reviewed');
    if (state.makers.includes(user.id)) throw Error('You cannot approve or independently review a count you prepared or edited');
    note = label(body.note, 'a review note');
    if (body.action === 'inventoryAuditReturn') { state.status = 'draft'; state.review_note = note; }
    else { await requireFresh(s, state, c); validateCounts(state); state.approved_plan = journalPlan(state, c); state.status = 'approved'; state.approved_by = user.id; state.approved_by_name = employee?.full_name || user.full_name || user.email || user.id; state.approved_at = new Date().toISOString(); state.review_note = note; }
  } else {
    authorizeEditor(state, role, user);
    if (body.action === 'inventoryAuditSave') {
      if (state.status !== 'draft') throw Error('Only a draft count can be edited');
      if (!Array.isArray(body.rows) || body.rows.length !== state.rows.length || new Set(body.rows.map(r => r.balance_id)).size !== state.rows.length) throw Error('Save exactly one count for each selected lot');
      const byId = new Map(body.rows.map(r => [r.balance_id, r]));
      state.rows = state.rows.map(row => {
        const input = byId.get(row.balance_id); if (!input) throw Error('The count contains an unexpected stock lot');
        const reason = label(input.reason || '', 'a variance reason', false);
        return { ...row, ...(input.counted_quantity === '' || input.counted_quantity == null ? { counted_quantity: null, difference: null, value_difference: null } : countVariance(row, input.counted_quantity)), reason };
      });
      state.evidence_reference = label(body.evidenceReference || '', 'the count sheet reference', false);
      state.loss_account_id = String(body.lossAccountId || ''); state.gain_account_id = String(body.gainAccountId || '');
      state.makers = [...new Set([...state.makers, user.id])];
    } else if (body.action === 'inventoryAuditRecount') {
      if (!['draft', 'submitted', 'approved'].includes(state.status)) throw Error('This count is closed. Start a new count for corrections');
      note = label(body.note, 'the recount reason');
      const balances = await readRecords(s.StockBalance, { id: { $in: state.rows.map(r => r.balance_id) } });
      if (balances.length !== state.rows.length) throw Error('A selected lot no longer exists. Cancel this count and start another');
      if (balances.some(b => b.warehouse_id !== state.warehouse_id)) throw Error('A selected lot moved warehouses. Cancel this count and start another');
      state.rows = balances.map(b => snapshot(b, c)); state.managed_location = state.rows.some(r => MANAGED_WAREHOUSE_TYPES.includes(r.warehouse_type)); state.status = 'draft'; state.evidence_reference = ''; state.approved_by = ''; state.approved_at = ''; state.approved_plan = null; state.snapshot_at = new Date().toISOString(); state.count_date = businessDate(); state.makers = [...new Set([...state.makers, user.id])];
    } else if (body.action === 'inventoryAuditCancel') {
      if (!['draft', 'submitted', 'approved'].includes(state.status)) throw Error('This count is already closed');
      note = label(body.note, 'the cancellation reason'); state.status = 'cancelled';
    } else if (body.action === 'inventoryAuditSubmit') {
      if (state.status !== 'draft') throw Error('Only a draft count can be submitted');
      await requireFresh(s, state, c); validateCounts(state, !state.managed_location);
      const totals = auditTotals(state.rows);
      if (!totals.variances) state.status = 'matched';
      else if (state.managed_location) { state.status = 'referred'; note = 'Discrepancies recorded for Distribution reconciliation. Paired vehicle and commercial manifests are unchanged.'; }
      else { journalPlan(state, c); state.status = 'submitted'; }
      state.submitted_at = new Date().toISOString();
    } else if (body.action === 'inventoryAuditPost') {
      if (state.status !== 'approved' || !state.approved_by || state.makers.includes(state.approved_by)) throw Error('Independent General Manager approval is required before posting');
      if (state.managed_location) throw Error('Reconcile managed delivery stock through Distribution');
      await requireFresh(s, state, c); validateCounts(state);
      const date = businessDate(), periods = await readRecords(s.AccountingPeriod, { start_date: { $lte: date }, end_date: { $gte: date } });
      if (!periods.length || periods.some(p => p.status !== 'open')) throw Error('An open accounting period is required for today. Closed periods cannot be adjusted');
      const plan = journalPlan(state, c);
      if (hash(plan) !== hash(state.approved_plan)) throw Error('The approved posting accounts changed. Recount and obtain fresh approval');
      const existing = await readRecords(s.StockMovement, { document_type: 'InventoryAudit', document_id: state.id });
      if (existing.length) throw Error('This count already has stock movements. Reconcile its posting before retrying');
      let journal;
      if (plan.length) {
        const result = await postJournal({ entities: s }, { entryDate: date, description: `Inventory count ${state.title} - ${state.warehouse_name}`, sourceModule: 'inventory_audit', sourceDocumentType: 'InventoryAudit', sourceDocumentId: state.id, userId: user.id, lines: plan });
        if (result.reused) throw Error('A journal already exists without a completed inventory audit. Reconcile it before posting');
        journal = result.journal;
      }
      for (const row of state.rows.filter(r => r.difference)) {
        const quantity = row.counted_quantity, value = row.value_after;
        await s.StockBalance.update(row.balance_id, { quantity, total_value: value, unit_cost: quantity > 0 ? value / quantity : row.unit_cost });
        await s.StockMovement.create({ product_id: row.product_id, product_name: row.product_name, quantity: Math.abs(row.difference), unit_cost: row.book_quantity > 0 ? row.book_value / row.book_quantity : row.unit_cost, total_value: Math.abs(row.value_difference), source_warehouse_id: row.difference < 0 ? row.warehouse_id : '', destination_warehouse_id: row.difference > 0 ? row.warehouse_id : '', lot_number: row.lot_number, batch_number: row.batch_number, production_order_id: row.production_order_id, expiry_date: row.expiry_date || undefined, movement_type: 'stock_count_variance', movement_date: date, status: 'approved', reason: row.reason, document_type: 'InventoryAudit', document_id: state.id, journal_id: journal?.id || '', inventory_audit_balance_id: row.balance_id, created_by: user.id });
      }
      for (const productId of new Set(state.rows.filter(r => r.difference).map(r => r.product_id))) {
        const balances = await readRecords(s.StockBalance, { product_id: productId });
        if (balances.some(b => !Number.isFinite(Number(b.quantity)) || Number(b.quantity) < 0 || !Number.isFinite(Number(b.total_value)) || Number(b.total_value) < 0)) throw Error('Reconcile invalid stock balances before updating item cost');
        const quantity = roundQuantity(balances.reduce((n, b) => n + Number(b.quantity || 0), 0)), value = roundMoney(balances.reduce((n, b) => n + Number(b.total_value || 0), 0));
        if (quantity > 0) await s.Product.update(productId, { current_cost: value / quantity });
      }
      state.status = 'posted'; state.posted_by = user.id; state.posted_at = new Date().toISOString(); state.posting_date = date; state.journal_id = journal?.id || ''; state.journal_number = journal?.journal_number || '';
    } else throw Error('Unknown inventory count action');
  }
  return { audit: await append(s, state, body.action, user, employee, eventId, payload, note) };
}
