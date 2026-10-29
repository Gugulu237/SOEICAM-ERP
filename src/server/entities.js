import 'server-only';
import catalog from './generated/schema.json' with { type:'json' };
import { database, transaction } from './db.js';
import { identifier, whereClause, sortClause, splitRecord, flattenRecord, fieldExpression } from './query.js';

export function entitySchema(name) {
  if (!Object.hasOwn(catalog,name)) throw Object.assign(new Error('Unknown ERP table'),{ status:404 });
  return catalog[name];
}
function valueParameter(value, def) { return ['array','object'].includes(def?.type) && value != null ? JSON.stringify(value) : value; }
function auditInput(name, input) {
  if (name !== 'AuditLog' || !input || typeof input !== 'object' || Array.isArray(input)) return input;
  // Generic API callers are stamped client_reported before reaching this
  // service store. Direct checked workflows receive an explicit origin too.
  return { ...input, audit_source:input.audit_source === 'client_reported' ? 'client_reported' : 'server_verified' };
}
export function entityStore(name) {
  const schema = entitySchema(name), table = 'public.'+identifier(schema.table);
  const filter = async (query = {}, options = '-created_date', limit, skip = 0) => {
    const paged = options && typeof options === 'object';
    const countLimit = paged ? Number(options.limit ?? 100) : limit == null ? 10001 : Number(limit);
    const offset = paged ? Number(options.cursor || options.skip || 0) : Number(skip);
    if (!Number.isSafeInteger(countLimit) || countLimit < 1 || countLimit > 10001 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid pagination');
    const params = [], where = whereClause(query,schema,params), order = sortClause(paged ? options.sort : options,schema,params);
    const rows = await database().unsafe(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ${countLimit+Number(paged)} OFFSET ${offset}`,params);
    if (!paged) { if (limit == null && rows.length > 10000) throw new Error('This table requires paginated loading.'); return rows.map(flattenRecord); }
    const items = rows.slice(0,countLimit).map(flattenRecord), more = rows.length > countLimit;
    const page = { items, has_more:more, next_cursor:more ? String(offset+countLimit) : null };
    // Lookup/load-all callers need the next page, not a second full-table count.
    // Keep total counts opt-out so existing pagination UIs retain their contract.
    if (options.include_total === false) return page;
    const countParams = [], countWhere = whereClause(query,schema,countParams);
    const [total] = await database().unsafe(`SELECT count(*)::integer AS count FROM ${table} WHERE ${countWhere}`,countParams);
    return { ...page, total:total.count };
  };
  const get = async id => {
    const rows = await database().unsafe(`SELECT * FROM ${table} WHERE id = $1`,[String(id)]);
    return flattenRecord(rows[0]);
  };
  const create = async input => {
    const { record, extra } = splitRecord(auditInput(name,input),schema,{ creating:true });
    record.id ||= crypto.randomUUID(); record.created_date ||= new Date().toISOString(); record.updated_date = new Date().toISOString();
    const keys = Object.keys(record), params = keys.map(key => valueParameter(record[key],schema.fields[key]));
    keys.push('extra_data'); params.push(JSON.stringify(extra));
    const placeholders = keys.map((key,i) => '$'+(i+1)+(['array','object'].includes(schema.fields[key]?.type) || key === 'extra_data' ? '::text::jsonb' : ''));
    const [saved] = await database().unsafe(`INSERT INTO ${table} (${keys.map(identifier).join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,params);
    return flattenRecord(saved);
  };
  const bulkCreate = rows => transaction(async () => {
    if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid record batch');
    if (!rows.length) return [];
    const prepared = rows.map(input => {
      const { record, extra } = splitRecord(auditInput(name,input),schema,{ creating:true });
      record.id ||= crypto.randomUUID(); record.created_date ||= new Date().toISOString(); record.updated_date = new Date().toISOString();
      return { ...record, extra_data:extra };
    });
    const keys = [...new Set(prepared.flatMap(record => Object.keys(record)))];
    const batchSize = Math.max(1,Math.min(200,Math.floor(60000/keys.length)));
    const saved = new Map();
    for (let start = 0; start < prepared.length; start += batchSize) {
      const params = [];
      const values = prepared.slice(start,start+batchSize).map(record => '('+keys.map(key => {
        if (!Object.hasOwn(record,key)) return 'DEFAULT';
        const json = key === 'extra_data' || ['array','object'].includes(schema.fields[key]?.type);
        params.push(json && record[key] != null ? JSON.stringify(record[key]) : record[key]);
        return '$'+params.length+(json ? '::text::jsonb' : '');
      }).join(',')+')');
      const result = await database().unsafe(`INSERT INTO ${table} (${keys.map(identifier).join(',')}) VALUES ${values.join(',')} RETURNING *`,params);
      for (const row of result) saved.set(row.id,flattenRecord(row));
    }
    return prepared.map(row => saved.get(row.id));
  });
  // Service workflows can update uniform patches in one round trip. This is
  // deliberately not an operation exposed by the generic entity HTTP API.
  const bulkUpdate = rows => transaction(async () => {
    if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid record batch');
    if (!rows.length) return [];
    const ids = new Set(), now = new Date().toISOString();
    const prepared = rows.map(input => {
      if (!input || typeof input.id !== 'string' || !input.id || ids.has(input.id)) throw new Error('Enter unique record IDs for a batch update.');
      ids.add(input.id);
      const {id,...changes} = input, {record,extra} = splitRecord(changes,schema);
      delete record.created_date; delete record.created_by; record.updated_date = now;
      return {id,...record,extra_data:extra};
    });
    const fields = Object.keys(prepared[0]).filter(key => !['id','extra_data'].includes(key)).sort();
    if (prepared.some(row => Object.keys(row).filter(key => !['id','extra_data'].includes(key)).sort().join(',') !== fields.join(','))) throw new Error('Batch updates must change the same fields.');
    const keys = ['id',...fields,'extra_data'], batchSize = Math.max(1,Math.min(200,Math.floor(60000/keys.length))), saved = new Map();
    for (let start = 0; start < prepared.length; start += batchSize) {
      const params = [], batch = prepared.slice(start,start+batchSize);
      const values = batch.map(row => '('+keys.map(key => {
        const type = key === 'extra_data' ? 'object' : schema.fields[key]?.type;
        const json = ['array','object'].includes(type), cast = json ? '::text::jsonb' : ['number','integer'].includes(type) ? '::numeric' : type === 'boolean' ? '::boolean' : '::text';
        params.push(json && row[key] != null ? JSON.stringify(row[key]) : row[key]);
        return '$'+params.length+cast;
      }).join(',')+')');
      const assignments = fields.map(key => identifier(key)+' = patch.'+identifier(key));
      assignments.push('extra_data = target.extra_data || patch.extra_data');
      const result = await database().unsafe(`UPDATE ${table} AS target SET ${assignments.join(',')} FROM (VALUES ${values.join(',')}) AS patch (${keys.map(identifier).join(',')}) WHERE target.id = patch.id RETURNING target.*`,params);
      if (result.length !== batch.length) throw new Error('Batch update references missing records.');
      for (const row of result) saved.set(row.id,flattenRecord(row));
    }
    return prepared.map(row => saved.get(row.id));
  });
  const updateMany = async (query, changes) => {
    const { record, extra } = splitRecord(changes.$set || (changes.$inc ? {} : changes),schema);
    delete record.created_date; delete record.created_by;
    record.updated_date = new Date().toISOString();
    const params = [], assignments = [];
    for (const [key,value] of Object.entries(record)) {
      params.push(valueParameter(value,schema.fields[key]));
      assignments.push(identifier(key)+' = $'+params.length+(['array','object'].includes(schema.fields[key]?.type) ? '::text::jsonb' : ''));
    }
    for (const [key,value] of Object.entries(changes.$inc || {})) {
      if (!['number','integer'].includes(schema.fields[key]?.type) || !Number.isFinite(Number(value)) || key in record) throw new Error('Invalid increment');
      params.push(Number(value)); assignments.push(`${identifier(key)} = coalesce(${identifier(key)},0) + $${params.length}`);
    }
    if (Object.keys(extra).length) { params.push(JSON.stringify(extra)); assignments.push('extra_data = extra_data || $'+params.length+'::text::jsonb'); }
    const where = whereClause(query,schema,params);
    const rows = await database().unsafe(`UPDATE ${table} SET ${assignments.join(',')} WHERE ${where} RETURNING *`,params);
    return { updated:rows.length, modifiedCount:rows.length, modified_count:rows.length, records:rows.map(flattenRecord) };
  };
  const remove = async query => {
    const params = [], where = whereClause(query,schema,params);
    const rows = await database().unsafe(`DELETE FROM ${table} WHERE ${where} RETURNING id`,params);
    return { deleted:rows.length, deletedCount:rows.length };
  };
  const aggregate = async ({ query = {}, groupBy, sum = [], limit = 10000 } = {}) => {
    const params = [], groups = groupBy ? (Array.isArray(groupBy) ? groupBy : [groupBy]) : [];
    const sums = Array.isArray(sum) ? sum : [sum];
    const groupExpressions = groups.map(key => fieldExpression(key,schema,params));
    const selects = groupExpressions.map((field,i) => field+' AS '+identifier(groups[i]));
    selects.push('count(*)::integer AS count');
    sums.filter(Boolean).forEach(key => {
      if (!['number','integer'].includes(schema.fields[key]?.type)) throw new Error('Can only total numeric fields');
      selects.push(`coalesce(sum(${identifier(key)}),0) AS ${identifier('sum_'+key)}`);
    });
    const where = whereClause(query,schema,params), max = Math.min(10000,Math.max(1,Number(limit)||10000));
    const rows = await database().unsafe(`SELECT ${selects.join(',')} FROM ${table} WHERE ${where}${groupExpressions.length ? ' GROUP BY '+groupExpressions.join(',') : ''} LIMIT ${max+1}`,params);
    if (rows.length > max) throw new Error('Aggregate result exceeds the limit. Narrow the report filters.');
    return { rows, ...(groups.length ? {} : rows[0]), total:rows.reduce((n,row) => n+row.count,0) };
  };
  return {
    filter, list:(...args) => filter({},...args), get, create,
    update:async (id,value) => (await updateMany({ id:String(id) },value)).records[0] || null,
    updateMany, delete:id => remove({ id:String(id) }), deleteMany:remove,
    bulkCreate, bulkUpdate,
    count:async query => (await aggregate({ query })).count,
    aggregate,
    upsert:(rows,{ key = ['id'], updateExisting = true } = {}) => transaction(async () => {
      const keys = Array.isArray(key) ? key : [key], records=[]; let created=0;
      for (const row of rows) {
        const query = Object.fromEntries(keys.map(k => { if (row[k] == null) throw new Error('Upsert key is missing'); return [k,row[k]]; }));
        await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[name+':'+JSON.stringify(query)]);
        const existing = (await filter(query,'id',1))[0];
        if (existing) records.push(updateExisting ? (await updateMany({ id:existing.id },row)).records[0] : existing);
        else { records.push(await create(row)); created++; }
      }
      return { records, created, updated:records.length-created };
    }),
  };
}
export const serviceEntities = new Proxy({}, { get:(_,name) => entityStore(String(name)) });
