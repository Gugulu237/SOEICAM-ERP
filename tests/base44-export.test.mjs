import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readSourceTable, assertSourceTableStable, validateSourceTableEntry, safeExportError } from '../scripts/base44-export-lib.mjs';
import { readSnapshot } from '../scripts/migration-lib.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const missing = (name, status = 404) => Object.assign(new Error(`Entity schema ${name} not found in app`), { status, data: { message: `Entity schema ${name} not found in app` } });
const client = filter => ({ entities: new Proxy({}, { get: (_, name) => ({ filter: (query, options) => filter(name, options) }) }) });
const userClient = list => ({ entities: { User: { list, filter: () => { throw new Error('User must not use cursor pagination'); } } } });

test('users use offset pagination through a final empty page and preserve identity and custom fields', async () => {
  const users = [
    { id: 'user-1', email: 'manager@example.test', role: 'admin', full_name: 'Manager', custom: { department: 'Operations' } },
    { id: 'user-2', email: 'agent@example.test', role: 'user', created_date: '2026-10-01T00:00:00Z' },
    { id: 'user-3', email: 'driver@example.test', role: 'user' },
  ];
  const calls = [];
  const result = await readSourceTable(userClient((...args) => {
    calls.push(args);
    // Simulate the service returning fewer records than the requested limit.
    return users.slice(args[2], args[2] + 2);
  }), 'User');
  assert.deepEqual(calls, [['id', 500, 0], ['id', 500, 2], ['id', 500, 3]]);
  assert.deepEqual(JSON.parse(result.content), users);
  assert.equal(result.source_status, 'present');
  assert.equal((await readSourceTable(userClient(() => []), 'User')).content, '[]\n');
});

test('user pagination rejects malformed responses, repeated pages, missing IDs and access failures', async () => {
  for (const response of [null, { items: [], has_more: false }]) {
    await assert.rejects(() => readSourceTable(userClient(() => response), 'User'), /app-user array/);
  }
  await assert.rejects(() => readSourceTable(userClient(() => [{ id: 'repeated' }]), 'User'), /repeated/);
  await assert.rejects(() => readSourceTable(userClient(() => [{ email: 'missing-id@example.test' }]), 'User'), /missing record ID/);
  for (const status of [400, 403, 404, 500]) {
    const error = missing('User', status);
    await assert.rejects(() => readSourceTable(userClient(() => { throw error; }), 'User'), caught => caught === error);
    await assert.rejects(() => readSourceTable(userClient((sort, limit, skip) => {
      if (skip) throw error;
      return [{ id: 'first-user' }];
    }), 'User'), caught => caught === error);
  }
});

test('new reporting schemas require an exact missing-schema response', async () => {
  for (const name of ['DriverActivity', 'OutletVisit']) {
    const result = await readSourceTable(client(() => { throw missing(name); }), name);
    assert.equal(result.source_status, 'schema_absent');
    assert.equal(result.content, '[]\n');
    assert.equal(result.source_evidence.status, 404);
  }
  for (const error of [missing('DriverActivity', 403), missing('DriverActivity', 500), missing('AnotherEntity'), Object.assign(new Error('Not found'), { status: 404 }), Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })]) {
    await assert.rejects(() => readSourceTable(client(() => { throw error; }), 'DriverActivity'), caught => caught === error);
  }
  const error = missing('Customer');
  await assert.rejects(() => readSourceTable(client(() => { throw error; }), 'Customer'), caught => caught === error);
});

test('export preserves every page and unknown fields, and never substitutes a missing later page', async () => {
  const calls = [];
  const api = client((name, options) => {
    calls.push(options.cursor);
    return options.cursor ? { items: [{ id: 'a', custom: { preserved: true } }], has_more: false, total: 2 }
      : { items: [{ id: 'z', amount: 12 }], has_more: true, next_cursor: 'page-2' };
  });
  const result = await readSourceTable(api, 'Customer');
  assert.deepEqual(calls, [undefined, 'page-2']);
  assert.deepEqual(JSON.parse(result.content), [{ custom: { preserved: true }, id: 'a' }, { amount: 12, id: 'z' }]);
  await assert.rejects(() => readSourceTable(client((name, options) => {
    if (options.cursor) throw missing(name);
    return { items: [{ id: 'existing' }], has_more: true, next_cursor: 'next' };
  }), 'DriverActivity'), /not found/);
});

