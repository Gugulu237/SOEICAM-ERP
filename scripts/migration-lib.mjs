import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import catalog from '../src/server/generated/schema.json' with { type:'json' };
import { splitRecord, identifier } from '../src/server/query.js';
import { validateSourceTableEntry } from './base44-export-lib.mjs';
export { catalog, identifier };
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key] !== undefined).map(key=>[key,canonical(value[key])]));
  return value;
}
export const recordHash = rows => sha256(JSON.stringify(canonical([...rows].sort((a,b)=>a.id.localeCompare(b.id)))));
export function normalizedRecord(row, schema) {
  const { record,extra } = splitRecord(row,schema,{ importing:true });
  return { ...extra,...Object.fromEntries(Object.keys(schema.fields).map(key=>[key,record[key] ?? null])) };
}
export function localPath(directory, relative) {
  const root=path.resolve(directory), target=path.resolve(root,relative);
  if (target === root || !target.startsWith(root+path.sep)) throw new Error('Export contains an unsafe file path.');
  return target;
}
export async function readSnapshot(directory) {
  const manifest=JSON.parse(await readFile(localPath(directory,'manifest.json'),'utf8'));
  if (manifest.format !== 'soeicam-export-v1' || !manifest.completed_at || !manifest.verified_stable) throw new Error('Export is incomplete or changed during export. Freeze source writes and export again.');
  if (manifest.schema_sha256 !== sha256(await readFile(new URL('../src/server/generated/schema.json',import.meta.url)))) throw new Error('Export schema differs from this build. Use the matching schema and exporter.');
  const tables={};
  for (const [entity,schema] of Object.entries(catalog)) {
    const entry=manifest.tables?.[entity];
    if (!entry || entry.status !== 'complete') throw new Error(`${entity}: missing or incomplete export; refusing partial migration.`);
    validateSourceTableEntry(entity,entry);
    const bytes=await readFile(localPath(directory,entry.file));
    if (sha256(bytes) !== entry.sha256) throw new Error(`${entity}: checksum mismatch.`);
    const rows=JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(rows) || rows.length !== entry.count) throw new Error(`${entity}: record count mismatch.`);
    const ids=new Set();
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new Error(`${entity}: missing or duplicate ID.`);
      ids.add(row.id); normalizedRecord(row,schema);
    }
    tables[entity]=rows;
  }
  return { manifest,tables };
}
export function openDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env.local before connecting to Supabase.');
  return import('postgres').then(({default:postgres})=>postgres(process.env.DATABASE_URL,{ max:1,prepare:false,ssl:process.env.DATABASE_SSL === 'disable' ? false : 'require',types:{ numeric:{ to:1700,from:[1700],serialize:String,parse:Number } } }));
}
export function controls(tables) {
  const output={};
  for (const [entity,fields] of Object.entries({ Invoice:['total','balance','amount_paid'],Payment:['amount'],JournalLine:['debit','credit'],Customer:['balance'],TreasuryTransaction:['amount'],FieldSale:['total'] })) {
    output[entity]={};
    for (const row of tables[entity] || []) {
      const key=JSON.stringify([row.currency || 'XAF',row.status || '',row.payment_type || row.transaction_type || '']);
      const group=output[entity][key] ||= { count:0,...Object.fromEntries(fields.map(f=>[f,0])) };group.count++;
      fields.forEach(f=>{ group[f]=Math.round((group[f]+Number(row[f] || 0))*100)/100; });
    }
  }
  // Never combine quantities for different products, units or warehouses.
  output.StockBalance={};
  for (const row of tables.StockBalance || []) {
    const key=JSON.stringify([row.product_id,row.warehouse_id,row.unit || '',row.status || '']);
    const group=output.StockBalance[key] ||= { quantity:0,total_value:0 };
    group.quantity=Math.round((group.quantity+Number(row.quantity || 0))*1000)/1000;
    group.total_value=Math.round((group.total_value+Number(row.total_value || 0))*100)/100;
  }
  return canonical(output);
}
export async function insertSnapshot(sql,tables) {
  for (const [name,rows] of Object.entries(tables)) {
    const schema=catalog[name];
    for (const row of rows) {
      const { record,extra }=splitRecord(row,schema,{ importing:true });
      const keys=[...Object.keys(record),'extra_data'];
      const values=keys.map(key=>key === 'extra_data' ? JSON.stringify(extra) : ['array','object'].includes(schema.fields[key]?.type) && record[key] != null ? JSON.stringify(record[key]) : record[key]);
      // Serialized JSON must bind as text: Postgres.js otherwise encodes it again.
      const params=keys.map((key,i)=>`$${i+1}${key === 'extra_data' || ['array','object'].includes(schema.fields[key]?.type) ? '::text::jsonb' : ''}`);
      await sql.unsafe(`INSERT INTO public.${identifier(schema.table)} (${keys.map(identifier).join(',')}) VALUES (${params.join(',')})`,values);
    }
  }
}
