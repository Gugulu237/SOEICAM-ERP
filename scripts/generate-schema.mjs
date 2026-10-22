import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const snake = value => value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const sqlType = def => def.type === 'number' ? 'numeric' : def.type === 'integer' ? 'bigint' : def.type === 'boolean' ? 'boolean' : ['array','object'].includes(def.type) ? 'jsonb' : 'text';
const catalog = {};
const sql = [
  '-- Generated from all Base44 entity definitions. Original IDs and fields are preserved.',
  '-- Business tables are accessible only through authenticated Next.js API routes.',
  'create schema if not exists erp_private;',
  'revoke all on schema erp_private from public, anon, authenticated;',
];
for (const name of (await readdir(path.join(root, 'migration/entities'))).filter(name => name.endsWith('.jsonc')).sort()) {
  const source = JSON.parse(await readFile(path.join(root, 'migration/entities', name), 'utf8'));
  const entity = source.name || name.replace('.jsonc','');
  const properties = { ...source.properties };
  if (entity === 'User') Object.assign(properties, { full_name: { type:'string' }, email: { type:'string' }, auth_user_id: { type:'string' } });
  const fields = { id: { type:'string' }, created_date: { type:'string' }, updated_date: { type:'string' }, created_by: { type:'string' }, ...properties };
  const table = snake(entity);
  catalog[entity] = { table, fields, required: source.required || [], source: name };
  const cols = Object.entries(fields).map(([key, def]) => `  ${quote(key)} ${sqlType(def)}${key === 'id' ? ' primary key' : ''}`);
  cols.push('  extra_data jsonb not null default \'{}\'::jsonb');
  sql.push(`create table if not exists public.${quote(table)} (\n${cols.join(',\n')}\n);`);
  sql.push(`alter table public.${quote(table)} enable row level security;`);
  sql.push(`revoke all on public.${quote(table)} from anon, authenticated;`);
  sql.push(`grant all on public.${quote(table)} to service_role;`);
  for (const [key, def] of Object.entries(fields)) {
    if (key !== 'id' && (key.endsWith('_id') || ['status','role','email','created_date'].includes(key)) && def.type === 'string') {
      sql.push(`create index if not exists ${quote((table+'_'+key+'_idx').slice(0,63))} on public.${quote(table)} (${quote(key)});`);
    }
  }
}
sql.push('create unique index if not exists user_auth_identity_idx on public."user" (auth_user_id) where auth_user_id is not null and auth_user_id <> \'\';');
sql.push(`create table if not exists erp_private.files (
  id text primary key, bucket text not null, object_key text not null unique,
  owner_id text not null, original_name text not null, content_type text not null,
  access_roles jsonb not null default '[]'::jsonb,
  size bigint not null, created_at timestamptz not null default now(), legacy_uri text unique
);`);
sql.push(`create table if not exists erp_private.migration_runs (
  id text primary key, started_at timestamptz not null default now(), completed_at timestamptz,
  manifest jsonb not null, report jsonb
);`);
sql.push('grant usage on schema erp_private to service_role;\ngrant all on all tables in schema erp_private to service_role;');
await mkdir(path.join(root,'src/server/generated'), { recursive:true });
await mkdir(path.join(root,'supabase/migrations'), { recursive:true });
await writeFile(path.join(root,'src/server/generated/schema.json'), JSON.stringify(catalog,null,2)+'\n');
await writeFile(path.join(root,'supabase/migrations/202610170001_erp_schema.sql'), sql.join('\n\n')+'\n');
const types = ['// Generated from the original 56 entity definitions.\nexport interface ERPRecords {'];
for (const [entity, def] of Object.entries(catalog)) {
  types.push(`  ${entity}: {`);
  for (const [key, field] of Object.entries(def.fields)) types.push(`    ${JSON.stringify(key)}${key === 'id' ? '' : '?'}: ${['number','integer'].includes(field.type) ? 'number' : field.type === 'boolean' ? 'boolean' : field.type === 'array' ? 'unknown[]' : field.type === 'object' ? 'Record<string, unknown>' : 'string'};`);
  types.push('  };');
}
types.push('}');
await writeFile(path.join(root,'src/server/generated/records.d.ts'), types.join('\n')+'\n');
console.log(`Generated ${Object.keys(catalog).length} PostgreSQL tables, metadata and record types.`);
