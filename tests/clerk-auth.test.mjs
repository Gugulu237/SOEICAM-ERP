import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { verifiedClerkIdentity, linkClerkIdentity, linkedClerkContext, authenticateClerkSession } from '../src/server/clerk-identities.js';
import { effectiveRole } from '../src/server/domain/roles.js';
import { assertEntityAccess, guardMutation } from '../src/server/access.js';
import { insertSnapshot } from '../scripts/migration-lib.mjs';
import { flattenRecord } from '../src/server/query.js';
import { postgresAdapter } from './helpers/postgres-adapter.mjs';

const clerkUser = (overrides = {}) => ({ id:'user_clerk_one', primaryEmailAddressId:'primary', emailAddresses:[{ id:'primary', emailAddress:'GM@Example.test', verification:{ status:'verified' } }], firstName:'General', lastName:'Manager', ...overrides });
test('Clerk identities require the authenticated subject and verified primary email; client role metadata is ignored', () => {
  const identity = verifiedClerkIdentity('user_clerk_one', clerkUser({ publicMetadata:{ role:'admin' }, unsafeMetadata:{ role:'admin' } }));
  assert.deepEqual(identity, { subject:'user_clerk_one', email:'gm@example.test', fullName:'General Manager' });
  assert.throws(() => verifiedClerkIdentity(null, clerkUser()), error => error.status === 401);
  assert.throws(() => verifiedClerkIdentity('another-subject', clerkUser()), error => error.status === 401);
  for (const user of [clerkUser({ banned:true }), clerkUser({ locked:true }), clerkUser({ emailAddresses:[{ id:'primary', emailAddress:'gm@example.test', verification:{ status:'unverified' } }] }), clerkUser({ primaryEmailAddressId:'missing' })]) {
    assert.throws(() => verifiedClerkIdentity(user.id, user), error => error.status === 403);
  }
});

