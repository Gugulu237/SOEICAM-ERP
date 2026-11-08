import { createHash } from 'node:crypto';
import { stockIssue, postJournal, audit, today, round2 } from './field-ops.js';
import { currentSupplyRun } from './commercial-runs.js';
import { readRecords } from './commercial-workspace.js';
import { finishedProduct } from './commercial-rules.js';
import { validPostingRuleAccount } from '../../lib/posting-rule-types.js';
import { degustationQuantity, degustationState, degustationMovements, degustationHistory } from './degustation-stock.js';

async function ruleAccount(s, key) {
  const rules = await readRecords(s.PostingRule, { rule_key: key, is_active: true });
  if (rules.length !== 1) throw Error('Configure the ' + key + ' posting rule in Accounting → Posting Rules.');
  const account = await s.Account.get(rules[0].account_id);
  if (!validPostingRuleAccount(account, key)) throw Error('Review the account mapped to ' + key + ' before recording Dégustation.');
  return account;
}

// Provision a dedicated expense only when no mapping has been configured.
// Existing mappings are respected; disabled or invalid mappings require review.
async function expenseAccount(s) {
  const key = 'marketing_degustation_expense', rules = await readRecords(s.PostingRule, { rule_key: key });
  if (rules.length) return ruleAccount(s, key);
  const matches = await readRecords(s.Account, { account_number: 'DEGUSTATIONS' });
  if (matches.length > 1) throw Error('Review duplicate Degustations accounts before issuing giveaways.');
  const account = matches[0] || await s.Account.create({ account_number: 'DEGUSTATIONS', name: 'Degustations', account_type: 'expense', normal_balance: 'debit', financial_statement: 'income_statement', cash_flow_category: 'operating', currency: 'XAF', balance: 0, is_active: true, is_posting: true, is_system: true });
  if (!validPostingRuleAccount(account, key)) throw Error('Review the Degustations expense account before issuing giveaways.');
  await s.PostingRule.create({ rule_key: key, label: 'Degustations', description: 'Inventory cost of promotional giveaways', account_id: account.id, account_name: account.name, account_number: account.account_number, is_active: true });
  return account;
}

// Internal warehouse operation: the dispatch workflow has already checked the
// issuer, recipient, manifest and stock. A giveaway is consumed and expensed at
// issue, so it never remains in the commercial's available-for-sale balance.
export async function issueDegustation(svc, user, employee, dispatch, loaded, date) {
  const lines = loaded.filter(row => Number(row.line.degustation_quantity) > 0).map(row => ({ product_id: row.product.id, quantity: degustationQuantity(row.line.degustation_quantity), product: row.product }));
  if (!lines.length) return null;
  const expense = await expenseAccount(svc.entities), checked = [];
  for (const row of lines) {
    const inventory = row.product.inventory_account_id ? await svc.entities.Account.get(row.product.inventory_account_id) : await ruleAccount(svc.entities, 'finished_goods_inventory');
    if (!validPostingRuleAccount(inventory, 'finished_goods_inventory')) throw Error('Review the inventory account for ' + row.product.name + '.');
    checked.push({ ...row, inventory });
  }
  const id = 'DEG-ISSUE-' + dispatch.id;
  return postGiveaway(svc, user, employee, { dispatch_id: dispatch.id, stock_warehouse_id: dispatch.vehicle_warehouse_id }, { id, date, notes: dispatch.notes || '', fingerprint: createHash('sha256').update(JSON.stringify([dispatch.id, employee.id, lines.map(row => [row.product_id, row.quantity])])).digest('hex'), customer: null, expense, checked, atIssue: true });
}

