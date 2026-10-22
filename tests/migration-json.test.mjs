import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { catalog, identifier, insertSnapshot, normalizedRecord, recordHash, canonical, sha256, controls } from '../scripts/migration-lib.mjs';
import { planJsonRepair, applyJsonRepair } from '../scripts/repair-json-lib.mjs';
import { flattenRecord, whereClause } from '../src/server/query.js';
import { postgresAdapter } from './helpers/postgres-adapter.mjs';

async function fixture(run, { legacy = true } = {}) {
  const db = new PGlite({ parsers: { 1700: Number } });
  try {
    await db.waitReady;
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    await db.exec(await readFile(new URL('../supabase/migrations/202610170001_erp_schema.sql', import.meta.url), 'utf8'));
    const tx = postgresAdapter(db);
    const tables = Object.fromEntries(Object.keys(catalog).map(name => [name, [{ id: 'legacy-' + name, custom_import_field: { nested: ['retain', 42], literal: '{"keep":"text"}' } }]]));
    Object.assign(tables.Account[0], { balance: 12.5, is_active: true, is_system: false });
    Object.assign(tables.Employee[0], { role: 'commercial', user_id: 'legacy-User' });
    Object.assign(tables.CustomerLocation[0], { assigned_hotesse_ids: ['staff-1'] });
    Object.assign(tables.Product[0], { name: 'Fixture', image_url: 'https://source.example.test/image.png', components: [{ product_id: 'component-1', quantity: 3 }] });
    Object.assign(tables.Payment[0], { receipt_posting_snapshot: { lines: [{ amount: 500 }] } });
    Object.assign(tables.User[0], { email: 'staff@example.test', role: 'admin' });
    tables.DriverActivity = []; tables.OutletVisit = [];
    const manifest = { tables: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, { count: rows.length, source_status: rows.length ? 'present' : 'schema_absent' }])), attachments: [{ id: 'file-1', uri: tables.Product[0].image_url, private: false, references: [{ entity: 'Product', id: 'legacy-Product', field: 'image_url' }] }] };
    const runId = sha256(JSON.stringify(canonical(manifest)));
    const report = { mode: 'apply', tables: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])), new_empty_tables: ['DriverActivity', 'OutletVisit'], controls: controls(tables), files_pending: 1 };
    // The previous writer passed JSON strings to parameters PostgreSQL typed as JSONB.
    const writer = legacy ? { unsafe: (query, params) => tx.unsafe(query.replaceAll('::text::jsonb', '::jsonb'), params) } : tx;
    await insertSnapshot(writer, tables);
    const cast = legacy ? '::jsonb' : '::text::jsonb';
    await tx.unsafe(`INSERT INTO erp_private.migration_runs(id,manifest,report,completed_at) VALUES ($1,$2${cast},$3${cast},now())`, [runId, JSON.stringify(manifest), JSON.stringify(report)]);
    await tx.unsafe(`INSERT INTO erp_private.files(id,bucket,object_key,owner_id,original_name,content_type,size,access_roles,legacy_uri) VALUES ('file-1','soeicam-public','migrated/file-1','legacy-User','image.png','image/png',1,$1${cast},$2)`, [JSON.stringify(['admin']), tables.Product[0].image_url]);
    const supabaseUrl = 'https://target.example.test';
    await tx.unsafe('UPDATE public.product SET image_url=$1', [supabaseUrl + '/storage/v1/object/public/soeicam-public/migrated/file-1']);
    await tx.unsafe('UPDATE public."user" SET auth_user_id=$1', ['legitimate-auth-link']);
    await run({ db, tx, snapshot: { manifest, tables }, supabaseUrl });
  } finally { await db.close(); }
}

