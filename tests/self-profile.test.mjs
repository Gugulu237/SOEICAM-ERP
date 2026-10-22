import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {readSelfProfile,saveSelfProfile} from '../src/server/domain/self-profile.js';
import {canOpenFieldPath} from '../src/lib/permissions.js';
import {moduleForPath} from '../src/server/domain/role-catalogue.js';
import {configureLanguage,getLanguage,readLocalLanguage,setLocalLanguage} from '../src/lib/i18n.js';

async function fixture(db){
  const user={id:'own-user',role:'user',email:'staff@example.test',full_name:'Staff',auth_user_id:'private-identity',preferred_language:'fr'};
  const employee={id:'own-employee',user_id:user.id,role:'driver',status:'active',full_name:'Employment Name',phone:'+237 600000001',base_salary:123456,bank_account:'PRIVATE',job_title:'Driver',allowed_modules:[]};
  const rows={User:[user,{id:'other-user',role:'admin',full_name:'Other'}],Employee:[employee,{id:'other-employee',user_id:'other-user',full_name:'Other',phone:'123'}],AuditLog:[]};
  if(db){await db.exec('CREATE TABLE profile_fixture(kind text,id text,data jsonb,PRIMARY KEY(kind,id))');for(const [kind,records]of Object.entries(rows))for(const row of records)await db.query('INSERT INTO profile_fixture VALUES($1,$2,$3)',[kind,row.id,JSON.stringify(row)]);}
  const stores=Object.fromEntries(Object.entries(rows).map(([kind,records])=>{
    const list=async()=>db?(await db.query('SELECT data FROM profile_fixture WHERE kind=$1 ORDER BY id',[kind])).rows.map(row=>row.data):structuredClone(records);
    return [kind,{
      list,get:async id=>(await list()).find(row=>row.id===id),
      update:async(id,patch)=>{const value={...(await list()).find(row=>row.id===id),...patch};if(db)await db.query('UPDATE profile_fixture SET data=$3 WHERE kind=$1 AND id=$2',[kind,id,JSON.stringify(value)]);else Object.assign(records.find(row=>row.id===id),patch);return structuredClone(value);},
      create:async value=>{const row={...value,id:crypto.randomUUID()};if(db)await db.query('INSERT INTO profile_fixture VALUES($1,$2,$3)',[kind,row.id,JSON.stringify(row)]);else records.push(row);return row;},
    }];
  }));
  return {stores,context:{user,employee,role:'driver'}};
}
const edit=profile=>({display_name:profile.display_name,phone:profile.phone,profile_revision:profile.profile_revision});

test('all employee roles can open their own settings without enabling other modules',async()=>{
  const f=await fixture();
  for(const role of ['admin','cashier','commercial','driver','hotesse','employee','procurement','warehouse_manager','production_manager']){
    assert.equal(canOpenFieldPath(role,'/profile'),true);
    await f.stores.Employee.update(f.context.employee.id,{role});
    const p=await readSelfProfile(f.stores,{...f.context,employee:{...f.context.employee,role}});
    assert.equal(p.id,f.context.user.id);assert.equal(p.phone,'+237 600000001');
    for(const key of ['auth_user_id','base_salary','bank_account','role','user_id','allowed_modules'])assert.equal(Object.hasOwn(p,key),false);
  }
  assert.equal(moduleForPath('/profile'),null);
  assert.equal(canOpenFieldPath('driver','/admin'),false);
});

test('staff edit only their own display name and phone, leaving employment and other accounts intact',async()=>{
  const f=await fixture(),before=await readSelfProfile(f.stores,f.context);
  const result=await saveSelfProfile(f.stores,f.context,{...edit(before),display_name:'  Preferred Name  ',phone:'+237 699000002'});
  assert.equal(result.display_name,'Preferred Name');assert.equal(result.phone,'+237 699000002');
  const employee=await f.stores.Employee.get('own-employee');
  assert.equal(employee.full_name,'Employment Name');assert.equal(employee.base_salary,123456);assert.equal(employee.role,'driver');assert.equal(employee.bank_account,'PRIVATE');
  assert.equal((await f.stores.User.get('own-user')).email,'staff@example.test');assert.equal((await f.stores.Employee.get('other-employee')).phone,'123');
  const logs=await f.stores.AuditLog.list();assert.equal(logs.length,1);assert.equal(logs[0].user_id,'own-user');assert.doesNotMatch(logs[0].description,/699000002|Preferred Name/);
  await saveSelfProfile(f.stores,f.context,{...edit(before),display_name:'Preferred Name',phone:'+237 699000002'});assert.equal((await f.stores.AuditLog.list()).length,1);
});

