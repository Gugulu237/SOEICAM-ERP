import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {insertSnapshot} from '../scripts/migration-lib.mjs';
import {postgresAdapter} from './helpers/postgres-adapter.mjs';

let profileRoute;
async function route(){
  if(profileRoute)return profileRoute;
  const output=await build({entryPoints:['src/app/api/auth/me/route.js'],bundle:true,format:'esm',platform:'node',write:false,alias:{'@':resolve('src')},define:{'process.env.CLERK_SECRET_KEY':'"test-only"','process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':'"test-only"'},plugins:[{name:'auth-profile-fixture',setup(b){
    b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'fixture'}));
    b.onResolve({filter:/(?:^|\/)db\.js$/},()=>({path:'db',namespace:'fixture'}));
    b.onResolve({filter:/(?:^|\/)supabase\.js$/},()=>({path:'supabase',namespace:'fixture'}));
    b.onResolve({filter:/(?:^|\/)auth-provider\.js$/},()=>({path:'provider',namespace:'fixture'}));
    b.onResolve({filter:/^@clerk\/nextjs\/server$/},()=>({path:'clerk',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:{
      empty:'',
      db:'export const database=()=>globalThis.__authProfileFixture.db;export const transaction=run=>run();',
      supabase:'export const supabaseServer=async()=>({auth:{getUser:async()=>({data:{user:globalThis.__authProfileFixture.supabaseUser}})}});',
      provider:'export const usesClerk=()=>globalThis.__authProfileFixture.provider==="clerk";',
      clerk:'export const auth=async()=>({userId:"clerk-subject",isAuthenticated:true});export const currentUser=async()=>{globalThis.__authProfileFixture.backendCalls++;return {id:"clerk-subject",primaryEmailAddressId:"primary",emailAddresses:[{id:"primary",emailAddress:"staff@example.test",verification:{status:"verified"}}]};};',
    }[a.path]}));
  }}]});
  return profileRoute=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
}

async function fixture(run){
  const db=new PGlite();
  try{
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
    for(const file of ['202610170001_erp_schema.sql','202610170002_clerk_identities.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    const adapter=postgresAdapter(db),queries=[];
    const state={provider:'supabase',backendCalls:0,supabaseUser:{id:'supabase-subject',email:'staff@example.test',email_confirmed_at:'2026-11-01'},db:{unsafe:async(sql,args)=>{queries.push(sql);return adapter.unsafe(sql,args);}}};
    globalThis.__authProfileFixture=state;
    await insertSnapshot(adapter,{
      User:[{id:'staff-login',email:'staff@example.test',auth_user_id:'supabase-subject',role:'admin'}],
      Employee:[{id:'staff',user_id:'staff-login',role:'cashier',status:'active'}],
      // Language keeps the old id ordering; role catalogue keeps created_date.
      CompanySettings:[{id:'z-old',created_date:'2020-01-01',company_name:'Private Company',default_language:'fr',staff_role_catalogue:{revision:7,roles:{}}},{id:'a-language',created_date:'2021-01-01',company_name:'Private Company',default_language:'en',private_setting:'must-not-be-in-profile'}],
    });
    await db.query("INSERT INTO erp_private.auth_identities(provider,subject,erp_user_id,verified_email) VALUES ('clerk','clerk-subject','staff-login','staff@example.test')");
    await run({db,queries,state,GET:(await route()).GET});
  }finally{delete globalThis.__authProfileFixture;await db.close();}
}

test('Clerk and Supabase profiles read language with fresh auth in one query without returning company settings',async()=>{
  await fixture(async({db,queries,state,GET})=>{
    for(const provider of ['clerk','supabase']){
      state.provider=provider;
      await db.query("UPDATE company_settings SET default_language='en' WHERE id='a-language'");
      await db.query("UPDATE employee SET status='active' WHERE id='staff'");
      queries.length=0;
      const firstResponse=await GET(),first=await firstResponse.json();
      assert.equal(firstResponse.status,200);assert.equal(firstResponse.headers.get('cache-control'),'private, no-store');
      assert.equal(first.company_language,'en');assert.equal(first.staff_access,true);assert.equal(first.employee_profile.id,'staff');
      assert.equal(queries.length,1,'profile reuses the identity read instead of issuing a second settings query');
      assert.match(queries[0],/SELECT default_language FROM public\.company_settings ORDER BY id LIMIT 1/);
      assert.equal(first.auth_user_id,undefined);assert.equal(first.companyLanguage,undefined);assert.equal(first.roleCatalogue,undefined);
      assert.doesNotMatch(JSON.stringify(first),/Private Company|must-not-be-in-profile|private_setting/);
      await db.query("UPDATE company_settings SET default_language='fr' WHERE id='a-language'");
      await db.query("UPDATE employee SET status='suspended' WHERE id='staff'");
      const second=await (await GET()).json();
      assert.equal(second.company_language,'fr');assert.equal(second.staff_access,false);assert.equal(queries.length,2,'language and staff suspension are not cached across requests');
    }
    assert.equal(state.backendCalls,0,'bound Clerk profiles still avoid Backend API calls');
    await db.query('DELETE FROM company_settings');
    for(const provider of ['clerk','supabase']){state.provider=provider;assert.equal((await (await GET()).json()).company_language,'fr');}
  });
});

test('first-time identity linking retains company language for both sign-in providers',async()=>{
  await fixture(async({db,queries,state,GET})=>{
    await db.query('DELETE FROM erp_private.auth_identities');
    await db.query('UPDATE public."user" SET auth_user_id=NULL');
    for(const provider of ['clerk','supabase']){
      state.provider=provider;queries.length=0;
      const response=await GET(),profile=await response.json();
      assert.equal(response.status,200,JSON.stringify(profile));assert.equal(profile.id,'staff-login');assert.equal(profile.company_language,'en');
      const settingsReads=queries.filter(sql=>sql.includes('FROM public.company_settings'));
      assert.equal(settingsReads.length,2,'first login reads settings only in its before/after identity context queries');
      assert.ok(settingsReads.every(sql=>sql.includes('AS company_language')));
      queries.length=0;assert.equal((await (await GET()).json()).company_language,'en');assert.equal(queries.length,1);
    }
    assert.equal(state.backendCalls,1,'only first-time Clerk linking uses the Backend API');
  });
});