test('incomplete pagination, duplicate IDs, total mismatches and repeated cursors are rejected', async () => {
  await assert.rejects(() => readSourceTable(client(() => ({ items: [] })), 'Customer'), /paginated response/);
  await assert.rejects(() => readSourceTable(client(() => ({ items: [{ id: 'one' }, { id: 'one' }], has_more: false })), 'Customer'), /repeated/);
  await assert.rejects(() => readSourceTable(client(() => ({ items: [], has_more: false, total: 1 })), 'Customer'), /total count/);
  await assert.rejects(() => readSourceTable(client(() => ({ items: [], has_more: true, next_cursor: 'same' })), 'Customer'), /repeated cursor/);
});

test('verification detects schema appearance/disappearance even when both snapshots are empty', () => {
  const entry = { source_status: 'schema_absent', sha256: hash('[]\n') };
  assert.doesNotThrow(() => assertSourceTableStable('DriverActivity', entry, { source_status: 'schema_absent', content: '[]\n' }));
  assert.throws(() => assertSourceTableStable('DriverActivity', entry, { source_status: 'present', content: '[]\n' }), /changed/);
  assert.throws(() => assertSourceTableStable('Customer', { ...entry, source_status: 'present' }, { source_status: 'schema_absent', content: '[]\n' }), /changed/);
  assert.throws(() => assertSourceTableStable('Customer', { ...entry, source_status: 'present' }, { source_status: 'present', content: '[{"id":"added"}]\n' }), /changed/);
});

test('import accepts only twice-verified empty new schemas, preserving strict core-table validation', () => {
  const entry = { source_status: 'schema_absent', count: 0, source_evidence: { status: 404, message: 'Entity schema DriverActivity not found in app', verified_twice: true } };
  assert.doesNotThrow(() => validateSourceTableEntry('DriverActivity', entry));
  assert.doesNotThrow(() => validateSourceTableEntry('Customer', { status: 'complete' }));
  assert.throws(() => validateSourceTableEntry('Customer', entry), /refusing partial/);
  assert.throws(() => validateSourceTableEntry('DriverActivity', { ...entry, count: 1 }), /refusing partial/);
  assert.throws(() => validateSourceTableEntry('DriverActivity', { ...entry, source_evidence: { ...entry.source_evidence, verified_twice: false } }), /refusing partial/);
});

test('SDK failures cannot expose authorization objects or credentials through error messages', () => {
  const error = Object.assign(new Error('Bearer secret-value'), { status: 403, data: { message: 'Bearer secret-value' }, originalError: { config: { headers: { Authorization: 'Bearer secret-value' } } } });
  assert.equal(safeExportError(error), 'Base44 request failed (HTTP 403). Check source access or service availability, then retry.');
  assert.equal(safeExportError(missing('Customer')), 'Entity schema Customer not found in app');
  const text = safeExportError(new Error('Bearer secret-value eyJtest.payload.signature sb_secret_fixture postgresql://user:password@host/db'));
  for (const credential of ['secret-value', 'eyJtest', 'sb_secret_fixture', 'password']) assert.ok(!text.includes(credential));
});

