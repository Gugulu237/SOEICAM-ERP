import { commercialActor } from './commercial-actor.js';
import { readRecords } from './commercial-workspace.js';
import { effectiveRole } from './roles.js';
import { round2, today, audit } from './field-ops.js';
import { requestDailyCash } from './daily-cash-handover.js';
import { reconcileDailyCash } from '../../lib/cash-settlement.js';

function checkedDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value || value > today()) throw Error('Choose a valid date no later than today');
  return value;
}

// Reports custody transfer only. The Cashier remains the sole receipt confirmer.
export async function reportAgentCashDeposit(base44, user, body) {
  const { employee: agent } = await commercialActor(base44, user, body.commercialId, 'reporting a cash deposit');
  const svc = base44.asServiceRole, date = checkedDate(body.date), depositedDate = checkedDate(body.depositedDate || today());
  if (depositedDate < date) throw Error('The deposit cannot precede the cash collection date');
  if (typeof body.requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.requestKey)) throw Error('Reopen the deposit form to create a valid reference');
  const key = `${user.id}:agent-deposit:${body.requestKey}`;
  const signature = JSON.stringify([agent.id, date, depositedDate, body.cashierId, body.amount]);
  const handovers = await readRecords(svc.entities.CashHandover, { commercial_id: agent.id });
  const previous = handovers.flatMap(h => h.agent_deposit_reports || []).find(r => r.request_key === key);
  if (previous) {
    if (previous.signature !== signature) throw Error('This deposit reference belongs to different details');
    return { reported: true, reused: true, amount: body.amount, status: 'awaiting_cashier_confirmation' };
  }
  const cashier = body.cashierId ? await svc.entities.Employee.get(body.cashierId) : null;
  if (!cashier || cashier.status !== 'active' || effectiveRole({ role: 'user' }, cashier) !== 'cashier' || cashier.id === agent.id) throw Error('Choose an active Cashier receiving the money');
  const [collections, sales] = await Promise.all([
    readRecords(svc.entities.CashCollection, { commercial_id: agent.id, collection_date: date, method: 'cash' }),
    readRecords(svc.entities.FieldSale, { commercial_id: agent.id, transaction_date: date, status: 'approved_posted', payment_type: 'cash' }),
  ]);
  const day = reconcileDailyCash(collections, handovers, sales)[0];
  if (!day || day.disputed) throw Error('The cash day needs reconciliation before reporting a deposit');
  const pending = collections.filter(c => c.status !== 'cancelled' && Number(c.outstanding_amount) > 0 && !c.agent_deposit_reported_at);
  const amount = round2(pending.reduce((sum, c) => sum + Number(c.outstanding_amount), 0));
  if (!pending.length || !Number.isFinite(Number(body.amount)) || amount <= 0 || round2(body.amount) !== amount) throw Error('The cash balance changed. Refresh and report the full unreported cash amount; expenses cannot be deducted');
  const unreserved = pending.filter(c => !c.handover_id);
  if (unreserved.length) {
    const created = await requestDailyCash(svc, user, agent, { commercialId: agent.id, collectionIds: unreserved.map(c => c.id), expectedAmount: round2(unreserved.reduce((sum, c) => sum + Number(c.outstanding_amount), 0)), requestKey: body.requestKey }, date, { origin: 'agent', receiver: cashier });
    handovers.push(created.handover);
    unreserved.forEach(c => { c.handover_id = created.handover.id; });
  }
  const now = new Date().toISOString();
  for (const handoverId of new Set(pending.map(c => c.handover_id))) {
    const handover = handovers.find(h => h.id === handoverId);
    if (!handover || !['submitted', 'partially_received'].includes(handover.status)) throw Error('An existing handover changed or needs reconciliation. Refresh before reporting a deposit');
    const linked = pending.filter(c => c.handover_id === handoverId);
    const allocations = await readRecords(svc.entities.CashHandoverAllocation, { handover_id: handoverId });
    for (const c of linked) {
      const allocated = allocations.filter(a => a.collection_id === c.id).reduce((sum, a) => sum + Math.max(0, Number(a.amount_allocated || 0) - Number(a.received_amount || 0)), 0);
      if (round2(allocated) < round2(c.outstanding_amount)) throw Error('The collection allocation needs reconciliation before reporting a deposit');
    }
    const reported = round2(linked.reduce((sum, c) => sum + Number(c.outstanding_amount), 0));
    await svc.entities.CashHandover.update(handoverId, { agent_deposit_reported_at: now, agent_deposit_reported_amount: reported,
      agent_deposit_cashier_id: cashier.id, agent_deposit_cashier_name: cashier.full_name,
      agent_deposit_reports: [...(handover.agent_deposit_reports || []), { request_key: key, signature, collection_date: date, deposited_date: depositedDate, amount: reported, cashier_id: cashier.id, cashier_name: cashier.full_name, reported_by: user.id, reported_at: now }] });
    await audit(svc, { action: 'report_agent_cash_deposit', module: 'cashier', entityType: 'CashHandover', entityId: handoverId, userId: user.id,
      description: `${agent.full_name} reported depositing ${reported} XAF with ${cashier.full_name}. Cashier receipt is pending.` });
  }
  for (const c of pending) await svc.entities.CashCollection.update(c.id, { agent_deposit_reported_at: now, agent_deposit_reported_amount: Number(c.outstanding_amount), agent_deposit_cashier_id: cashier.id, agent_deposit_cashier_name: cashier.full_name, agent_deposit_reported_by: user.id });
  return { reported: true, amount, status: 'awaiting_cashier_confirmation', cashierName: cashier.full_name };
}
