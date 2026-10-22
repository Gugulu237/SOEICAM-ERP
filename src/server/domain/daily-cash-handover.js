import { readRecords } from './commercial-workspace.js';
import { round2, audit } from './field-ops.js';
import { reconcileDailyCash } from '../../lib/cash-settlement.js';

// Called only after the cash-desk role/date checks, inside the serializable API transaction.
export async function requestDailyCash(svc, user, employee, body, date, { origin = 'cashier', receiver = employee } = {}) {
  const { commercialId, requestKey } = body;
  if (typeof commercialId !== 'string' || !commercialId || commercialId.length > 100) throw Error('Choose a Commercial agent');
  if (typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(requestKey)) throw Error('A valid cash request key is required; refresh the cash desk');
  if (origin === 'cashier' && employee?.id === commercialId) throw Error('You cannot request receipt of your own cash');
  const key = `${user.id}:${origin === 'cashier' ? 'daily-cash' : 'agent-daily-cash'}:${requestKey}`;
  const previous = (await readRecords(svc.entities.CashHandover, { idempotency_key: key }))[0];
  if (previous) {
    if (previous.commercial_id !== commercialId || previous.collection_date !== date) throw Error('This request reference belongs to another agent or date');
    return { handover: previous, reused: true };
  }
  const [dailyCollections, dailySales] = await Promise.all([
    readRecords(svc.entities.CashCollection, { commercial_id: commercialId, collection_date: date }),
    readRecords(svc.entities.FieldSale, { commercial_id: commercialId, transaction_date: date, payment_type: 'cash', status: 'approved_posted' }),
  ]);
  if (reconcileDailyCash(dailyCollections, [], dailySales).some(day => day.cash_sales_reconciliation_required)) throw Error('Recorded cash sales do not match the collection records for this agent and date. Reconcile them before confirming a handover; expenses cannot be deducted from sales cash');
  const collections = await readRecords(svc.entities.CashCollection, { commercial_id: commercialId, collection_date: date, method: 'cash', status: { $in: ['held_by_commercial', 'partially_received'] } });
  const available = collections.filter(c => !c.handover_id && Number(c.outstanding_amount) > 0);
  const selectedIds = Array.isArray(body.collectionIds) ? body.collectionIds : [];
  if (!available.length || selectedIds.length !== available.length || new Set(selectedIds).size !== selectedIds.length || available.some(c => !selectedIds.includes(c.id))) throw Error('Daily collections changed. Refresh the cash desk before requesting receipt');
  for (const collection of available) {
    if (![collection.amount_collected, collection.received_amount || 0, collection.outstanding_amount].every(value => Number.isFinite(Number(value)))) throw Error('Reconcile the collection amounts before requesting receipt');
    const remaining = round2(Number(collection.amount_collected) - Number(collection.received_amount || 0));
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining !== round2(collection.outstanding_amount)) throw Error('Reconcile the collection amounts before requesting receipt');
  }
  // A legacy allocation without a collection pointer must never be reserved twice.
  for (let offset = 0; offset < available.length; offset += 100) {
    const ids = available.slice(offset, offset + 100).map(c => c.id);
    const [allocations, receipts] = await Promise.all([
      readRecords(svc.entities.CashHandoverAllocation, { collection_id: { $in: ids } }),
      readRecords(svc.entities.Payment, { payment_type: 'customer_payment', collection_id: { $in: ids } }),
    ]);
    if (receipts.length) throw Error('These collections belong to the customer receipt workflow; refresh or reconcile them first');
    if (allocations.some(a => round2(Number(a.amount_allocated ?? a.amount) - Number(a.received_amount || 0)) > 0)) throw Error('A collection already belongs to an unfinished handover; receive that handover first');
  }
  const expected = round2(available.reduce((sum, c) => sum + Number(c.outstanding_amount), 0));
  if (expected !== round2(body.expectedAmount)) throw Error('The daily cash balance changed. Refresh before requesting receipt');
  const actor = employee?.full_name || user.full_name || user.email, now = new Date().toISOString();
  const handover = await svc.entities.CashHandover.create({ handover_number: `HOV-${crypto.randomUUID().toUpperCase()}`,
    commercial_id: commercialId, commercial_name: available[0].commercial_name, cashier_id: receiver?.id || user.id, cashier_name: receiver?.full_name || actor,
    handover_date: date, collection_date: date, expected_amount: expected, offered_amount: origin === 'cashier' ? 0 : expected, received_amount: 0, status: 'submitted',
    requested_by_cashier: origin === 'cashier', requested_by: user.id, requested_at: now, submitted_at: now, idempotency_key: key,
    notes: `${origin === 'cashier' ? 'Cashier requested' : 'Agent reported depositing'} the cash collected on ${date}. Receipt is not yet confirmed.` });
  for (const collection of available) {
    await svc.entities.CashHandoverAllocation.create({ handover_id: handover.id, handover_number: handover.handover_number,
      collection_id: collection.id, collection_number: collection.collection_number, sale_number: collection.sale_number || '',
      customer_name: collection.customer_name || '', amount_allocated: Number(collection.outstanding_amount), received_amount: 0, allocation_date: date });
    await svc.entities.CashCollection.update(collection.id, { status: 'handover_submitted', handover_id: handover.id, handover_number: handover.handover_number });
  }
  await audit(svc, { action: origin === 'cashier' ? 'request_daily_cash' : 'prepare_agent_deposit', module: 'cashier', entityType: 'CashHandover', entityId: handover.id, userId: user.id,
    description: `${actor} ${origin === 'cashier' ? 'requested' : 'prepared a deposit report for'} ${expected} XAF collected by ${handover.commercial_name} on ${date}` });
  return { handover, reused: false };
}
