import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import schema from '../src/server/generated/schema.json' with { type: 'json' };
import { insertSnapshot } from '../scripts/migration-lib.mjs';
import { postgresAdapter } from './helpers/postgres-adapter.mjs';
import { splitRecord, flattenRecord } from '../src/server/query.js';
import { readEmployeeSignIn, changeEmployeeSignIn } from '../src/server/domain/employee-sign-in.js';
import { linkedClerkContext, linkClerkIdentity } from '../src/server/clerk-identities.js';
import { linkedSupabaseContext } from '../src/server/linked-user-context.js';
import { requireActiveContext, guardMutation } from '../src/server/access.js';
import { prepareStaffInvitation, staffInvitationStatuses, inviteStaff } from '../src/server/staff-invitations.js';

async function fixture(run) {
  const database = new PGlite({ parsers: { 1700: Number } });
  try {
    await database.waitReady;
    await database.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    for (const file of ['202610170001_erp_schema.sql', '202610170002_clerk_identities.sql']) await database.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
    const db = postgresAdapter(database), state = { failAudit: false };
    const stores = Object.fromEntries(['User', 'Employee', 'AuditLog'].map(kind => {
      const definition = schema[kind], table = 'public."' + definition.table + '"';
      const get = async id => flattenRecord((await db.unsafe('SELECT * FROM ' + table + ' WHERE id=$1', [id]))[0]);
      return [kind, {
        get,
        create: async row => {
          if (kind === 'AuditLog' && state.failAudit) throw Error('Audit unavailable');
          await insertSnapshot(db, { [kind]: [row] }); return get(row.id);
        },
        update: async (id, input) => {
          const { record, extra } = splitRecord(input, definition);
          for (const [key, value] of Object.entries(record)) await db.unsafe('UPDATE ' + table + ' SET "' + key + '"=$1 WHERE id=$2', [value, id]);
          if (Object.keys(extra).length) await db.unsafe('UPDATE ' + table + ' SET extra_data=extra_data || $1::text::jsonb WHERE id=$2', [JSON.stringify(extra), id]);
          return get(id);
        },
      }];
    }));
    await insertSnapshot(db, {
      User: [
        { id: 'gm', email: 'gm@example.test', role: 'admin' },
        { id: 'old', email: 'old@example.test', role: 'user', auth_user_id: 'supabase-old' },
        { id: 'other-login', email: 'other@example.test', role: 'user' },
      ],
      Employee: [
        { id: 'staff', full_name: 'Staff Member', email: 'contact@example.test', user_id: 'old', user_email: 'old@example.test', role: 'cashier', status: 'active', base_salary: 125000, job_title: 'Cashier', staff_roles_revision: 4, staff_role_assignments: [{ role_key: 'warehouse_manager' }] },
        { id: 'other', full_name: 'Other Employee', user_id: 'other-login', user_email: 'other@example.test', email: 'other-contact@example.test', role: 'driver', status: 'suspended' },
      ],
      AuditLog: [{ id: 'history', action: 'old_cash_receipt', user_id: 'old', entity_type: 'Employee', entity_id: 'staff', description: 'Historical attribution' }],
    });
    await db.unsafe("INSERT INTO erp_private.auth_identities(provider,subject,erp_user_id,verified_email) VALUES ('clerk','clerk-old','old','old@example.test')");
    const context = { user: await stores.User.get('gm'), employee: null, role: 'admin' };
    const transaction = async callback => { await database.exec('BEGIN'); try { const result = await callback(); await database.exec('COMMIT'); return result; } catch (error) { await database.exec('ROLLBACK'); throw error; } };
    const read = () => readEmployeeSignIn(context, stores, 'staff');
    const input = async (extra = {}) => ({ email: 'new@example.test', revision: (await read()).revision, reason: 'Employee email changed', confirmed: true, requestKey: crypto.randomUUID(), ...extra });
    await run({ database, db, state, stores, context, transaction, read, input, change: data => transaction(() => changeEmployeeSignIn(context, stores, db, 'staff', data)) });
  } finally { await database.close(); }
}

