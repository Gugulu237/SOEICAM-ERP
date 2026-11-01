import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createECDH,randomBytes,randomUUID} from 'node:crypto';
import {createPushStore} from '../src/server/device-push-store.js';
import {postgresAdapter} from './helpers/postgres-adapter.mjs';
const migration=fs.readFileSync(new URL('../supabase/migrations/202611010001_device_notifications.sql',import.meta.url),'utf8');
const key=createECDH('prime256v1');key.generateKeys();
const input={subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/fixture-one',keys:{p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}},sound:true,language:'fr'};
test('private push storage enforces ownership, quotas, test limits, durable deduplication and lease completion',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
      CREATE TABLE public."user"(id text PRIMARY KEY);INSERT INTO public."user" VALUES('alice'),('bob');
      CREATE TABLE public.audit_log(id text PRIMARY KEY,action text,created_date text,extra_data jsonb);`);
    const store=createPushStore(postgresAdapter(db));assert.equal(await store.ready(),false);await db.exec(migration);assert.equal(await store.ready(),true);
    const context={user:{id:'alice',role:'admin'}},device=await store.subscribe(context,input);
    assert.equal((await store.subscribe(context,input)).id,device.id,'retry keeps device identity and enrollment date');
    assert.equal((await store.list('alice')).length,1);assert.equal((await store.list('bob')).length,0);
    assert.ok(!(await store.list('alice'))[0].subscription,'endpoint and encryption keys never leave the store');
    await assert.rejects(store.subscribe({user:{id:'bob',role:'admin'}},input),/another account/);
    await assert.rejects(store.preferences('bob',{deviceId:device.id,sound:false,language:'en'}),/not found/);
    await assert.rejects(store.remove('bob',device.id),/not found/);
    await store.preferences('alice',{deviceId:device.id,sound:false,language:'en'});assert.equal((await store.device(device.id)).sound,false);
    await store.reserveTest('alice',device.id);await assert.rejects(store.reserveTest('alice',device.id),/one minute/);
    for(let i=2;i<=5;i++)await store.subscribe(context,{...input,subscription:{...input.subscription,endpoint:input.subscription.endpoint+i}});
    await assert.rejects(store.subscribe(context,{...input,subscription:{...input.subscription,endpoint:input.subscription.endpoint+'six'}}),/Five devices/);
    await db.query(`INSERT INTO public.audit_log VALUES
      ('FN-live','fermentation_notification',$1,'{"audit_source":"server_verified"}'),
      ('FN-forged','fermentation_notification',$1,'{"audit_source":"client_reported"}'),
      ('FN-old','fermentation_notification',$2,'{"audit_source":"server_verified"}');`,[new Date().toISOString(),new Date(Date.now()-7200000).toISOString()]);
    await store.enqueue();await store.enqueue();let jobs=await store.claim();assert.equal(jobs.length,5);assert.ok(jobs.every(j=>j.notification_id==='FN-live'));
    assert.equal((await store.claim()).length,0,'another worker cannot claim an active lease');
    await store.finish({...jobs[0],lease:randomUUID()},'sent');assert.equal((await db.query('SELECT status FROM erp_private.device_push_deliveries WHERE id=$1',[jobs[0].id])).rows[0].status,'sending');
    await store.finish(jobs[0],'sent');await store.finish(jobs[1],'pending',0);assert.equal((await store.claim()).length,1);
    await db.exec("UPDATE erp_private.device_push_deliveries SET locked_until=now()-interval '1 second' WHERE status='sending'");jobs=await store.claim();assert.ok(jobs.length>0);assert.ok(jobs.every(j=>j.attempts>=2));
    const privileges=await db.query("SELECT has_table_privilege('authenticated','erp_private.device_push_subscriptions','SELECT') AS allowed");assert.equal(privileges.rows[0].allowed,false);
    await store.disable(device.id);assert.deepEqual((await store.device(device.id)).subscription,{});
    await store.subscribe(context,input);assert.equal((await store.device(device.id)).revision,2);
    await store.remove('alice',device.id);assert.equal(await store.device(device.id),undefined);
  }finally{await db.close();}
});