test('forged identities, privilege changes, invalid data and inactive staff are refused',async()=>{
  const f=await fixture(),p=await readSelfProfile(f.stores,f.context);
  for(const extra of [{user_id:'other-user'},{employee_id:'other-employee'},{role:'admin'},{base_salary:999},{preferred_language:'de'}])await assert.rejects(saveSelfProfile(f.stores,f.context,{...edit(p),...extra}),/Only your/);
  for(const values of [{display_name:''},{display_name:'x'.repeat(121)},{display_name:'bad\nname'},{phone:'javascript:evil'},{phone:'1'},{phone:12},{profile_revision:'wrong'}])await assert.rejects(saveSelfProfile(f.stores,f.context,{...edit(p),...values}));
  await f.stores.Employee.update('own-employee',{status:'suspended'});await assert.rejects(readSelfProfile(f.stores,f.context),{status:403});
  await assert.rejects(readSelfProfile(f.stores,{user:null,employee:null}),{status:401});
});

test('stale contact edits conflict, language changes do not, and a changed staff link is refused',async()=>{
  const f=await fixture(),p=await readSelfProfile(f.stores,f.context);
  await f.stores.User.update('own-user',{preferred_language:'en'});
  await saveSelfProfile(f.stores,f.context,{...edit(p),display_name:'New name'});
  await assert.rejects(saveSelfProfile(f.stores,f.context,{...edit(p),phone:'999'}),{status:409});
  await f.stores.Employee.update('own-employee',{user_id:'other-user'});await assert.rejects(readSelfProfile(f.stores,f.context),{status:403});
});

test('a General Manager without an employee record can save a display name',async()=>{
  const f=await fixture();await f.stores.User.update('own-user',{role:'admin'});const context={user:{...f.context.user,role:'admin'},employee:null,role:'admin'};
  const p=await readSelfProfile(f.stores,context);assert.equal(p.can_edit_phone,false);
  await saveSelfProfile(f.stores,context,{...edit(p),display_name:'Manager'});
  await assert.rejects(saveSelfProfile(f.stores,context,{...edit(p),phone:'123'}),/linked employee/);
});

test('saved company default clears a stale browser language override and accounts remain isolated',()=>{
  const old=globalThis.localStorage,values=new Map();globalThis.localStorage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  try{
    setLocalLanguage('staff-a','en');configureLanguage({userId:'staff-a',preferredLanguage:null,defaultLanguage:'fr'});assert.equal(getLanguage(),'fr');assert.equal(readLocalLanguage('staff-a'),null);
    configureLanguage({userId:'staff-b',preferredLanguage:'en',defaultLanguage:'fr'});assert.equal(getLanguage(),'en');configureLanguage({userId:'staff-a',preferredLanguage:null,defaultLanguage:'fr'});assert.equal(getLanguage(),'fr');assert.equal(readLocalLanguage('staff-b'),'en');
  }finally{globalThis.localStorage=old;configureLanguage();}
});

async function routeModule(){
  const result=await build({entryPoints:['src/app/api/profile/route.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'self-profile-route',setup(b){
    const mocks={
      '@/server/auth':"export const authenticateRequest=async()=>globalThis.__selfProfile.context,checkOrigin=request=>{if(request.headers.get('origin')==='https://other.test')throw Object.assign(Error('Invalid request origin.'),{status:403});},apiError=e=>Response.json({error:e.message},{status:e.status||400});",
      '@/server/entities':"export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__selfProfile.stores[key]});",
      '@/server/db':"export const database=()=>({unsafe:async()=>{}}),transaction=async run=>{const db=globalThis.__selfProfile.db;await db.exec('BEGIN');try{const result=await run();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};",
    };
    b.onResolve({filter:/^@\/server\//},args=>mocks[args.path]?{path:args.path,namespace:'profile-mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'profile-mock'},args=>({contents:mocks[args.path]}));
  }}]});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}

test('profile endpoint rolls back name and phone when auditing fails and supports a checked retry',async()=>{
  const db=new PGlite();
  try{
    const f=await fixture(db),route=await routeModule();globalThis.__selfProfile={...f,db};
    const get=await route.GET();assert.equal(get.headers.get('cache-control'),'private, no-store');const {profile}=await get.json();
    const input={...edit(profile),display_name:'Changed',phone:'699000002'};
    const post=(origin='http://localhost')=>route.POST(new Request('http://localhost/api/profile',{method:'POST',headers:{origin},body:JSON.stringify(input)}));
    assert.equal((await post('https://other.test')).status,403);
    const create=f.stores.AuditLog.create;f.stores.AuditLog.create=async()=>{throw Error('Audit unavailable');};
    assert.equal((await post()).status,400);assert.equal((await f.stores.User.get('own-user')).full_name,'Staff');assert.equal((await f.stores.Employee.get('own-employee')).phone,'+237 600000001');
    f.stores.AuditLog.create=create;assert.equal((await post()).status,200);assert.equal((await post()).status,200);assert.equal((await f.stores.AuditLog.list()).length,1);
  }finally{delete globalThis.__selfProfile;await db.close();}
});