test('new login retains the employee and historic actors; previous Clerk and Supabase sessions lose staff access', () => fixture(async f => {
  const before = await f.stores.Employee.get('staff'), identities = await f.db.unsafe('SELECT * FROM erp_private.auth_identities');
  const result = await f.change(await f.input({ email: 'NEW@EXAMPLE.TEST' }));
  assert.notEqual(result.employee.user_id, 'old');
  assert.equal(result.employee.user_email, 'new@example.test');
  assert.equal(result.employee.email, 'contact@example.test');
  for (const key of ['id', 'full_name', 'role', 'status', 'base_salary', 'staff_role_assignments']) assert.deepEqual(result.employee[key], before[key]);
  assert.equal(result.employee.staff_roles_revision, 5);
  assert.equal((await f.stores.User.get(result.employee.user_id)).role, 'user');
  assert.equal((await f.stores.User.get('old')).auth_user_id, 'supabase-old');
  assert.equal((await f.stores.AuditLog.get('history')).user_id, 'old');
  assert.deepEqual(await f.db.unsafe('SELECT * FROM erp_private.auth_identities'), identities);
  const oldClerk = await linkedClerkContext(f.db, 'clerk-old'), oldSupabase = await linkedSupabaseContext(f.db, 'supabase-old');
  for (const context of [oldClerk, oldSupabase]) { assert.equal(context.employee, null); assert.throws(() => requireActiveContext(context), { status: 403 }); }
  await linkClerkIdentity(f.db, f.stores.User, { subject: 'clerk-new', email: 'new@example.test', fullName: 'Staff' });
  const signedIn = await linkedClerkContext(f.db, 'clerk-new');
  assert.equal(signedIn.employee.id, 'staff'); assert.equal(requireActiveContext(signedIn), 'cashier');
  const audit = (await f.db.unsafe("SELECT * FROM public.audit_log WHERE action='change_employee_signin'")).map(flattenRecord)[0];
  assert.equal(audit.user_id, 'gm'); assert.equal(audit.audit_source, 'server_verified');
  assert.deepEqual(audit.before_values, { user_id: 'old', email: 'old@example.test' });
  assert.deepEqual(audit.after_values, { user_id: result.employee.user_id, email: 'new@example.test' });
}));

test('an unassigned existing login works with either provider, without changing its identity or role', () => fixture(async f => {
  await f.stores.User.create({ id: 'existing', email: 'existing@example.test', role: 'user', auth_user_id: 'supabase-new' });
  const before = await f.stores.User.get('existing');
  const result = await f.change(await f.input({ email: 'existing@example.test' }));
  assert.equal(result.employee.user_id, 'existing'); assert.deepEqual(await f.stores.User.get('existing'), before);
  assert.equal((await linkedSupabaseContext(f.db, 'supabase-new')).employee.id, 'staff');
}));

test('checked retries do not duplicate accounts or audits; stale changes and reused confirmations cannot overwrite', () => fixture(async f => {
  const input = await f.input(), first = await f.change(input);
  const retry = await f.change(input); assert.equal(retry.reused, true); assert.equal(retry.employee.user_id, first.employee.user_id);
  assert.equal((await f.db.unsafe("SELECT count(*)::int AS n FROM public.audit_log WHERE action='change_employee_signin'"))[0].n, 1);
  await assert.rejects(f.change({ ...input, email: 'different@example.test' }), { status: 409 });
  await assert.rejects(f.change({ ...input, requestKey: crypto.randomUUID(), email: 'other-new@example.test' }), { status: 409 });
  const newer = await f.input({ email: 'newer@example.test' }); await f.change(newer);
  await f.change(input);
  assert.equal((await f.stores.Employee.get('staff')).user_email, 'newer@example.test');
}));

test('only active managers can change accounts; self, removed and independent administrator accounts are protected', () => fixture(async f => {
  const input = await f.input(), staff = await f.stores.Employee.get('staff'), user = await f.stores.User.get('old');
  await assert.rejects(changeEmployeeSignIn({ user, employee: staff, role: 'cashier' }, f.stores, f.db, 'staff', input), { status: 403 });
  await assert.rejects(readEmployeeSignIn({ user: null }, f.stores, 'staff'), { status: 401 });
  await f.stores.User.create({ id: 'gm-second', email: 'second-gm@example.test', role: 'admin' });
  await assert.rejects(f.change(await f.input({ email: 'second-gm@example.test' })), { status: 409 });
  await assert.rejects(f.change(await f.input({ email: 'gm@example.test' })), { status: 409 });
  await f.stores.Employee.update('staff', { user_id: 'gm', user_email: 'gm@example.test' });
  assert.equal((await f.read()).canChange, false);
  await assert.rejects(f.change(await f.input()), /another General Manager/);
  await f.stores.Employee.update('staff', { user_id: 'gm-second', user_email: 'second-gm@example.test' });
  await assert.rejects(f.change(await f.input()), /independent administrator/);
  await f.stores.Employee.update('staff', { user_id: 'old', employee_removed_at: '2026-10-28T00:00:00Z' });
  await assert.rejects(f.change(await f.input()), /Restore/);
  await f.stores.Employee.update('staff', { employee_removed_at: null });
  await f.stores.User.update('gm', { role: 'user' });
  await assert.rejects(f.change(input), { status: 403 });
}));

