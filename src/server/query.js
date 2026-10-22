export const identifier = name => '"' + String(name).replaceAll('"','""') + '"';
export function fieldExpression(name, schema, params) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/.test(name)) throw new Error('Invalid field name');
  if (schema.fields[name]) return identifier(name);
  params.push(name);
  return `(extra_data ->> $${params.length})`;
}
export function whereClause(query, schema, params = [], depth = 0) {
  if (depth > 10 || !query || typeof query !== 'object' || Array.isArray(query)) throw new Error('Invalid record filter');
  const parts = [];
  const bind = value => { params.push(value); return '$'+params.length; };
  for (const [key,value] of Object.entries(query)) {
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value) || value.length > 200) throw new Error('Invalid logical filter');
      parts.push(value.length ? '('+value.map(v => whereClause(v,schema,params,depth+1)).join(key === '$and' ? ' AND ' : ' OR ')+')' : key === '$and' ? 'TRUE' : 'FALSE');
      continue;
    }
    if (key.startsWith('$')) throw new Error('Unsupported filter operator');
    const expression = fieldExpression(key,schema,params);
    // Extension fields use ->>, which is text. Postgres.js otherwise sends JS
    // booleans with a boolean type, making text = boolean fail at SQL parse time.
    const fieldBind = arg => bind(!schema.fields[key] && typeof arg === 'boolean' ? String(arg) : arg);
    const rules = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : { $eq:value };
    for (const [op,arg] of Object.entries(rules)) {
      if (op === '$options') continue;
      if (op === '$exists') { parts.push(expression+(arg ? ' IS NOT NULL' : ' IS NULL')); continue; }
      if (op === '$in' || op === '$nin') {
        if (!Array.isArray(arg) || arg.length > 5000) throw new Error('Invalid membership filter');
        if (!arg.length) { parts.push(op === '$in' ? 'FALSE' : 'TRUE'); continue; }
        if (schema.fields[key]?.type === 'array') {
          const test = `jsonb_exists_any(coalesce(${expression}, '[]'::jsonb), ARRAY(SELECT jsonb_array_elements_text(${bind(JSON.stringify(arg))}::text::jsonb)))`;
          parts.push(op === '$in' ? test : 'NOT '+test);
        } else {
          const values=arg.filter(value=>value !== null), includesNull=values.length !== arg.length;
          const test=values.length ? `${expression} ${op === '$nin' ? 'NOT IN' : 'IN'} (${values.map(fieldBind).join(',')})` : op === '$nin' ? 'TRUE' : 'FALSE';
          if (op === '$in') parts.push(includesNull ? `(${test} OR ${expression} IS NULL)` : test);
          else parts.push(includesNull ? `(${test} AND ${expression} IS NOT NULL)` : `(${test} OR ${expression} IS NULL)`);
        }
        continue;
      }
      const operators = { $eq:'=', $ne:'IS DISTINCT FROM', $gt:'>', $gte:'>=', $lt:'<', $lte:'<=' };
      if (op === '$regex') { if (typeof arg !== 'string' || arg.length > 500) throw new Error('Invalid search'); parts.push(`${expression} ${String(rules.$options).includes('i') ? '~*' : '~'} ${bind(arg)}`); continue; }
      if (!operators[op]) throw new Error('Unsupported field filter');
      if (arg === null && op === '$eq') parts.push(expression+' IS NULL');
      else parts.push(`${expression} ${operators[op]} ${fieldBind(arg)}`);
    }
  }
  return parts.length ? '('+parts.join(' AND ')+')' : 'TRUE';
}

export function sortClause(sort, schema, params) {
  const keys = String(sort || '-created_date').split(',').map(key => key.trim()).filter(Boolean).slice(0,5);
  return [...keys.map(key => `${fieldExpression(key.replace(/^[-+]/,''),schema,params)} ${key.startsWith('-') ? 'DESC' : 'ASC'} NULLS LAST`), 'id ASC'].join(', ');
}

export function splitRecord(input, schema, { creating = false, importing = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid record');
  const record = {}, extra = {};
  for (const [key,value] of Object.entries(input)) {
    if (key === 'extra_data') { if (importing && value && typeof value === 'object') Object.assign(extra,value); continue; }
    if (value === undefined || ['__proto__','constructor','prototype'].includes(key)) continue;
    const def = schema.fields[key];
    if (!def) { extra[key] = value; continue; }
    if (!importing && key === 'id' && !creating) throw new Error('Record IDs cannot be changed');
    if (value === null) { record[key] = null; continue; }
    if (['number','integer'].includes(def.type)) { if (value === '') { record[key] = null; continue; } if (!Number.isFinite(Number(value))) throw new Error(`Invalid number: ${key}`); record[key] = Number(value); }
    else if (def.type === 'boolean') { if (typeof value !== 'boolean') throw new Error(`Invalid boolean: ${key}`); record[key] = value; }
    else if (def.type === 'array' || def.type === 'object') { if (typeof value !== 'object' || (def.type === 'array' && !Array.isArray(value))) throw new Error(`Invalid value: ${key}`); record[key] = value; }
    else record[key] = String(value);
  }
  if (creating && !importing) {
    for (const [key,def] of Object.entries(schema.fields)) if (record[key] === undefined && def.default !== undefined) record[key] = def.default;
    for (const key of schema.required) if (record[key] === undefined || record[key] === null || record[key] === '') throw new Error(`Missing required field: ${key}`);
  }
  return { record, extra };
}

export function flattenRecord(row) {
  if (!row) return null;
  const { extra_data, ...values } = row;
  return { ...(extra_data || {}), ...values };
}
