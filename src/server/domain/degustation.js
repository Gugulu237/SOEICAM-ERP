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
  const reserved = degustationState(manifest, movements), expense = await ruleAccount(s, 'marketing_degustation_expense');
  const checked = [];
  for (const line of lines) {
    const product = products.find(p => p.id === line.product_id);
    if (!finishedProduct(product) || product.is_active === false || product.configuration_status === 'draft') throw Error('Dégustation accepts only active finished products.');
    if (line.quantity > (reserved.get(product.id)?.remaining || 0)) throw Error(product.name + ' exceeds the remaining Dégustation allocation. Sale stock cannot be given away.');
    const inventory = product.inventory_account_id ? await s.Account.get(product.inventory_account_id) : await ruleAccount(s, 'finished_goods_inventory');
    if (!validPostingRuleAccount(inventory, 'finished_goods_inventory')) throw Error('Review the inventory account for ' + product.name + '.');
    checked.push({ ...line, product, inventory });
  }
  const reference = 'DEG-' + id.slice(-12).toUpperCase(), recordedAt = new Date().toISOString(), credits = new Map();
  let total = 0;
  for (const row of checked) {
    const issue = await stockIssue(svc, { productId: row.product.id, productName: row.product.name, quantity: row.quantity, warehouseId: context.stock_warehouse_id, dispatchId: context.dispatch_id,
      movementType: 'promotional_issue', documentType: 'Degustation', documentId: id, movementDate: date, saleableOnly: true, reason: 'Dégustation · ' + customer.business_name + ' · ' + reference });
    total = round2(total + issue.totalValue);
    credits.set(row.inventory.id, round2((credits.get(row.inventory.id) || 0) + issue.totalValue));
  }
  let journal = null;
  if (total > 0) ({ journal } = await postJournal(svc, { entryDate: date, description: 'Dégustation ' + reference + ' · ' + customer.business_name,
    sourceModule: 'degustation', sourceDocumentType: 'Degustation', sourceDocumentId: id, userId: user.id,
    lines: [{ account_id: expense.id, debit: total, credit: 0, description: 'Marketing expense · Dégustation' },
      ...[...credits].filter(([, value]) => value > 0).map(([account_id, value]) => ({ account_id, debit: 0, credit: value, description: 'Finished goods given to customers' }))] }));
  const issued = await readRecords(s.StockMovement, { document_type: 'Degustation', document_id: id });
  const evidence = { degustation_reference: reference, degustation_payload: fingerprint, degustation_notes: notes, customer_id: customer.id, customer_name: customer.business_name,
    employee_id: employee.id, employee_name: employee.full_name, recorded_by: user.id, recorded_at: recordedAt, journal_id: journal?.id || '', journal_number: journal?.journal_number || '' };
  for (const movement of issued) await s.StockMovement.update(movement.id, evidence);
  await audit(svc, { action: 'record_degustation', module: 'distribution', entityType: 'Dispatch', entityId: context.dispatch_id, userId: user.id,
    description: reference + ' · ' + employee.full_name + ' · ' + customer.business_name + ' · ' + lines.map(l => l.quantity + ' ' + products.find(p => p.id === l.product_id).name).join(', ') + ' · marketing cost ' + total + ' XAF' });
  return { record: degustationHistory(issued.map(m => ({ ...m, ...evidence })), { costs: false })[0] };
}