test('Postgres.js reproduces double JSON encoding and the corrected importer preserves objects and arrays', async () => {
  await fixture(async ({ tx, snapshot, supabaseUrl }) => {
    const [row] = await tx.unsafe('SELECT extra_data,assigned_hotesse_ids FROM public.customer_location');
    assert.equal(typeof row.extra_data, 'object');
    assert.deepEqual(row.assigned_hotesse_ids, ['staff-1']);
    assert.equal(row.extra_data.custom_import_field.literal, '{"keep":"text"}');
    const plan = await planJsonRepair(tx, snapshot, { supabaseUrl });
    assert.equal(plan.updates.length, 0);
    const params = [];
    const where = whereClause({ assigned_hotesse_ids: { $in: ['staff-1'] } }, catalog.CustomerLocation, params);
    assert.equal((await tx.unsafe('SELECT id FROM public.customer_location WHERE ' + where, params)).length, 1);
  }, { legacy: false });
});

test('repair previews without writes, restores all tables and file roles, preserves links, and is idempotent', async () => {
  await fixture(async ({ db, tx, snapshot, supabaseUrl }) => {
    const [broken] = await tx.unsafe('SELECT extra_data,assigned_hotesse_ids FROM public.customer_location');
    assert.equal(typeof broken.extra_data, 'string');
    assert.equal(typeof broken.assigned_hotesse_ids, 'string');
    const plan = await planJsonRepair(tx, snapshot, { supabaseUrl });
    assert.ok(plan.updates.length > 54);
    assert.equal(typeof (await tx.unsafe('SELECT extra_data FROM public.employee'))[0].extra_data, 'string');
    await db.exec('BEGIN'); await applyJsonRepair(tx, plan); await db.exec('COMMIT');
    const after = await planJsonRepair(tx, snapshot, { supabaseUrl });
    assert.equal(after.updates.length, 0);
    assert.equal((await tx.unsafe('SELECT auth_user_id FROM public."user"'))[0].auth_user_id, 'legitimate-auth-link');
    assert.deepEqual((await tx.unsafe('SELECT access_roles FROM erp_private.files'))[0].access_roles, ['admin']);
    for (const [name, schema] of Object.entries(catalog)) {
      const actual = (await tx.unsafe(`SELECT * FROM public.${identifier(schema.table)}`)).map(flattenRecord);
      const expected = snapshot.tables[name].map(row => normalizedRecord(row, schema));
      if (name === 'User') actual.forEach(row => { row.auth_user_id = null; });
      if (name === 'Product') expected[0].image_url = supabaseUrl + '/storage/v1/object/public/soeicam-public/migrated/file-1';
      assert.equal(recordHash(actual), recordHash(expected), name);
    }
  });
});

test('repair refuses changed business fields, encoded JSON values, IDs and file permissions', async () => {
  await fixture(async ({ db, tx, snapshot, supabaseUrl }) => {
    for (const mutation of [
      "UPDATE public.account SET balance=999",
      "UPDATE public.customer_location SET assigned_hotesse_ids=to_jsonb('[\"different-staff\"]'::text)",
      "UPDATE public.account SET id='different-id'",
      "UPDATE erp_private.files SET access_roles=to_jsonb('[\"admin\",\"driver\"]'::text)",
      "UPDATE public.employee SET extra_data=to_jsonb('not-json'::text)",
    ]) {
      await db.exec('BEGIN');
      await db.exec(mutation);
      await assert.rejects(() => planJsonRepair(tx, snapshot, { supabaseUrl }), /repair refused/);
      await db.exec('ROLLBACK');
    }
    assert.equal(typeof (await tx.unsafe('SELECT extra_data FROM public.account'))[0].extra_data, 'string');
  });
});

test('repair detects changed values at update time and rolls back earlier updates in the transaction', async () => {
  await fixture(async ({ db, tx, snapshot, supabaseUrl }) => {
    const plan = await planJsonRepair(tx, snapshot, { supabaseUrl });
    await db.exec('BEGIN');
    // Simulate a stale plan: the UPDATE must still check its original value.
    await db.exec("UPDATE public.employee SET extra_data='{}'::jsonb");
    await assert.rejects(() => applyJsonRepair(tx, plan), /changed during JSON repair/);
    await db.exec('ROLLBACK');
    assert.equal(typeof (await tx.unsafe('SELECT manifest FROM erp_private.migration_runs'))[0].manifest, 'string');
    assert.equal(typeof (await tx.unsafe('SELECT extra_data FROM public.account'))[0].extra_data, 'string');
  });
});
