import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';

const canonical = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const unpack = row => ({ ...row.extra_data, ...row });
const tableNames = ['payroll_run', 'payroll_line', 'payment', 'journal_entry', 'treasury_transaction', 'audit_log'];

// This maintenance operation deliberately excludes employees, accounts, cash,
// stock and the general business-data reset. It may clear only unposted payroll.
export function assertUnpostedPayroll(snapshot) {
  const runs = snapshot.data.PayrollRun.map(unpack), lines = snapshot.data.PayrollLine.map(unpack);
  const ids = new Set(runs.map(run => run.id));
  if (runs.some(run => !['draft', 'calculated', 'under_review', 'rejected'].includes(run.status) || run.journal_id || run.approved_by || run.approved_at || run.payroll_posted_date || Number(run.total_paid || 0) !== 0)) throw Error('Payroll includes an approval, posting or payment. No payroll was cleared.');
  if (lines.some(line => !ids.has(line.payroll_id) || !['draft', 'calculated', 'under_review', 'rejected'].includes(line.status) || line.payroll_approved_by || line.payroll_approved_at || Number(line.amount_paid || 0) !== 0)) throw Error('A payslip has approval/payment evidence or no matching run. No payroll was cleared.');
  if (Object.values(snapshot.links).some(rows => rows.length)) throw Error('Payroll has linked payments, journals or treasury activity. No payroll was cleared.');
  return { runs: runs.length, payslips: lines.length, periods: runs.map(run => run.period_name) };
}

