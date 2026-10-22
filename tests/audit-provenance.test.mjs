import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import catalog from '../src/server/generated/schema.json' with { type:'json' };
import { postgresAdapter } from './helpers/postgres-adapter.mjs';
import { auditProvenance } from '../src/lib/audit-provenance.js';

test('old and unknown audit sources never acquire a verified label from an action or employee name', () => {
  for (const source of [undefined, null, '', 'server', 'verified', 'SERVER_VERIFIED']) {
    assert.equal(auditProvenance({audit_source:source,action:'approve_payment',user_name:'General Manager',entity_id:'posted-journal'}).tone,'unknown');
  }
  assert.equal(auditProvenance({audit_source:'client_reported',action:'approve_payment'}).tone,'reported');
  assert.equal(auditProvenance({audit_source:'server_verified'}).tone,'verified');
});

test('service audit writes record their provenance for both single and bulk inserts without rewriting earlier events', async () => {
  const db=new PGlite();
  const fields=Object.entries(catalog.AuditLog.fields).map(([key,definition])=>`"${key}" ${['number','integer'].includes(definition.type)?'numeric':definition.type==='boolean'?'boolean':['array','object'].includes(definition.type)?'jsonb':'text'}${key==='id'?' PRIMARY KEY':''}`);
  await db.exec(`CREATE TABLE audit_log (${fields.join(',')},extra_data jsonb NOT NULL DEFAULT '{}');`);
  const prior=globalThis.__auditProvenanceDb;
  globalThis.__auditProvenanceDb=postgresAdapter(db);
  try {
    const built=await build({entryPoints:['src/server/entities.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'isolated-audit',setup(builder){
      builder.onResolve({filter:/^(?:server-only|\.\/db\.js)$/},args=>({path:args.path,namespace:'isolated-audit'}));
      builder.onLoad({filter:/.*/,namespace:'isolated-audit'},args=>({contents:args.path==='server-only'?'':'export const database=()=>globalThis.__auditProvenanceDb;export const transaction=async run=>run();'}));
    }}]});
    const {entityStore}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
    const store=entityStore('AuditLog');
    await db.exec(`INSERT INTO audit_log(id,action,extra_data) VALUES ('legacy','post_journal','{}');`);
    const checked=await store.create({action:'approve_payment',module:'accounting',description:'Approved isolated fixture',user_id:'actual-approver'});
    assert.equal(checked.audit_source,'server_verified');
    const reported=await store.create({action:'reported_note',module:'accounting',description:'Reported isolated fixture',user_id:'actual-user',audit_source:'client_reported'});
    assert.equal(reported.audit_source,'client_reported');
    const bulk=await store.bulkCreate([{action:'warehouse_transfer',module:'inventory',description:'Checked isolated transfer',user_id:'warehouse-user'},{action:'reported_note',module:'accounting',description:'Reported isolated note',audit_source:'client_reported',user_id:'actual-user'}]);
    assert.deepEqual(bulk.map(row=>row.audit_source),['server_verified','client_reported']);
    assert.equal((await store.get('legacy')).audit_source,undefined);
    const rows=(await db.query('SELECT extra_data FROM audit_log WHERE id=$1',[checked.id])).rows;
    assert.equal(rows[0].extra_data.audit_source,'server_verified');
  } finally {if(prior===undefined)delete globalThis.__auditProvenanceDb;else globalThis.__auditProvenanceDb=prior;await db.close();}
});
