import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { insertSnapshot } from '../scripts/migration-lib.mjs';
import { postgresAdapter } from './helpers/postgres-adapter.mjs';
import { flattenRecord } from '../src/server/query.js';
import { inviteStaff, prepareStaffInvitation, staffInvitationStatuses } from '../src/server/staff-invitations.js';
import { linkClerkIdentity, linkedClerkContext } from '../src/server/clerk-identities.js';
import { effectiveRole } from '../src/server/domain/roles.js';
import { assertEntityAccess } from '../src/server/access.js';

async function fixture(run) {
  const database = new PGlite({ parsers: { 1700: Number } });
  try {
    await database.waitReady;
    await database.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    for (const name of ['202610170001_erp_schema.sql', '202610170002_clerk_identities.sql']) await database.exec(await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
    const db = postgresAdapter(database);
    const users = {
      get: async id => flattenRecord((await db.unsafe('SELECT * FROM public."user" WHERE id=$1', [id]))[0]),
      create: async row => { await insertSnapshot(db, { User: [row] }); return users.get(row.id); },
    };
    await users.create({ id: 'gm', email: 'gm@example.test', role: 'admin' });
    await insertSnapshot(db, { Employee: [{ id: 'cashier', full_name: 'Cashier A', email: 'CASHIER@example.test', role: 'cashier', status: 'active', job_title: 'Cashier' }] });
    const employees = {
      get: async id => flattenRecord((await db.unsafe('SELECT * FROM public.employee WHERE id=$1', [id]))[0]),
      update: async (id, changes) => {
        const known = Object.fromEntries(Object.entries(changes).filter(([key]) => ['user_id', 'user_email', 'role', 'status', 'email'].includes(key)));
        for (const [key, value] of Object.entries(known)) await db.unsafe(`UPDATE public.employee SET "${key}"=$1 WHERE id=$2`, [value, id]);
        const extra = Object.fromEntries(Object.entries(changes).filter(([key]) => !Object.hasOwn(known, key)));
        if (Object.keys(extra).length) await db.unsafe('UPDATE public.employee SET extra_data=extra_data || $1::text::jsonb WHERE id=$2', [JSON.stringify(extra), id]);
        return employees.get(id);
      },
    };
    const context = { user: await users.get('gm'), employee: null, role: 'admin' };
    await run({ db, users, employees, context, deps: { db, entities: { Employee: employees, User: users }, transaction: callback => callback() } });
  } finally { await database.close(); }
}

test('General Manager invitation pre-provisions a staff-only login; verified Clerk sign-in receives its current role', () => fixture(async ({ db, users, employees, context, deps }) => {
  const calls = [];
  const clerk = { users: { getUserList: async () => ({ data: [] }) }, invitations: {
    getInvitationList: async () => ({ data: [] }),
    createInvitation: async args => { calls.push(args); return { id: 'inv_cashier' }; },
  } };
  const result = await inviteStaff(context, 'cashier', { ...deps, clerk });
  assert.deepEqual({ status: result.status, email: result.email, role: result.role }, { status: 'invited', email: 'cashier@example.test', role: 'cashier' });
  assert.deepEqual(calls, [{ emailAddress: 'cashier@example.test', notify: true }], 'no Clerk metadata may grant a role');
  const employee = await employees.get('cashier'), profile = await users.get(employee.user_id);
  assert.equal(profile.role, 'user'); assert.equal(profile.email, 'cashier@example.test');
  assert.equal(employee.invitation_id, 'inv_cashier');
  assert.equal(employee.invited_email, 'cashier@example.test');
  assert.equal((await staffInvitationStatuses(context, db)).cashier.status, 'invited');
  await linkClerkIdentity(db, users, { subject: 'clerk_cashier', email: 'cashier@example.test', fullName: 'Cashier A' });
  const signedIn = await linkedClerkContext(db, 'clerk_cashier');
  assert.equal(signedIn.employee.id, 'cashier'); assert.equal(effectiveRole(signedIn.user, signedIn.employee), 'cashier');
  assert.equal(assertEntityAccess(signedIn, 'TreasuryAccount', 'list'), 'cashier');
  assert.throws(() => assertEntityAccess(signedIn, 'PayrollRun', 'list'));
  assert.equal((await staffInvitationStatuses(context, db)).cashier.status, 'linked');
  await employees.update('cashier', { role: 'driver' });
  const changed = await linkedClerkContext(db, 'clerk_cashier');
  assert.equal(effectiveRole(changed.user, changed.employee), 'driver');
  assert.throws(() => assertEntityAccess(changed, 'TreasuryAccount', 'list'));
  await employees.update('cashier', { status: 'suspended' });
  const suspended = await linkedClerkContext(db, 'clerk_cashier');
  assert.throws(() => assertEntityAccess(suspended, 'Employee', 'list'), /not active/);
}));

test('only an active GM can invite; duplicate links and mismatched emails cannot grant a second employee access', () => fixture(async ({ db, users, employees, context, deps }) => {
  const nonAdmin = { user: { id: 'staff', role: 'user' }, employee: { id: 'staff', role: 'production_manager', status: 'active' }, role: 'production_manager' };
  await assert.rejects(() => prepareStaffInvitation(nonAdmin, 'cashier', deps), /General Manager/);
  assert.equal((await db.unsafe('SELECT count(*)::int AS n FROM public."user"'))[0].n, 1);
  await assert.rejects(() => staffInvitationStatuses(nonAdmin, db), /General Manager/);
  await prepareStaffInvitation(context, 'cashier', deps);
  const profile = await users.get((await employees.get('cashier')).user_id);
  await insertSnapshot(db, { Employee: [{ id: 'other', full_name: 'Other', role: 'driver', job_title: 'Driver', status: 'active', email: 'cashier@example.test' }] });
  await assert.rejects(() => prepareStaffInvitation(context, 'other', deps), /already assigned/);
  await employees.update('cashier', { email: 'changed@example.test' });
  await assert.rejects(() => prepareStaffInvitation(context, 'cashier', deps), /different email/);
  assert.equal((await users.get(profile.id)).role, 'user');
  await employees.update('cashier', { status: 'suspended' });
  await assert.rejects(() => prepareStaffInvitation(context, 'cashier', deps), /Activate/);
}));

test('pending invitations are not sent twice and an existing Clerk account can use the saved staff assignment', () => fixture(async ({ db, employees, context, deps }) => {
  let sends = 0;
  const clerk = { users: { getUserList: async () => ({ data: [] }) }, invitations: {
    getInvitationList: async () => ({ data: [{ emailAddress: 'cashier@example.test' }] }),
    createInvitation: async () => { sends++; return { id: 'new' }; },
  } };
  assert.equal((await inviteStaff(context, 'cashier', { ...deps, clerk })).status, 'pending');
  assert.equal(sends, 0);
  assert.equal((await staffInvitationStatuses(context, db)).cashier.status, 'invited');
  clerk.users.getUserList = async () => ({ data: [{ emailAddresses: [{ emailAddress: 'cashier@example.test' }] }] });
  assert.equal((await inviteStaff(context, 'cashier', { ...deps, clerk })).status, 'existing_account');
  assert.equal((await employees.get('cashier')).user_id !== '', true);
  assert.equal((await db.unsafe('SELECT count(*)::int AS n FROM public."user"'))[0].n, 2);
}));