test('duplicate, already assigned, unchanged and invalid logins make no changes', () => fixture(async f => {
  const baseline = await f.stores.Employee.get('staff');
  for (const email of ['other@example.test', 'old@example.test']) await assert.rejects(f.change(await f.input({ email })));
  await f.stores.User.create({ id: 'dup-a', email: 'duplicate@example.test', role: 'user' });
  await f.stores.User.create({ id: 'dup-b', email: 'DUPLICATE@example.test', role: 'user' });
  await assert.rejects(f.change(await f.input({ email: 'duplicate@example.test' })), { status: 409 });
  for (const patch of [{ email: 'bad' }, { email: 'bad\n@example.test' }, { confirmed: false }, { reason: 'a' }, { user_id: 'forged' }, { role: 'admin' }, { revision: 'bad' }, { requestKey: 'bad' }]) await assert.rejects(f.change(await f.input(patch)));
  assert.deepEqual(await f.stores.Employee.get('staff'), baseline);
  assert.equal((await f.db.unsafe("SELECT count(*)::int AS n FROM public.audit_log WHERE action='change_employee_signin'"))[0].n, 0);
}));

test('invitations and statuses use the new login email, leaving the employee contact address separate', () => fixture(async f => {
  const result = await f.change(await f.input());
  assert.equal((await staffInvitationStatuses(f.context, f.db)).staff.status, 'ready');
  assert.equal((await prepareStaffInvitation(f.context, 'staff', { db: f.db, entities: f.stores })).email, 'new@example.test');
  const sends = [];
  const clerk = { users: { getUserList: async () => ({ data: [] }) }, invitations: { getInvitationList: async () => ({ data: [] }), createInvitation: async args => { sends.push(args); return { id: 'invite-new' }; } } };
  await inviteStaff(f.context, 'staff', { db: f.db, entities: f.stores, transaction: f.transaction, clerk });
  assert.deepEqual(sends, [{ emailAddress: 'new@example.test', notify: true }]);
  assert.equal((await staffInvitationStatuses(f.context, f.db)).staff.status, 'invited');
  assert.equal((await f.stores.Employee.get('staff')).user_id, result.employee.user_id);
  assert.equal((await f.stores.Employee.get('staff')).email, 'contact@example.test');
}));

test('generic edits cannot bypass mapping, confirmation evidence or audit controls', () => fixture(async f => {
  const staff = await f.stores.Employee.get('staff');
  for (const patch of [{ user_id: '' }, { user_id: 'other' }, { user_email: 'forged@example.test' }, { employee_signin_revision: 7 }, { employee_signin_changed_by: 'forged' }]) assert.throws(() => guardMutation(f.context, 'Employee', 'update', patch, staff), { status: 403 });
  assert.doesNotThrow(() => guardMutation(f.context, 'Employee', 'update', { email: 'contact-update@example.test', user_id: 'old', user_email: 'old@example.test' }, staff));
  for (const input of [{ action: 'change_employee_signin' }, { employee_signin_payload: 'fake' }]) assert.throws(() => guardMutation(f.context, 'AuditLog', 'create', input), { status: 403 });
}));

let route;
async function routeModule() {
  if (route) return route;
  const mocks = {
    '@/server/auth': "export const authenticateRequest=async()=>globalThis.__signInRoute.context,checkOrigin=r=>{if(r.headers.get('origin')==='https://other.test')throw Object.assign(Error('Invalid request origin.'),{status:403});},apiError=e=>Response.json({error:e.message},{status:e.status||400});",
    '@/server/entities': "export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__signInRoute.stores[key]});",
    '@/server/db': "export const database=()=>globalThis.__signInRoute.db,transaction=run=>globalThis.__signInRoute.transaction(run);",
  };
  const output = await build({ entryPoints: ['src/app/api/admin/employees/[id]/sign-in/route.js'], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'signin-route', setup(b) {
    b.onResolve({ filter: /^@\/server\// }, args => mocks[args.path] ? { path: args.path, namespace: 'mock-signin' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock-signin' }, args => ({ contents: mocks[args.path] }));
  } }] });
  return route = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
}

test('API validates origin and size; audit failure rolls back the new user and mapping; retry is safe', () => fixture(async f => {
  const handler = await routeModule(); globalThis.__signInRoute = f;
  const params = { params: Promise.resolve({ id: 'staff' }) }, url = 'http://localhost/api/admin/employees/staff/sign-in';
  const post = (input, origin = 'http://localhost') => handler.POST(new Request(url, { method: 'POST', headers: { origin }, body: JSON.stringify(input) }), params);
  try {
    const response = await handler.GET(new Request(url), params); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const baseline = await f.stores.Employee.get('staff'), data = await f.input();
    assert.equal((await post(data, 'https://other.test')).status, 403);
    assert.equal((await post({ padding: 'x'.repeat(4100) })).status, 413);
    f.state.failAudit = true; assert.equal((await post(data)).status, 400);
    assert.deepEqual(await f.stores.Employee.get('staff'), baseline);
    assert.equal((await f.db.unsafe('SELECT count(*)::int AS n FROM public."user" WHERE email=$1', ['new@example.test']))[0].n, 0);
    f.state.failAudit = false; assert.equal((await post(data)).status, 200);
    const retry = await post(data); assert.equal(retry.status, 200); assert.equal((await retry.json()).reused, true);
  } finally { delete globalThis.__signInRoute; }
}));