// Only called after employeeStockAction verifies the actual signed-in employee.
// The enclosing API transaction commits custody, ledger and immutable evidence together.
export async function recordDegustation(svc, user, employee, body) {
  const s = svc.entities;
  if (typeof body.requestKey !== 'string' || !/^[a-f\d-]{36}$/i.test(body.requestKey)) throw Error('Reopen the Dégustation form for a valid request reference.');
  if (typeof body.dispatchId !== 'string' || !body.dispatchId || typeof body.customerId !== 'string' || !body.customerId) throw Error('Choose your issued goods and the customer receiving Dégustation.');
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 50 || new Set(body.lines.map(l => l?.product_id)).size !== body.lines.length) throw Error('Choose 1 to 50 distinct products for Dégustation.');
  const lines = body.lines.map(l => {
    const quantity = degustationQuantity(l?.quantity);
    if (!quantity || typeof l?.product_id !== 'string' || !l.product_id) throw Error('Choose a product and positive Dégustation quantity.');
    return { product_id: l.product_id, quantity };
  }).sort((a, b) => a.product_id.localeCompare(b.product_id));
  const date = body.date || today(), notes = String(body.notes || '').trim().slice(0, 1000);
  const id = 'DEG-' + createHash('sha256').update(user.id + ':' + body.requestKey).digest('hex');
  const fingerprint = createHash('sha256').update(JSON.stringify([employee.id, body.dispatchId, body.customerId, date, lines, notes])).digest('hex');
  const previous = await readRecords(s.StockMovement, { document_type: 'Degustation', document_id: id });
  if (previous.length) {
    if (previous.some(m => m.degustation_payload !== fingerprint || m.recorded_by !== user.id || m.status !== 'approved')) throw Error('This Dégustation reference was already recorded with different details.');
    return { record: degustationHistory(previous, { costs: false })[0], reused: true };
  }
  if (date !== today()) throw Error('Record Dégustation on the current business date.');
  const context = await currentSupplyRun(svc, employee.id, body.dispatchId, date, true);
  const [customer, manifest, movements, products] = await Promise.all([
    s.Customer.get(body.customerId), readRecords(s.DispatchLine, { dispatch_id: context.dispatch_id }),
    degustationMovements(svc, context.dispatch_id, context.stock_warehouse_id), readRecords(s.Product, { id: { $in: lines.map(l => l.product_id) } }),
  ]);
  if (!customer || customer.is_active === false || customer.customer_removed_at) throw Error('Choose an active customer receiving the giveaway.');
  const reserved = degustationState(manifest, movements), expense = await expenseAccount(s);
  const checked = [];
  for (const line of lines) {
    const product = products.find(p => p.id === line.product_id);
    if (!finishedProduct(product) || product.is_active === false || product.configuration_status === 'draft') throw Error('Dégustation accepts only active finished products.');
    if (line.quantity > (reserved.get(product.id)?.remaining || 0)) throw Error(product.name + ' exceeds the remaining Dégustation allocation. Sale stock cannot be given away.');
    const inventory = product.inventory_account_id ? await s.Account.get(product.inventory_account_id) : await ruleAccount(s, 'finished_goods_inventory');
    if (!validPostingRuleAccount(inventory, 'finished_goods_inventory')) throw Error('Review the inventory account for ' + product.name + '.');
    checked.push({ ...line, product, inventory });
  }
  return postGiveaway(svc, user, employee, context, { id, date, notes, fingerprint, customer, expense, checked });
}

async function postGiveaway(svc, user, employee, context, { id, date, notes, fingerprint, customer, expense, checked, atIssue = false }) {
  const s = svc.entities, recipient = customer?.business_name || employee.full_name;
  const reference = atIssue ? id : 'DEG-' + id.slice(-12).toUpperCase(), recordedAt = new Date().toISOString(), credits = new Map();
  let total = 0;
  for (const row of checked) {
    const issue = await stockIssue(svc, { productId: row.product.id, productName: row.product.name, quantity: row.quantity, warehouseId: context.stock_warehouse_id, dispatchId: context.dispatch_id,
      movementType: 'promotional_issue', documentType: 'Degustation', documentId: id, movementDate: date, saleableOnly: true, preserveRecordedValue: true, reason: 'Dégustation · ' + recipient + ' · ' + reference });
    total = round2(total + issue.totalValue);
    credits.set(row.inventory.id, round2((credits.get(row.inventory.id) || 0) + issue.totalValue));
  }
  let journal = null;
  if (total > 0) ({ journal } = await postJournal(svc, { entryDate: date, description: 'Dégustation ' + reference + ' · ' + recipient,
    sourceModule: 'degustation', sourceDocumentType: 'Degustation', sourceDocumentId: id, userId: user.id,
    lines: [{ account_id: expense.id, debit: total, credit: 0, description: 'Degustations' },
      ...[...credits].filter(([, value]) => value > 0).map(([account_id, value]) => ({ account_id, debit: 0, credit: value, description: 'Finished goods given to customers' }))] }));
  const issued = await readRecords(s.StockMovement, { document_type: 'Degustation', document_id: id });
  const evidence = { degustation_reference: reference, degustation_payload: fingerprint, degustation_notes: notes, degustation_at_issue: atIssue, customer_id: customer?.id || '', customer_name: customer?.business_name || '',
    employee_id: employee.id, employee_name: employee.full_name, recorded_by: user.id, recorded_at: recordedAt, journal_id: journal?.id || '', journal_number: journal?.journal_number || '' };
  for (const movement of issued) await s.StockMovement.update(movement.id, evidence);
  await audit(svc, { action: 'record_degustation', module: 'distribution', entityType: 'Dispatch', entityId: context.dispatch_id, userId: user.id,
    description: reference + ' · ' + employee.full_name + ' · ' + (atIssue ? 'Warehouse giveaway issue' : customer.business_name) + ' · ' + checked.map(l => l.quantity + ' ' + l.product.name).join(', ') + ' · marketing cost ' + total + ' XAF' });
  return { record: degustationHistory(issued.map(m => ({ ...m, ...evidence })), { costs: false })[0] };
}
