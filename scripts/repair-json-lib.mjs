import { catalog, identifier, normalizedRecord, recordHash, canonical, sha256, controls } from './migration-lib.mjs';
import { flattenRecord } from '../src/server/query.js';

const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function decodeContainer(value, type, label) {
  let decoded = value;
  if (typeof value === 'string') {
    try { decoded = JSON.parse(value); }
    catch { throw new Error(`${label}: invalid encoded JSON; repair refused.`); }
  }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded) !== (type === 'array')) {
    throw new Error(`${label}: unexpected JSON shape; repair refused.`);
  }
  return decoded;
}

// Build a complete repair plan before issuing any UPDATE. Only a single JSON
// encoding layer is removed, and every resulting business record must match
// the verified source snapshot (including the already migrated public URLs).
export async function planJsonRepair(tx, { manifest, tables }, { supabaseUrl } = {}) {
  const updates = [], tableCounts = {};
  const planField = (table, row, field, type) => {
    if (row[field] == null && field !== 'extra_data') return;
    const decoded = decodeContainer(row[field], type, `${table}.${field}`);
    if (typeof row[field] === 'string') {
      updates.push({ table, id: row.id, field, before: row[field], after: decoded });
      row[field] = decoded;
    }
  };
  const runId = sha256(JSON.stringify(canonical(manifest)));
  const [run] = await tx.unsafe('SELECT id,manifest,report,completed_at FROM erp_private.migration_runs WHERE id=$1', [runId]);
  if (!run?.completed_at) throw new Error('This snapshot has no completed import; repair refused.');
  planField('erp_private.migration_runs', run, 'manifest', 'object');
  planField('erp_private.migration_runs', run, 'report', 'object');
  const expectedReport = {
    mode: 'apply', tables: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
    new_empty_tables: Object.entries(manifest.tables).filter(([, entry]) => entry.source_status === 'schema_absent').map(([name]) => name),
    controls: controls(tables), files_pending: manifest.attachments?.length || 0,
  };
  if (!equal(run.manifest, manifest) || !equal(run.report, expectedReport)) {
    throw new Error('Stored import metadata differs from this snapshot; repair refused.');
  }

  const replacements = new Map();
  for (const file of manifest.attachments || []) {
    const [mapped] = await tx.unsafe('SELECT id,bucket,object_key,access_roles FROM erp_private.files WHERE legacy_uri=$1', [file.uri]);
    if (!mapped) continue;
    const bucket = file.private ? 'soeicam-private' : 'soeicam-public';
    if (mapped.id !== file.id || mapped.bucket !== bucket || mapped.object_key !== 'migrated/' + file.id) {
      throw new Error('Attachment mapping differs from this snapshot; repair refused.');
    }
    planField('erp_private.files', mapped, 'access_roles', 'array');
    const roles = ['admin'];
    if (file.references.some(ref => ['CashCollection', 'FieldSale', 'ExpenseRequest'].includes(ref.entity))) roles.push('cashier');
    if (file.references.some(ref => ref.entity === 'ExpenseRequest')) roles.push('production_manager');
    if (file.references.some(ref => ref.entity === 'DriverActivity')) roles.push('warehouse_manager');
    if (!equal(mapped.access_roles, roles)) throw new Error('Attachment access roles changed; repair refused.');
    if (!file.private) {
      if (!supabaseUrl) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL before checking migrated images.');
      replacements.set(file.uri, supabaseUrl.replace(/\/$/, '') + '/storage/v1/object/public/' + mapped.bucket + '/' + mapped.object_key);
    }
  }

  let records = 0;
  for (const [name, schema] of Object.entries(catalog)) {
    const table = 'public.' + identifier(schema.table);
    const rows = await tx.unsafe(`SELECT * FROM ${table} ORDER BY id`);
    const before = updates.length;
    for (const row of rows) {
      planField(table, row, 'extra_data', 'object');
      for (const [field, def] of Object.entries(schema.fields)) {
        if (['array', 'object'].includes(def.type)) planField(table, row, field, def.type);
      }
    }
    const actual = rows.map(flattenRecord);
    const expected = tables[name].map(row => normalizedRecord(row, schema));
    const expectedById = new Map(expected.map(row => [row.id, row]));
    for (const file of manifest.attachments || []) {
      if (!replacements.has(file.uri)) continue;
      for (const ref of file.references.filter(ref => ref.entity === name)) {
        const row = expectedById.get(ref.id);
        if (row) row[ref.field] = replacements.get(file.uri);
      }
    }
    // Preserve a legitimate Supabase identity link without rewriting it.
    if (name === 'User') actual.forEach(row => { row.auth_user_id = expectedById.get(row.id)?.auth_user_id ?? null; });
    if (actual.length !== expected.length || new Set(actual.map(row => row.id)).size !== expected.length
        || actual.some(row => !expectedById.has(row.id))) {
      throw new Error(`${name}: record IDs or counts differ; repair refused.`);
    }
    if (recordHash(actual) !== recordHash(expected)) {
      const fields = new Set();
      for (const row of actual) {
        const source = expectedById.get(row.id);
        for (const key of new Set([...Object.keys(source), ...Object.keys(row)])) if (!equal(source[key], row[key])) fields.add(key);
      }
      throw new Error(`${name}: differences remain in ${[...fields].sort().slice(0, 10).join(', ')} after decoding JSON; repair refused.`);
    }
    if (updates.length > before) tableCounts[name] = updates.length - before;
    records += rows.length;
  }
  return { updates, summary: { tables: Object.keys(catalog).length, records, json_fields_to_repair: updates.length, business_fields_by_table: tableCounts } };
}

export async function applyJsonRepair(tx, plan) {
  for (const { table, id, field, before, after } of plan.updates) {
    const rows = await tx.unsafe(`UPDATE ${table} SET ${identifier(field)}=$1::text::jsonb WHERE id=$2 AND ${identifier(field)}=$3::text::jsonb RETURNING id`, [JSON.stringify(after), id, JSON.stringify(before)]);
    if (rows.length !== 1) throw new Error('A record changed during JSON repair; rolling back.');
  }
}
