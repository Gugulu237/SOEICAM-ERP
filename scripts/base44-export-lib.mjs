import { createHash } from 'node:crypto';

// Added by the local Driver and Hotesse dashboard work. These may not exist in
// the original Base44 app. Every other missing source schema remains fatal.
export const newReportingEntities = new Set(['DriverActivity', 'OutletVisit']);
const missingMessage = name => `Entity schema ${name} not found in app`;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = content => createHash('sha256').update(content).digest('hex');

export function isMissingSourceSchema(error, name) {
  const status = error?.status ?? error?.response?.status;
  const message = error?.data?.message ?? error?.response?.data?.message ?? error?.message;
  return Number(status) === 404 && message === missingMessage(name);
}

function appendRows(name, rows, ids, items) {
  for (const row of items) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new Error(`${name}: repeated or missing record ID.`);
    ids.add(row.id); rows.push(row);
  }
}

function completeSnapshot(rows) {
  return { content: JSON.stringify(canonical(rows.sort((a, b) => a.id.localeCompare(b.id)))) + '\n', source_status: 'present' };
}

async function readSourceUsers(client) {
  const rows = [], ids = new Set();
  for (let page = 0; page < 100000; page++) {
    // User has no /v2/list endpoint. Positional SDK arguments call the app-user
    // endpoint /entities/User with sort, limit and skip, returning an array.
    // https://docs.base44.com/api-reference/list-app-users
    const items = await client.entities.User.list('id', 500, rows.length);
    if (!Array.isArray(items)) throw new Error('User: expected an app-user array; refusing an unverified partial export.');
    if (items.length === 0) return completeSnapshot(rows);
    appendRows('User', rows, ids, items);
    // Continue even after a short page, in case the server caps page size.
    // The outer export verifies a second complete read, as for other tables.
  }
  throw new Error('User: pagination limit reached.');
}

export async function readSourceTable(client, name) {
  if (name === 'User') return readSourceUsers(client);
  const rows = [], ids = new Set(), cursors = new Set();
  let cursor;
  for (let page = 0; page < 100000; page++) {
    let result;
    try {
      result = await client.entities[name].filter({}, { sort: 'id', limit: 500, cursor });
    } catch (error) {
      if (page === 0 && newReportingEntities.has(name) && isMissingSourceSchema(error, name)) {
        return { content: '[]\n', source_status: 'schema_absent', source_evidence: { status: 404, message: missingMessage(name) } };
      }
      throw error;
    }
    if (!result || !Array.isArray(result.items) || typeof result.has_more !== 'boolean') {
      throw new Error(`${name}: expected a paginated response; refusing an unverified partial export.`);
    }
    appendRows(name, rows, ids, result.items);
    if (!result.has_more) {
      if (result.total != null && Number(result.total) !== rows.length) throw new Error(`${name}: total count differs from exported records.`);
      return completeSnapshot(rows);
    }
    if (!result.next_cursor || cursors.has(result.next_cursor)) throw new Error(`${name}: missing or repeated cursor.`);
    cursor = result.next_cursor; cursors.add(cursor);
  }
  throw new Error(`${name}: pagination limit reached.`);
}

export function assertSourceTableStable(name, entry, check) {
  if (entry.source_status !== check.source_status || entry.sha256 !== digest(check.content)) {
    throw new Error(`${name} changed during export. Pause source writes and export again.`);
  }
}

export function validateSourceTableEntry(name, entry) {
  if (!entry.source_status || entry.source_status === 'present') return;
  if (entry.source_status !== 'schema_absent' || !newReportingEntities.has(name) || entry.count !== 0
      || entry.source_evidence?.status !== 404 || entry.source_evidence?.message !== missingMessage(name)
      || entry.source_evidence?.verified_twice !== true) {
    throw new Error(`${name}: missing source schema was not safely verified; refusing partial migration.`);
  }
}

export function safeExportError(error) {
  const status = Number(error?.status ?? error?.response?.status);
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    // Never serialize SDK errors: their nested request objects contain tokens.
    const message = error?.data?.message ?? error?.response?.data?.message ?? error?.message;
    if (status === 404 && typeof message === 'string' && /^Entity schema [A-Za-z][A-Za-z0-9_]* not found in app$/.test(message)) return message;
    return `Base44 request failed (HTTP ${status}). Check source access or service availability, then retry.`;
  }
  return String(error instanceof Error ? error.message : 'Export failed.')
    .replace(/\bBearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED TOKEN]')
    .replace(/\bsb_secret_[A-Za-z0-9_-]+/g, '[REDACTED SECRET]')
    .replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, '$1[REDACTED]')
    .slice(0, 400);
}
