import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir,mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { catalog,identifier,insertSnapshot,normalizedRecord,recordHash,readSnapshot,sha256 } from '../scripts/migration-lib.mjs';
import { whereClause,sortClause,flattenRecord } from '../src/server/query.js';
import { entityPolicies,assertEntityAccess,guardMutation,recordScope,visibleRecord } from '../src/server/access.js';
import { entityArguments } from '../src/lib/record-input.js';

const ctx=role=>({ user:{ id:'user-1',role:role === 'admin' ? 'admin' : 'user',email:'staff@example.test' },employee:{ id:'employee-1',role,status:'active' },role });
test('editing a loaded legacy form retains its path ID and excludes server metadata',()=>{
  const row={ id:'existing',created_date:'old',created_by:'original',name:'Updated',components:[{id:'nested-component'}] };
  const args=entityArguments('update',['existing',row]);
  assert.equal(args[0],'existing');assert.equal(args[1].id,undefined);assert.equal(args[1].created_by,undefined);
  assert.equal(args[1].components[0].id,'nested-component');assert.equal(row.id,'existing');
  assert.doesNotThrow(()=>guardMutation(ctx('admin'),'Department','update',args[1]));
});
test('all 56 original schemas, routes and permission policies are represented',async()=>{
  const files=(await readdir(new URL('../migration/entities/',import.meta.url))).filter(name=>name.endsWith('.jsonc'));
  assert.equal(Object.keys(catalog).length,56);
  assert.deepEqual(files.map(file=>file.slice(0,-6)).sort(),Object.keys(catalog).sort());
  assert.deepEqual(Object.keys(entityPolicies.readRoles).sort(),Object.keys(catalog).sort());
  assert.deepEqual(Object.keys(entityPolicies.writeRoles).sort(),Object.keys(catalog).sort());
  const routes=JSON.parse(await readFile(new URL('../migration/routes.json',import.meta.url),'utf8'));
  assert.equal(routes.length,70);
});
test('new API denies role escalation, inactive accounts, forged signatures and field transaction bypass',()=>{
  assert.throws(()=>assertEntityAccess({ ...ctx('commercial'),employee:null },'Customer','list'));
  assert.throws(()=>assertEntityAccess({ ...ctx('admin'),user:null },'User','list'));
  assert.throws(()=>assertEntityAccess({ ...ctx('driver'),employee:{ ...ctx('driver').employee,status:'inactive' } },'Employee','filter'));
  for (const entity of Object.keys(catalog)) if (!['CompanySettings','Employee','User'].includes(entity)) assert.throws(()=>assertEntityAccess(ctx('driver'),entity,'filter'));
  for (const entity of ['FieldSale','CashCollection','CashHandover','OutletVisit','DriverActivity']) assert.throws(()=>assertEntityAccess(ctx('commercial'),entity,'create'));
  assert.throws(()=>guardMutation(ctx('cashier'),'Payment','create',{ payment_type:'customer_payment' }));
  assert.throws(()=>guardMutation(ctx('cashier'),'Payment','update',{ cheque_gm_signed_by:'forged' },{ payment_type:'supplier_payment' }));
  assert.throws(()=>guardMutation(ctx('production_manager'),'Payment','update',{ $set:{ cheque_pm_signed_by:'Manager' },$inc:{ amount:999 } }));
  assert.throws(()=>guardMutation(ctx('production_manager'),'Payment','update',{ status:'confirmed',cheque_pm_signed_by:'Manager' },{}));
  assert.throws(()=>guardMutation(ctx('employee'),'User','update',{ role:'admin' }));
  assert.throws(()=>guardMutation(ctx('admin'),'Customer','update',{ id:'replacement' }));
  assert.doesNotThrow(()=>guardMutation(ctx('admin'),'Product','update',{ name:'Updated' }));
});
test('commercial reads are scoped by authenticated employee and staff personal fields are removed',async()=>{
  const scope=await recordScope(ctx('commercial'),'FieldSale','list',{});
  assert.deepEqual(scope,{ commercial_id:'employee-1' });
  const visible=visibleRecord(ctx('commercial'),'Employee',{ id:'cashier-1',full_name:'Cashier',role:'cashier',status:'active',salary:900000,bank_account:'private' });
  assert.equal(visible.salary,undefined);assert.equal(visible.bank_account,undefined);
  assert.deepEqual(await recordScope(ctx('employee'),'ExpenseRequest','filter',{}),{ requester_id:'employee-1' });
});
test('PostgreSQL creates every table, preserves all imported fields and rolls back a failed import',async()=>{
  const db=new PGlite({ parsers:{ 1700:Number } });
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    await db.exec(await readFile(new URL('../supabase/migrations/202610170001_erp_schema.sql',import.meta.url),'utf8'));
    const names=(await db.query("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public'")).rows;
    assert.equal(names.length,56);assert.ok(names.every(row=>row.rowsecurity));
    const tables={};
    for (const [name,schema] of Object.entries(catalog)) {
      const row={ id:'legacy-'+name,created_date:'2023-01-01T00:00:00Z',custom_import_field:{ nested:['retain',42] } };
      for (const [key,def] of Object.entries(schema.fields)) if (!(key in row)) row[key]=def.type === 'array' ? [] : def.type === 'object' ? { preserved:true } : def.type === 'boolean' ? false : ['number','integer'].includes(def.type) ? 12 : '';
      tables[name]=[row];
    }
    const adapter={ unsafe:async(sql,params=[]) => (await db.query(sql,params)).rows };
    await db.exec('BEGIN');await insertSnapshot(adapter,tables);await db.exec('COMMIT');
    for (const [name,schema] of Object.entries(catalog)) {
      const rows=(await db.query(`SELECT * FROM public.${identifier(schema.table)}`)).rows.map(flattenRecord);
      assert.equal(recordHash(rows),recordHash(tables[name].map(row=>normalizedRecord(row,schema))),name);
    }
    await db.exec('BEGIN');
    await db.query('INSERT INTO customer (id) VALUES ($1)',['new-customer']);
    await assert.rejects(()=>insertSnapshot(adapter,{ Customer:[{ id:'legacy-Customer',name:'duplicate' }] }));
    await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM customer WHERE id='new-customer'")).rows[0].n,0);
    const userGrant=(await db.query("SELECT has_table_privilege('authenticated','public.customer','SELECT') AS allowed")).rows[0];
    assert.equal(userGrant.allowed,false);
  } finally { await db.close(); }
});
test('SQL query translation binds hostile values, supports array memberships and conditional updates',async()=>{
  const db=new PGlite({ parsers:{ 1700:Number } });
  try {
    await db.exec('CREATE TABLE sample(id text primary key,name text,amount numeric,tags jsonb,extra_data jsonb,created_date text);');
    await db.query('INSERT INTO sample VALUES ($1,$2,$3,$4,$5,$6)',['one',"O\'Brien",5,JSON.stringify(['commercial','driver']),JSON.stringify({ location:'Douala' }),'2026-01-01']);
    const schema={ fields:{ id:{type:'string'},name:{type:'string'},amount:{type:'number'},tags:{type:'array'},created_date:{type:'string'} } };
    let params=[];let clause=whereClause({ $and:[{ tags:{$in:['commercial']} },{ location:'Douala' },{ amount:{$gte:5} }] },schema,params);
    assert.equal((await db.query('SELECT * FROM sample WHERE '+clause,params)).rows.length,1);
    params=[];clause=whereClause({ name:"'; DROP TABLE sample; --" },schema,params);
    assert.equal((await db.query('SELECT * FROM sample WHERE '+clause,params)).rows.length,0);
    assert.throws(()=>whereClause({ 'name);DELETE FROM sample;--':'x' },schema,[]));
    assert.throws(()=>sortClause('name;DROP TABLE sample',schema,[]));
    params=[];clause=whereClause({ id:'one',amount:5 },schema,params);
    assert.equal((await db.query('UPDATE sample SET amount=6 WHERE '+clause+' RETURNING id',params)).rows.length,1);
    assert.equal((await db.query('UPDATE sample SET amount=99 WHERE '+clause+' RETURNING id',params)).rows.length,0);
    await db.query('UPDATE sample SET name=NULL WHERE id=$1',['one']);
    params=[];clause=whereClause({ name:{$in:['',null]} },schema,params);
    assert.equal((await db.query('SELECT id FROM sample WHERE '+clause,params)).rows.length,1,'unclaimed NULL tokens must match the atomic claim filter');
    params=[];clause=whereClause({ name:{$nin:['cancelled']} },schema,params);
    assert.equal((await db.query('SELECT id FROM sample WHERE '+clause,params)).rows.length,1);
  } finally { await db.close(); }
});
test('snapshot validation rejects omitted tables, duplicates and corrupt files',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'soeicam-migration-test-'));
  try {
    const schemaBytes=await readFile(new URL('../src/server/generated/schema.json',import.meta.url));
    const manifest={ format:'soeicam-export-v1',completed_at:'2026-10-17',verified_stable:true,schema_sha256:sha256(schemaBytes),tables:{} };
    for (const name of Object.keys(catalog)) { const content='[]';await writeFile(path.join(directory,name+'.json'),content);manifest.tables[name]={ status:'complete',file:name+'.json',count:0,sha256:sha256(content) }; }
    await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest));
    assert.equal(Object.keys((await readSnapshot(directory)).tables).length,56);
    await writeFile(path.join(directory,'Customer.json'),'[{}]');
    await assert.rejects(()=>readSnapshot(directory),/checksum/);
    await writeFile(path.join(directory,'Customer.json'),'[]');delete manifest.tables.User;
    await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest));
    await assert.rejects(()=>readSnapshot(directory),/User: missing/);
  } finally { if (!path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep)) throw new Error('Unsafe cleanup path');await rm(directory,{ recursive:true,force:true }); }
});
