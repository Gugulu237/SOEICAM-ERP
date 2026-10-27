import {journalCents} from './journal-validation.js';
import { requireFinancialReader } from './financial-report-access.js';
import { readRecords } from './commercial-workspace.js';
import { businessDate } from '../../lib/business-date.js';
export async function accountPosition(client, user, body = {}) {
  await requireFinancialReader(client,user);
  const date = body.date || businessDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date) throw Error('Select a valid financial position date');
  const stores = client.asServiceRole.entities;
  const [accounts, journals] = await Promise.all([readRecords(stores.Account), readRecords(stores.JournalEntry,{status:{$in:['posted','reversed']},entry_date:{$lte:date}})]);
  const balances = {}, ids = journals.map(j=>j.id),accountIds=new Set(accounts.map(a=>a.id));
  for(let i=0;i<ids.length;i+=100) {
    const lines = await readRecords(stores.JournalLine,{journal_id:{$in:ids.slice(i,i+100)}});
    for(const line of lines) {
      if(line.status==='draft') continue;
      if(!accountIds.has(line.account_id))throw Error("The ledger references a missing account. Run the accounting integrity check.");
      const d=journalCents(line.debit||0),c=journalCents(line.credit||0);if(d&&c)throw Error("A ledger line contains both a debit and credit. Run the accounting integrity check.");
      const row = balances[line.account_id] ||= {debit:0,credit:0,entries:0};
      const debit=Math.round(row.debit*100)+d,credit=Math.round(row.credit*100)+c;if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit))throw Error("Ledger totals exceed the supported precision.");
      row.debit=debit/100;row.credit=credit/100;row.entries++;
    }
  }
  return { accounts,balances,date,journal_count:journals.length };
}