const run = promisify(execFile);
const harness = String.raw`
  import { pathToFileURL } from 'node:url';
  const [directory, script, mode] = process.argv.slice(1);
  globalThis.Deno = { cwd: () => directory, env: { get: key => ({ BASE44_PRIVILEGED: 'true', BASE44_APP_ID: '6a5164141d12cb92ecfede16', BASE44_DATA_ENV: 'prod' })[key] }, exit: code => process.exit(code) };
  let userReads = 0;
  globalThis.base44 = { entities: new Proxy({}, { get: (_, name) => ({ list: async (sort, limit, skip) => {
    if (name !== 'User' || sort !== 'id' || limit !== 500 || !Number.isInteger(skip)) throw new Error('Unexpected user list request');
    if (mode === 'user-failure') throw Object.assign(new Error('User access denied'), { status: 403 });
    if (skip) return [];
    userReads++;
    return [{ id: 'user-1', email: 'manager@example.test', role: mode === 'user-changed' && userReads > 1 ? 'user' : 'admin', custom_import_field: { keep: true } }];
  }, filter: async () => {
    if (name === 'User') throw Object.assign(new Error('Not available for the User entity; use the app users endpoints'), { status: 400 });
    if (mode === 'failure' && name === 'Customer') throw Object.assign(new Error('Bearer fixture-private-token'), { status: 403, data: { message: 'Bearer fixture-private-token' }, originalError: { config: { headers: { Authorization: 'Bearer fixture-private-token' } } } });
    if (['DriverActivity', 'OutletVisit'].includes(name)) throw Object.assign(new Error('Entity schema '+name+' not found in app'), { status: 404 });
    const fixtures = { Customer: [{ id: 'customer-1', name: 'Fixture', custom_import_field: { keep: true } }], Employee: [{ id: 'employee-1', user_id: 'user-1' }] };
    return { items: fixtures[name] || [], has_more: false };
  } }) }) };
  await import(pathToFileURL(script).href);
`;

async function withExportFixture(mode, check) {
  const root = await mkdtemp(path.join(tmpdir(), 'soeicam-export-test-'));
  try {
    await mkdir(path.join(root, 'scripts'), { recursive: true });
    await mkdir(path.join(root, 'src/server/generated'), { recursive: true });
    await copyFile(new URL('../scripts/base44-export-lib.mjs', import.meta.url), path.join(root, 'scripts/base44-export-lib.mjs'));
    await copyFile(new URL('../src/server/generated/schema.json', import.meta.url), path.join(root, 'src/server/generated/schema.json'));
    let result;
    try {
      result = await run(process.execPath, ['--input-type=module', '--eval', harness, root, fileURLToPath(new URL('../scripts/export-base44.ts', import.meta.url)), mode]);
      result.code = 0;
    } catch (error) { result = error; }
    const [folder] = await readdir(path.join(root, 'exports'));
    await check(result, path.join(root, 'exports', folder));
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe cleanup path');
    await rm(root, { recursive: true, force: true });
  }
}

test('complete exporter writes a valid 56-table snapshot with explicit new empty schemas', async () => {
  await withExportFixture('success', async (result, directory) => {
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Export verified:/);
    const { manifest, tables } = await readSnapshot(directory);
    assert.equal(Object.keys(tables).length, 56);
    assert.deepEqual(tables.Customer[0].custom_import_field, { keep: true });
    assert.deepEqual(tables.User, [{ id: 'user-1', email: 'manager@example.test', role: 'admin', custom_import_field: { keep: true } }]);
    assert.equal(tables.Employee[0].user_id, tables.User[0].id);
    assert.equal(manifest.tables.User.count, 1);
    assert.equal(manifest.tables.DriverActivity.source_evidence.verified_twice, true);
    assert.equal(manifest.tables.OutletVisit.source_evidence.verified_twice, true);
    assert.deepEqual(tables.DriverActivity, []);
  });
});

test('user access failures and changes between reads never produce an importable snapshot', async () => {
  for (const mode of ['user-failure', 'user-changed']) {
    await withExportFixture(mode, async (result, directory) => {
      assert.equal(result.code, 1);
      assert.match(result.stderr, mode === 'user-failure' ? /HTTP 403/ : /User changed during export/);
      assert.ok(!(await readdir(directory)).includes('manifest.json'));
      const manifest = JSON.parse(await readFile(path.join(directory, 'incomplete-manifest.json'), 'utf8'));
      assert.equal(manifest.verified_stable, false);
    });
  }
});

test('failed exporter writes only an incomplete snapshot and emits no request credentials', async () => {
  await withExportFixture('failure', async (result, directory) => {
    assert.equal(result.code, 1);
    assert.match(result.stderr, /HTTP 403/);
    assert.ok(!result.stderr.includes('fixture-private-token'));
    assert.ok(!result.stdout.includes('fixture-private-token'));
    assert.ok(!(await readdir(directory)).includes('manifest.json'));
    const incomplete = await readFile(path.join(directory, 'incomplete-manifest.json'), 'utf8');
    assert.ok(!incomplete.includes('fixture-private-token'));
    assert.equal(JSON.parse(incomplete).verified_stable, false);
  });
});
