// Manual, read-only diagnostic for the two journals named in the cleanup request.
// This script never deletes journals or changes balances.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import schema from '../src/server/generated/schema.json' with { type: 'json' };

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['JV00040', 'JV00041', 'JV000040', 'JV000041'];
const quoted = value => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw Error('Unexpected schema identifier.');
  return '"' + value + '"';
};

// The caller must supply a read-only database transaction.
export async function inspectRequestedJournals(tx) {
  const headers = await tx.unsafe(
    'SELECT id,journal_number,entry_date,description,source_module,source_document_type,source_document_id,status,total_debit,total_credit,reversal_of,reversed_by_journal,period_id,is_immutable,extra_data FROM public.journal_entry WHERE journal_number=ANY(ARRAY(SELECT jsonb_array_elements_text($1::text::jsonb))) ORDER BY journal_number,id',
    [JSON.stringify(targets)],
  );
  const journals = headers.map(({ extra_data: extra, ...row }) => ({
    ...row,
    reversal_of: row.reversal_of || extra?.reversal_of || null,
    reversed_by_journal: row.reversed_by_journal || extra?.reversed_by_journal || null,
    opening_batch_id: extra?.opening_batch_id || null,
  }));
  if (!journals.length) return { read_only: true, found: 0, journals: [], message: 'Neither requested journal number was found. No records were changed.' };
  const ids = journals.map(journal => journal.id);
  const lines = await tx.unsafe(
    'SELECT id,journal_id,account_id,account_number,account_name,debit,credit,status FROM public.journal_line WHERE journal_id=ANY(ARRAY(SELECT jsonb_array_elements_text($1::text::jsonb))) ORDER BY journal_id,id',
    [JSON.stringify(ids)],
  );
  const affectedAccounts = [...new Set(lines.map(line => line.account_id).filter(Boolean))];
  const accounts = affectedAccounts.length ? await tx.unsafe(
    "SELECT a.id,a.account_number,a.name,a.account_type,a.normal_balance,a.balance AS cached_balance," +
    " coalesce((SELECT sum(coalesce(l.debit,0)-coalesce(l.credit,0)) FROM public.journal_line l JOIN public.journal_entry j ON j.id=l.journal_id" +
    " WHERE l.account_id=a.id AND j.status IN ('posted','reversed') AND l.status IS DISTINCT FROM 'draft'),0) AS posted_debit_minus_credit" +
    " FROM public.account a WHERE a.id=ANY(ARRAY(SELECT jsonb_array_elements_text($1::text::jsonb))) ORDER BY a.account_number",
    [JSON.stringify(affectedAccounts)],
  ) : [];
  const treasury = affectedAccounts.length ? await tx.unsafe(
    'SELECT id,name,account_type,gl_account_id,balance FROM public.treasury_account WHERE gl_account_id=ANY(ARRAY(SELECT jsonb_array_elements_text($1::text::jsonb))) ORDER BY id',
    [JSON.stringify(affectedAccounts)],
  ) : [];
  // Counts only: do not export customer, supplier, payroll or transaction records.
  const references = [];
  for (const [entity, definition] of Object.entries(schema)) {
    if (entity === 'JournalLine') continue;
    const table = 'public.' + quoted(definition.table);
    const exclude = entity === 'JournalEntry' ? 'record.id<>ALL(ARRAY(SELECT jsonb_array_elements_text($1::text::jsonb))) AND ' : '';
    const [result] = await tx.unsafe(
      'SELECT count(*)::integer AS count FROM ' + table + ' record WHERE ' + exclude +
      "EXISTS (SELECT 1 FROM unnest(ARRAY(SELECT jsonb_array_elements_text($1::text::jsonb))) requested(id) WHERE jsonb_path_exists(to_jsonb(record),'$.** ? (@ == $id)',jsonb_build_object('id',requested.id)))",
      [JSON.stringify(ids)],
    );
    if (result.count) references.push({ entity, count: result.count });
  }
  const [ledger] = await tx.unsafe(
    "SELECT count(DISTINCT j.id)::integer AS posted_journal_count,coalesce(sum(coalesce(l.debit,0)),0) AS debit,coalesce(sum(coalesce(l.credit,0)),0) AS credit" +
    " FROM public.journal_entry j LEFT JOIN public.journal_line l ON l.journal_id=j.id AND l.status IS DISTINCT FROM 'draft' WHERE j.status IN ('posted','reversed')",
  );
  return { read_only: true, found: journals.length, journals, lines, accounts, treasury, references, ledger, message: 'Inspection only. No journals or balances were changed.' };
}

async function main() {
  const local = path.join(project, '.env.local');
  const settings = path.join(project, 'soeicam-server-logs/preview-settings.json');
  const envFile = fs.existsSync(local) ? local : fs.existsSync(settings) ? JSON.parse(fs.readFileSync(settings, 'utf8')).environmentFile : null;
  if (!envFile || !fs.existsSync(envFile)) throw Error('No saved ERP database environment was found.');
  process.loadEnvFile(envFile);
  if (!process.env.DATABASE_URL) throw Error('The saved ERP environment has no database connection.');
  const db = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require', connect_timeout: 10, idle_timeout: 5 });
  const deadline = setTimeout(() => { db.end({ timeout: 1 }).catch(() => {}); }, 45000);
  try {
    const result = await db.begin('isolation level repeatable read read only', async tx => {
      await tx.unsafe("SET LOCAL statement_timeout='5000'");
      return inspectRequestedJournals(tx);
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { clearTimeout(deadline); await db.end({ timeout: 1 }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ read_only: true, error: 'Journal inspection could not complete. No records were changed.', code: error.code || 'INSPECTION_FAILED' }));
    process.exitCode = 1;
  });
}
