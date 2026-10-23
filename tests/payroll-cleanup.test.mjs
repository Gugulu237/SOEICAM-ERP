import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { assertUnpostedPayroll, inspectPayroll, clearPayroll, restorePayroll } from '../scripts/payroll-cleanup-lib.mjs';

async function setup(t) {
  const db = new PGlite(), root = await mkdtemp(path.join(os.tmpdir(), 'soeicam-payroll-test-'));
  t.after(async () => { await db.close(); if (path.resolve(root).startsWith(path.join(os.tmpdir(), 'soeicam-payroll-test-'))) await rm(root, { recursive: true, force: true }); });
  await db.exec(`
    CREATE TABLE payroll_run (id text PRIMARY KEY, period_name text, status text, total_net numeric, journal_id text, approved_by text, approved_at timestamptz, extra_data jsonb DEFAULT '{}');
    CREATE TABLE payroll_line (id text PRIMARY KEY, payroll_id text, employee_id text, status text, net_pay numeric, extra_data jsonb DEFAULT '{}');
    CREATE TABLE payment (id text PRIMARY KEY, payment_type text, extra_data jsonb DEFAULT '{}');
    CREATE TABLE journal_entry (id text PRIMARY KEY, source_module text, source_document_type text, source_document_id text);
    CREATE TABLE treasury_transaction (id text PRIMARY KEY, source text, source_document_id text, extra_data jsonb DEFAULT '{}');
    CREATE TABLE audit_log (id text PRIMARY KEY, created_date timestamptz, updated_date timestamptz, created_by text, user_name text, action text, module text, entity_type text, entity_id text, description text, reason text, extra_data jsonb);
    CREATE TABLE employee (id text PRIMARY KEY, base_salary numeric);
    CREATE TABLE account (id text PRIMARY KEY, balance numeric);
    INSERT INTO payroll_run VALUES ('run','2026-11','under_review',57480,NULL,NULL,NULL,'{"payroll_revision":2}');
    INSERT INTO payroll_line VALUES ('line','run','agent','calculated',57480,'{"amount_paid":0}');
    INSERT INTO employee VALUES ('agent',60000);
    INSERT INTO account VALUES ('cash',123456);
    INSERT INTO payment VALUES ('supplier-payment','supplier_payment','{}');
    INSERT INTO journal_entry VALUES ('unrelated-journal','purchases','Bill','bill');
    INSERT INTO treasury_transaction VALUES ('unrelated-cash','purchase','bill','{}');
  `);
  const wrap = connection => ({ unsafe: async (query, values = []) => (await connection.query(query, values)).rows });
  const sql = { begin: run => db.transaction(tx => run(wrap(tx))) }, options = { target: 'fixture-database', backupDir: path.join(root, 'backup') };
  return { db, sql, options, root };
}
test('payroll-only cleanup backs up exact drafts, preserves master data and other transactions, audits and restores', async t => {
  const { db, sql, options } = await setup(t), review = await inspectPayroll(sql, options);
  assert.equal(review.runs, 1); assert.equal(review.payslips, 1);
  const result = await clearPayroll(sql, { ...options, expectedHash: review.hash });
  assert.equal(result.mode, 'payroll cleared');
  assert.equal((await db.query('SELECT * FROM payroll_run')).rows.length, 0);
  assert.equal((await db.query('SELECT * FROM payroll_line')).rows.length, 0);
  assert.equal((await db.query('SELECT base_salary FROM employee')).rows[0].base_salary, '60000');
  assert.equal((await db.query('SELECT balance FROM account')).rows[0].balance, '123456');
  assert.equal((await db.query('SELECT * FROM payment')).rows.length, 1);
  assert.equal((await db.query('SELECT * FROM journal_entry')).rows.length, 1);
  assert.equal((await db.query('SELECT * FROM treasury_transaction')).rows.length, 1);
  assert.equal((await db.query('SELECT action FROM audit_log')).rows[0].action, 'clear_unposted_payroll');
  const restored = await restorePayroll(sql, { target: options.target, backupFile: result.backupFile });
  assert.equal(restored.payslips, 1);
  assert.equal((await inspectPayroll(sql, options)).hash, review.hash);
  await assert.rejects(restorePayroll(sql, { target: options.target, backupFile: result.backupFile }), /newer activity/);
});
test('stale review, corrupt backup, wrong target and a failed audit cannot leave a partial cleanup', async t => {
  const { db, sql, options, root } = await setup(t), review = await inspectPayroll(sql, options);
  await db.exec("UPDATE payroll_line SET net_pay=58000");
  await assert.rejects(clearPayroll(sql, { ...options, expectedHash: review.hash }), /changed since review/);
  const fresh = await inspectPayroll(sql, options);
  await db.exec("ALTER TABLE audit_log ADD CONSTRAINT fail_audit CHECK (action <> 'clear_unposted_payroll')");
  await assert.rejects(clearPayroll(sql, { ...options, expectedHash: fresh.hash }));
  assert.equal((await db.query('SELECT * FROM payroll_run')).rows.length, 1);
  assert.equal((await db.query('SELECT * FROM payroll_line')).rows.length, 1);
  const file = path.join(root, 'backup', 'payroll-backup.json');
  await assert.rejects(restorePayroll(sql, { target: 'other-database', backupFile: file }), /different database/);
  const saved = JSON.parse(await readFile(file, 'utf8')); saved.data.PayrollLine[0].net_pay = 1;
  await writeFile(file, JSON.stringify(saved));
  await assert.rejects(restorePayroll(sql, { target: options.target, backupFile: file }), /checksum/);
});
test('posted, paid, orphaned or approved payroll is refused, including orphan salary payments', async t => {
  const { db, sql, options } = await setup(t);
  for (const [query, reset] of [
    ["UPDATE payroll_run SET status='posted'", "UPDATE payroll_run SET status='under_review'"],
    ["UPDATE payroll_run SET journal_id='posted-journal'", "UPDATE payroll_run SET journal_id=NULL"],
    ["UPDATE payroll_line SET extra_data='{\"amount_paid\":1}'", "UPDATE payroll_line SET extra_data='{}'"],
    ["UPDATE payroll_line SET payroll_id='missing'", "UPDATE payroll_line SET payroll_id='run'"],
    ["INSERT INTO payment VALUES ('salary','salary_payment','{}')", "DELETE FROM payment WHERE id='salary'"],
    ["INSERT INTO journal_entry VALUES ('salary','payroll','PayrollRun','missing-run')", "DELETE FROM journal_entry WHERE id='salary'"],
    ["INSERT INTO treasury_transaction VALUES ('salary','payroll','missing-run','{}')", "DELETE FROM treasury_transaction WHERE id='salary'"],
  ]) {
    await db.exec(query);
    await assert.rejects(inspectPayroll(sql, options));
    await db.exec(reset);
    assert.equal((await db.query('SELECT * FROM payroll_run')).rows.length, 1);
  }
  const state = { data: { PayrollRun: [{ id:'r', status:'draft' }], PayrollLine: [{ id:'l', payroll_id:'r', status:'calculated', extra_data:{ payroll_approved_by:'gm' } }] }, links:{ payments:[],journals:[],treasury:[] } };
  assert.throws(() => assertUnpostedPayroll(state), /approval\/payment/);
});