async function snapshot(tx, target) {
  const data = {};
  for (const [entity, table] of [['PayrollRun', 'payroll_run'], ['PayrollLine', 'payroll_line']]) data[entity] = await tx.unsafe(`SELECT * FROM public.${table} ORDER BY id`);
  const references = '(SELECT id FROM public.payroll_run UNION SELECT id FROM public.payroll_line)';
  const links = {
    payments: await tx.unsafe("SELECT id FROM public.payment WHERE payment_type = 'salary_payment' OR extra_data ? 'payroll_run_id' OR extra_data ? 'payroll_line_id' ORDER BY id"),
    journals: await tx.unsafe(`SELECT id FROM public.journal_entry WHERE source_module = 'payroll' OR source_document_type IN ('PayrollRun','PayrollPayment') OR source_document_id IN ${references} ORDER BY id`),
    treasury: await tx.unsafe(`SELECT id FROM public.treasury_transaction WHERE source = 'payroll' OR source_document_id IN ${references} OR extra_data ? 'payroll_run_id' OR extra_data ? 'payroll_line_id' ORDER BY id`),
  };
  return { target, data, links, hash: digest({ target, data, links }) };
}
async function lock(tx) {
  await tx.unsafe("SET LOCAL lock_timeout = '3s'");
  await tx.unsafe("SET LOCAL statement_timeout = '30s'");
  await tx.unsafe('LOCK TABLE ' + tableNames.map(table => 'public.' + table).join(', ') + ' IN EXCLUSIVE MODE');
}
async function backup(directory, value) {
  if (!directory || !path.isAbsolute(directory)) throw Error('Choose an absolute new payroll backup directory.');
  const parent = await realpath(path.dirname(directory));
  if (parent.toLowerCase() !== path.resolve(path.dirname(directory)).toLowerCase()) throw Error('Choose a backup directory without symbolic links.');
  for (let cursor = parent; ; cursor = path.dirname(cursor)) {
    try { await stat(path.join(cursor, '.git')); throw Error('Payroll backups must be outside a Git repository.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(cursor) === cursor) break;
  }
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const file = path.join(directory, 'payroll-backup.json');
  await writeFile(file, JSON.stringify(canonical({ format: 'soeicam-unposted-payroll-v1', created_at: new Date().toISOString(), ...value }), null, 2) + '\n', { flag: 'wx', mode: 0o600, flush: true });
  const saved = await readPayrollBackup(file);
  if (saved.hash !== value.hash) throw Error('Payroll backup verification failed. No payroll was cleared.');
  return file;
}
export async function readPayrollBackup(file) {
  const saved = JSON.parse(await readFile(file, 'utf8'));
  if (saved.format !== 'soeicam-unposted-payroll-v1' || !saved.data || Object.keys(saved.data).sort().join(',') !== 'PayrollLine,PayrollRun' || !saved.links || !Array.isArray(saved.data.PayrollRun) || !Array.isArray(saved.data.PayrollLine) || saved.hash !== digest({ target: saved.target, data: saved.data, links: saved.links })) throw Error('Invalid payroll backup or checksum.');
  assertUnpostedPayroll(saved);
  return saved;
}
async function audit(tx, action, summary, actor, extra) {
  const id = 'PRC-' + randomUUID();
  const description = `${action === 'clear_unposted_payroll' ? 'Cleared' : 'Restored'} ${summary.runs} unposted payroll run(s) and ${summary.payslips} payslip(s); employee salary settings retained.`;
  await tx.unsafe("INSERT INTO public.audit_log (id, created_date, updated_date, created_by, user_name, action, module, entity_type, entity_id, description, reason, extra_data) VALUES ($1, now(), now(), $2, $2, $3, 'payroll', 'PayrollCleanup', $1, $4, $5, $6::jsonb)", [id, actor, action, description, 'Project owner requested pre-launch payroll cleanup', JSON.stringify({ audit_source: 'local_maintenance', ...extra })]);
}
export async function inspectPayroll(sql, { target }) {
  return sql.begin(async tx => {
    await tx.unsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const state = await snapshot(tx, target), summary = assertUnpostedPayroll(state);
    return { target, hash: state.hash, ...summary, mode: 'review only; no changes' };
  });
}
export async function clearPayroll(sql, { target, expectedHash, backupDir, actor = 'Project owner (local maintenance)' }) {
  return sql.begin(async tx => {
    await lock(tx);
    const state = await snapshot(tx, target), summary = assertUnpostedPayroll(state);
    if (!expectedHash || expectedHash !== state.hash) throw Error('Payroll changed since review. Review again before clearing.');
    if (!summary.runs && !summary.payslips) return { mode: 'already empty', ...summary };
    const backupFile = await backup(backupDir, state);
    await tx.unsafe('DELETE FROM public.payroll_line');
    await tx.unsafe('DELETE FROM public.payroll_run');
    const after = await snapshot(tx, target);
    if (after.data.PayrollRun.length || after.data.PayrollLine.length || digest(after.links) !== digest(state.links)) throw Error('Payroll clear verification failed. Transaction rolled back.');
    await audit(tx, 'clear_unposted_payroll', summary, actor, { backup_hash: state.hash, periods: summary.periods });
    return { mode: 'payroll cleared', ...summary, backupFile };
  });
}
export async function restorePayroll(sql, { target, backupFile, actor = 'Project owner (local maintenance)' }) {
  const saved = await readPayrollBackup(backupFile);
  if (saved.target !== target) throw Error('This payroll backup belongs to a different database.');
  return sql.begin(async tx => {
    await lock(tx);
    const current = await snapshot(tx, target);
    if (current.data.PayrollRun.length || current.data.PayrollLine.length || Object.values(current.links).some(rows => rows.length)) throw Error('Payroll or payroll transactions now exist. Restore stopped to preserve newer activity.');
    for (const [entity, table] of [['PayrollRun', 'payroll_run'], ['PayrollLine', 'payroll_line']]) for (const row of saved.data[entity]) {
      // Column types come from the live table, preserving exact money and dates.
      await tx.unsafe(`INSERT INTO public.${table} SELECT * FROM jsonb_populate_record(NULL::public.${table}, $1::jsonb)`, [JSON.stringify(row)]);
    }
    const restored = await snapshot(tx, target);
    if (restored.hash !== saved.hash) throw Error('Payroll restore verification failed. Transaction rolled back.');
    const summary = assertUnpostedPayroll(restored);
    await audit(tx, 'restore_unposted_payroll', summary, actor, { backup_hash: saved.hash });
    return { mode: 'payroll restored', ...summary };
  });
}
