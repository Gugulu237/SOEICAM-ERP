import { round2 } from './field-ops.js';
import { requireFinancialReader } from './financial-report-access.js';
import { readRecords } from './commercial-workspace.js';
import { businessDate } from '../../lib/business-date.js';
export async function accountPosition(client, user, body = {}) {
  await requireFinancialReader(client,user);
  const date = body.date || businessDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date) throw Error('Select a valid financial position date');
  const stores = client.asServiceRole.entities;
  const [accounts, journals] = await Promise.all([readRecords(stores.Account), readRecords(stores.JournalEntry,{status:'posted',entry_date:{$lte:date}})]);
  const balances = {}, ids = journals.map(j=>j.id);
  for(let i=0;i<ids.length;i+=100) {
    const lines = await readRecords(stores.JournalLine,{journal_id:{$in:ids.slice(i,i+100)}});
    for(const line of lines) {
      if(line.status==='draft' || line.status==='reversed') continue;
      const row = balances[line.account_id] ||= {debit:0,credit:0,entries:0};
      row.debit=round2(row.debit+Number(line.debit || 0));row.credit=round2(row.credit+Number(line.credit || 0));row.entries++;
    }
  }
  return { accounts,balances,date,journal_count:journals.length };
}