async function withIdentityDatabase(run) {
  const db = new PGlite({ parsers:{ 1700:Number } });
  try {
    await db.waitReady;
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    for (const name of ['202610170001_erp_schema.sql','202610170002_clerk_identities.sql']) {
      await db.exec(await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
    }
    const tx = postgresAdapter(db);
    const users = {
      get:async id => flattenRecord((await tx.unsafe('SELECT * FROM public."user" WHERE id=$1', [id]))[0]),
      create:async row => { await insertSnapshot(tx, { User:[row] }); return users.get(row.id); },
    };
    await users.create({ id:'imported-gm', email:'gm@example.test', role:'admin', auth_user_id:'existing-supabase-identity' });
    await insertSnapshot(tx, { Employee:[{ id:'employee-gm', user_id:'imported-gm', role:'admin', status:'active' }] });
    await run({ db, tx, users });
  } finally { await db.close(); }
}

test('Clerk sign-in links the imported administrator without changing IDs, Supabase links, employees or roles', async () => {
  await withIdentityDatabase(async ({ tx, users }) => {
    const identity = verifiedClerkIdentity('user_clerk_one', clerkUser());
    const profile = await linkClerkIdentity(tx, users, identity);
    assert.equal(profile.id, 'imported-gm');
    assert.equal(profile.auth_user_id, 'existing-supabase-identity');
    assert.equal(effectiveRole(profile, null), 'admin');
    const [employee] = await tx.unsafe('SELECT * FROM public.employee WHERE user_id=$1', [profile.id]);
    assert.equal(employee.id, 'employee-gm');
    assert.equal((await linkClerkIdentity(tx, users, { ...identity, email:'changed@example.test' })).id, profile.id);
    assert.equal((await tx.unsafe('SELECT count(*)::int AS n FROM public."user"'))[0].n, 1);
    assert.equal((await tx.unsafe('SELECT count(*)::int AS n FROM erp_private.auth_identities'))[0].n, 1);
  });
});

test('existing Clerk bindings read fresh ERP roles without identity write locks or data changes', async () => {
  await withIdentityDatabase(async ({ tx, users }) => {
    const identity = verifiedClerkIdentity('user_clerk_one', clerkUser());
    assert.equal(await linkedClerkContext(tx, identity.subject), null);
    await linkClerkIdentity(tx, users, identity);
    let queries = 0;
    const readOnly = { unsafe: async (sql, args) => { queries++; assert.match(sql.trim(), /^SELECT/); assert.doesNotMatch(sql, /pg_advisory|UPDATE|INSERT/); return tx.unsafe(sql, args); } };
    const initial = await linkedClerkContext(readOnly, identity.subject);
    assert.equal(initial.user.role, 'admin'); assert.equal(initial.employee.id, 'employee-gm'); assert.equal(queries, 1, 'binding, user and employee take one database round trip');
    await tx.unsafe('UPDATE public."user" SET role=$1 WHERE id=$2', ['user', 'imported-gm']);
    await tx.unsafe('UPDATE public.employee SET role=$1, status=$2, extra_data=$3::text::jsonb WHERE id=$4', ['cashier', 'suspended', '{"test_extension":"preserved"}', 'employee-gm']);
    const changed = await linkedClerkContext(readOnly, identity.subject);
    assert.equal(changed.user.role, 'user', 'privilege changes are not cached');
    assert.equal(changed.employee.role, 'cashier'); assert.equal(changed.employee.status, 'suspended');
    assert.equal(changed.employee.test_extension, 'preserved', 'joined JSON rows retain flattened extra fields');
    assert.throws(() => assertEntityAccess(changed, 'Invoice', 'list'), /not active/);
    assert.equal(queries, 2);
  });
});

test('bound Clerk requests verify each SDK session and avoid Backend API user calls', async () => {
  await withIdentityDatabase(async ({ tx, users }) => {
    await linkClerkIdentity(tx, users, verifiedClerkIdentity('user_clerk_one', clerkUser()));
    let sessionChecks = 0, databaseQueries = 0;
    const deps = {
      auth:async () => { sessionChecks++; return { userId:'user_clerk_one', isAuthenticated:true }; },
      currentUser:async () => { assert.fail('bound requests must not call the Clerk Backend API'); },
      readLinkedContext:subject => linkedClerkContext({ unsafe:async (...args) => { databaseQueries++; return tx.unsafe(...args); } }, subject),
      linkIdentity:async () => { assert.fail('bound identities must never be rematched by email'); },
    };
    const first = await authenticateClerkSession(deps);
    assert.equal(first.user.id, 'imported-gm'); assert.equal(first.employee.id, 'employee-gm'); assert.equal(first.authUserId, 'user_clerk_one');
    await tx.unsafe('UPDATE public."user" SET role=$1 WHERE id=$2', ['user', 'imported-gm']);
    await tx.unsafe('UPDATE public.employee SET role=$1 WHERE id=$2', ['driver', 'employee-gm']);
    const second = await authenticateClerkSession(deps);
    assert.equal(effectiveRole(second.user,second.employee), 'driver', 'rights remain authoritative on every request');
    assert.equal(sessionChecks, 2); assert.equal(databaseQueries, 2);
    for (const session of [null, { userId:null }, { userId:'user_clerk_one', isAuthenticated:false }, { userId:'user_clerk_one', sessionStatus:'pending' }]) {
      await assert.rejects(() => authenticateClerkSession({ ...deps, auth:async () => session }), error => error.status === 401);
    }
    assert.equal(databaseQueries, 2, 'unsigned or pending sessions cannot reach ERP identity lookup');
  });
});

test('first Clerk sign-in verifies its primary email before linking and retains ERP identity', async () => {
  await withIdentityDatabase(async ({ tx, users }) => {
    let backendCalls = 0, links = 0;
    const deps = {
      auth:async () => ({ userId:'user_clerk_one', isAuthenticated:true }),
      currentUser:async () => { backendCalls++; return clerkUser(); },
      readLinkedContext:subject => linkedClerkContext(tx, subject),
      linkIdentity:async identity => { links++; return linkClerkIdentity(tx, users, identity); },
    };
    const context = await authenticateClerkSession(deps);
    assert.equal(context.user.id, 'imported-gm'); assert.equal(context.user.role, 'admin');
    assert.equal(context.user.auth_user_id, 'existing-supabase-identity'); assert.equal(context.employee.id, 'employee-gm');
    assert.equal(backendCalls, 1); assert.equal(links, 1);
    await authenticateClerkSession(deps);
    assert.equal(backendCalls, 1); assert.equal(links, 1, 'subsequent requests use only the existing binding');
    for (const user of [clerkUser({ id:'wrong-subject' }), clerkUser({ banned:true }), clerkUser({ locked:true }), clerkUser({ emailAddresses:[] })]) {
      await assert.rejects(() => authenticateClerkSession({ ...deps, readLinkedContext:async () => null, currentUser:async () => user }), error => [401,403].includes(error.status));
    }
    assert.equal(links, 1, 'unverified or inactive identities never enter linking');
  });
});

test('Clerk context rejects missing linked profiles and duplicate employee assignments', async () => {
  await assert.rejects(() => linkedClerkContext({ unsafe:async () => [{ profile:null, employees:[] }] }, 'subject'), error => error.status === 409 && /missing/.test(error.message));
  await withIdentityDatabase(async ({ tx, users }) => {
    await linkClerkIdentity(tx, users, verifiedClerkIdentity('user_clerk_one', clerkUser()));
    await insertSnapshot(tx, { Employee:[{ id:'duplicate-employee', user_id:'imported-gm', role:'driver', status:'active' }] });
    await assert.rejects(() => linkedClerkContext(tx, 'user_clerk_one'), error => error.status === 409 && /more than one employee/.test(error.message));
  });
});

test('new Clerk sign-ups have no staff access until the General Manager assigns their ERP role', async () => {
  await withIdentityDatabase(async ({ tx, users }) => {
    const profile = await linkClerkIdentity(tx, users, { subject:'user_clerk_staff', email:'cashier@example.test', fullName:'Cashier', role:'admin' });
    assert.equal(profile.role, 'user');
    assert.equal(profile.auth_user_id, null);
    assert.equal((await linkClerkIdentity(tx, users, { subject:'user_clerk_staff', email:'gm@example.test', fullName:'Changed' })).id, profile.id, 'changing a verified email cannot switch an already-linked ERP identity');
    assert.throws(() => assertEntityAccess({ user:profile, employee:null }, 'Invoice', 'list'), /active linked staff/);
    assert.throws(() => guardMutation({ user:profile, employee:{ id:'staff', role:'cashier', status:'active' }, role:'cashier' }, 'Employee', 'update', { role:'admin' }));
    const employee = { id:'cashier-employee', user_id:profile.id, role:'cashier', status:'active' };
    assert.equal(assertEntityAccess({ user:profile, employee }, 'Invoice', 'list'), 'cashier');
    assert.throws(() => assertEntityAccess({ user:profile, employee:{ ...employee, status:'suspended' } }, 'Invoice', 'list'));
    const admin = { user:await users.get('imported-gm'), employee:null };
    assert.doesNotThrow(() => guardMutation(admin, 'Employee', 'update', { role:'admin' }));
    assert.equal(effectiveRole(profile, { ...employee, role:'admin' }), 'admin');
    assert.throws(() => assertEntityAccess({ user:profile, employee:{ ...employee, role:'admin', status:'suspended' } }, 'User', 'list'), /not active/);
  });
});

test('duplicate emails and already-bound ERP profiles cannot be claimed by another Clerk identity', async () => {
  await withIdentityDatabase(async ({ tx, users }) => {
    const identity = { subject:'user_clerk_one', email:'gm@example.test', fullName:'GM' };
    await linkClerkIdentity(tx, users, identity);
    await assert.rejects(() => linkClerkIdentity(tx, users, { ...identity, subject:'user_clerk_attacker' }), error => error.status === 403);
    await users.create({ id:'duplicate-1', email:'duplicate@example.test', role:'user' });
    await users.create({ id:'duplicate-2', email:'DUPLICATE@example.test', role:'user' });
    await assert.rejects(() => linkClerkIdentity(tx, users, { ...identity, email:'duplicate@example.test', subject:'user_clerk_duplicate' }), error => error.status === 409);
    const [grants] = await tx.unsafe("SELECT has_table_privilege('authenticated','erp_private.auth_identities','SELECT') AS allowed");
    assert.equal(grants.allowed, false);
  });
});
