import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { staffRoleAction } from '../src/server/domain/staff-role-management.js';
import { catalogueFromStored,decorateEmployee } from '../src/server/domain/role-catalogue.js';
import { effectiveRole } from '../src/server/domain/roles.js';
import { guardEmployeeAttribution } from '../src/server/domain/employee-action-access.js';
import { activeStaffRole,assignmentState,roleDefinitions } from '../src/lib/staff-role-assignments.js';
import { businessDate } from '../src/lib/business-date.js';
import { roleHierarchyRank } from '../src/lib/role-organigram.js';
const today=businessDate(),future=new Date(Date.parse(today+'T12:00:00Z')+86400000*30).toISOString().slice(0,10),past='2000-01-01';
const manager={user:{id:'gm-login',role:'admin',full_name:'Manager'},role:'admin'};
const support={id:'worker',full_name:'Factory Worker',role:'productionassistants',status:'active',user_id:'staff-login',base_salary:125000,contract_type:'temporary',start_date:'2026-01-01'};
const profile={key:'productionassistants',label:'Production Assistants',category:'Operations',summary:'Factory support',duties:['Monitor fermentation'],template_role:'employee',modules:['inventory'],module_permissions_version:5};
const stored={revision:0,roles:{productionassistants:profile}};
const assignment=(key,from=today,to='')=>({role_key:key,from_date:from,to_date:to,notes:'Cover shift'});
function fixture(){
  const people=[structuredClone(support)],logs=[];let settings={id:'settings',staff_role_catalogue:structuredClone(stored)};
  const stores={Employee:{get:async id=>structuredClone(people.find(p=>p.id===id)),filter:async(q,sort,limit,skip=0)=>structuredClone(people.slice(skip,skip+limit)),update:async(id,data)=>{const p=people.find(p=>p.id===id);Object.assign(p,structuredClone(data));return structuredClone(p);}},AuditLog:{create:async data=>logs.push(structuredClone(data))}};
  const options={loadSettings:async()=>structuredClone(settings),saveSettings:async(row,data)=>{settings.staff_role_catalogue=structuredClone(data);}};
  return {people,logs,stores,options,settings:()=>settings,call:(body,context=manager)=>staffRoleAction(stores,context,body,options)};
}
const own=f=>({user:{id:support.user_id,role:'user'},employee:f.people[0],role:'employee'});
test('one employee covers Cashier and Warehouse with one identity, salary and active template at a time',async()=>{
  const f=fixture(),result=await f.call({action:'saveDuties',employeeId:'worker',revision:0,assignments:[assignment('cashier'),assignment('warehouse_manager')]});
  assert.equal(result.employee.base_salary,125000);assert.equal(f.people.length,1);
  const switched=await f.call({action:'activate',roleKey:'cashier',revision:1},own(f));assert.equal(switched.active_role,'cashier');
  const decorated=decorateEmployee({role:'user'},f.people[0],catalogueFromStored(f.settings().staff_role_catalogue));
  assert.equal(decorated.role,'productionassistants');assert.equal(effectiveRole({role:'user'},decorated),'cashier');assert.ok(!decorated.allowed_modules.includes('manufacturing'));
  await f.call({action:'activate',roleKey:'warehouse_manager',revision:2},own(f));
  assert.equal(activeStaffRole(f.people[0],catalogueFromStored(stored),today).key,'warehouse_manager');
  assert.ok(f.logs.every(row=>row.user_id===manager.user.id||row.user_id===support.user_id));assert.equal(f.people[0].base_salary,125000);
});
test('date limits are inclusive; scheduled, expired, malformed and revoked duties grant no additional access',async()=>{
  const catalogue=catalogueFromStored(stored),person={...support,staff_active_role:'cashier'};
  for(const row of [assignment('cashier',future),assignment('cashier',past,past),assignment('cashier','2026-02-30')]){
    assert.notEqual(assignmentState(row,today),'active');assert.equal(activeStaffRole({...person,staff_role_assignments:[row]},catalogue,today).key,'productionassistants');
  }
  assert.equal(activeStaffRole({...person,staff_role_assignments:[assignment('cashier',today,today)]},catalogue,today).key,'cashier');
  assert.equal(activeStaffRole({...person,staff_role_assignments:[]},catalogue,today).key,'productionassistants');
});
test('only GM assigns duties; staff cannot switch someone else and GM cannot impersonate staff',async()=>{
  const f=fixture();await assert.rejects(f.call({action:'saveDuties',employeeId:'worker',revision:0,assignments:[]},own(f)),{status:403});
  await assert.rejects(f.call({action:'activate',employeeId:'other',roleKey:'cashier',revision:0},own(f)),{status:403});
  await assert.rejects(f.call({action:'activate',roleKey:'cashier',revision:0},{...manager,employee:f.people[0]}),{status:403});
  for(const key of ['admin','production_manager','commercial','driver','hotesse','constructor','missing'])await assert.rejects(f.call({action:'saveDuties',employeeId:'worker',revision:0,assignments:[assignment(key)]}));
  f.people[0].status='suspended';await assert.rejects(f.call({action:'activate',roleKey:'productionassistants',revision:0},own(f)),{status:403});assert.equal(f.logs.length,0);
});
test('stale saves, duplicate assignments and reversed dates cannot change staff records',async()=>{
  const f=fixture();for(const duties of [[assignment('cashier'),assignment('cashier')],[assignment('cashier',future,today)]])await assert.rejects(f.call({action:'saveDuties',employeeId:'worker',revision:0,assignments:duties}));
  await f.call({action:'saveDuties',employeeId:'worker',revision:0,assignments:[]});const before=structuredClone(f.people);
  await assert.rejects(f.call({action:'saveDuties',employeeId:'worker',revision:0,assignments:[assignment('cashier')]}),{status:409});assert.deepEqual(f.people,before);
});
test('role deletion blocks primary aliases, inactive staff, future duties and dependencies beyond 200 records',async()=>{
  for(const reference of [{role:'warehouse manager',status:'terminated'},{role:'productionassistants',staff_role_assignments:[assignment('warehouse_manager',future)]}]){
    const f=fixture();f.people.push(...Array.from({length:205},(_,i)=>({...support,id:'copy-'+i})),{...support,id:'last',...reference});
    await assert.rejects(f.call({action:'deleteRole',roleKey:'warehouse_manager',revision:0,reason:'Consolidate'}),{status:409});assert.equal(f.logs.length,0);
  }
});
test('deleting an unused default role persists through merges while retaining staff, salaries and history',async()=>{
  const f=fixture();f.people[0].staff_role_assignments=[assignment('driver',past,past)];const before=structuredClone(f.people);
  const {catalogue}=await f.call({action:'deleteRole',roleKey:'driver',revision:0,reason:'No longer needed'});
  assert.equal(catalogue.roles.driver,undefined);assert.ok(!roleDefinitions(catalogue,[{key:'driver',label:'Driver'}]).some(r=>r.key==='driver'));assert.deepEqual(f.people,before);
  assert.equal(f.settings().staff_role_catalogue.deleted_role_profiles.driver.reason,'No longer needed');assert.equal(f.logs[0].user_id,'gm-login');
  await assert.rejects(f.call({action:'deleteRole',roleKey:'admin',revision:1,reason:'Remove'}),{status:403});
  await assert.rejects(f.call({action:'deleteRole',roleKey:'cashier',revision:0,reason:'Stale'}),{status:409});
});
test('new role keys cannot overwrite an existing role; deleting and explicitly recreating a role is supported',async()=>{
  const f=fixture();await assert.rejects(f.call({action:'saveRole',profile,revision:0,create:true}),{status:409});
  await f.call({action:'deleteRole',roleKey:'driver',revision:0,reason:'Replace role'});
  const p={key:'driver',label:'Driver',category:'Operations',summary:'Deliveries',duties:[],template_role:'driver',modules:['distribution']};
  const saved=await f.call({action:'saveRole',profile:p,revision:1,create:true});assert.ok(saved.catalogue.roles.driver);assert.ok(!saved.catalogue.deleted_roles.includes('driver'));
});
test('term-contract extensions preserve salary, staff identity and status and require a later date and reason',async()=>{
  const f=fixture();f.people[0].staff_contract_end=today;
  for(const body of [{until:today,reason:'Renew'},{until:future,reason:''},{until:'2026-02-30',reason:'Renew'}])await assert.rejects(f.call({action:'renewContract',employeeId:'worker',revision:0,...body}));
  const {employee}=await f.call({action:'renewContract',employeeId:'worker',revision:0,until:future,reason:'Continue outlet coverage'});
  assert.equal(employee.staff_contract_end,future);assert.equal(employee.base_salary,125000);assert.equal(employee.id,'worker');assert.equal(employee.status,'active');assert.equal(f.logs[0].reason,'Continue outlet coverage');
});
test('generic entity writes cannot forge duty, contract or catalogue metadata, including by GM',()=>{
  for(const [entity,data] of [['Employee',{staff_role_assignments:[]}],['Employee',{staff_active_role:'cashier'}],['Employee',{staff_contract_end:future}],['CompanySettings',{staff_role_catalogue:{roles:{}}}]])assert.throws(()=>guardEmployeeAttribution(manager,entity,'update',data,support),{status:403});
  assert.doesNotThrow(()=>guardEmployeeAttribution(manager,'Employee','update',{phone:'600000000'},support));
});
test('Hotesse and custom outlet roles follow every other employee tier',()=>{
  assert.ok(roleHierarchyRank({key:'hotesse'})>roleHierarchyRank({key:'employee'}));assert.equal(roleHierarchyRank({key:'outlethelper',template_role:'hotesse',category:'Commercial'}),1000);
});

let route;
async function routeFixture(){
  const db=new PGlite();await db.exec('CREATE TABLE company_settings(id text PRIMARY KEY,created_date timestamptz DEFAULT now(),updated_date timestamptz,extra_data jsonb);CREATE TABLE records(kind text,id text,data jsonb,PRIMARY KEY(kind,id));');
  await db.query('INSERT INTO company_settings(id,extra_data) VALUES ($1,$2)', ['settings',{staff_role_catalogue:stored}]);await db.query('INSERT INTO records VALUES ($1,$2,$3)',['Employee','worker',support]);
  let current=db;const state={context:manager,failAudit:false};
  state.db=()=>({unsafe:async(sql,args=[])=>{const result=await current.query(sql.replaceAll('$1::text::jsonb','$1::jsonb'),args);return result.rows;}});
  state.transaction=fn=>db.transaction(async tx=>{current=tx;try{return await fn();}finally{current=db;}});
  state.stores=Object.fromEntries(['Employee','AuditLog'].map(kind=>[kind,{
    get:async id=>(await current.query('SELECT data FROM records WHERE kind=$1 AND id=$2',[kind,id])).rows[0]?.data,
    filter:async(q,sort,limit,skip=0)=>(await current.query('SELECT data FROM records WHERE kind=$1 ORDER BY id LIMIT $2 OFFSET $3',[kind,limit,skip])).rows.map(r=>r.data),
    update:async(id,value)=>(await current.query('UPDATE records SET data=data || $3::jsonb WHERE kind=$1 AND id=$2 RETURNING data',[kind,id,value])).rows[0].data,
    create:async value=>{if(kind==='AuditLog'&&state.failAudit)throw Error('Fixture audit failure');return(await current.query('INSERT INTO records VALUES ($1,$2,$3) RETURNING data',[kind,crypto.randomUUID(),value])).rows[0].data;},
  }]));
  if(!route){const mocks={
    '@/server/auth':`export const authenticateRequest=async()=>globalThis.__staffRolesHTTP.context;export const checkOrigin=request=>{if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw Object.assign(Error('Origin rejected'),{status:403});};export const apiError=error=>Response.json({error:error.message},{status:error.status||400});`,
    '@/server/entities':`export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__staffRolesHTTP.stores[key]});`,
    '@/server/db':`export const database=()=>globalThis.__staffRolesHTTP.db();export const transaction=fn=>globalThis.__staffRolesHTTP.transaction(fn);`,
  };const out=await build({entryPoints:['src/app/api/staff/roles/route.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'transport-fixture',setup(b){b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});route=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));}
  const post=async(body,origin)=>{globalThis.__staffRolesHTTP=state;return route.POST(new Request('http://localhost/api/staff/roles',{method:'POST',headers:origin?{origin}:{},body:JSON.stringify(body)}));};
  return {state,db,post};
}
test('actual HTTP transaction rolls staff and catalogue writes back if audit fails and rejects cross-origin requests',async()=>{
  const f=await routeFixture();try{
    f.state.failAudit=true;const duties={action:'saveDuties',employeeId:'worker',revision:0,assignments:[assignment('cashier')]};
    assert.equal((await f.post(duties)).status,400);assert.deepEqual(await f.state.stores.Employee.get('worker'),support);
    assert.equal((await f.post({action:'deleteRole',roleKey:'driver',revision:0,reason:'Unused'})).status,400);assert.equal((await f.db.query('SELECT extra_data FROM company_settings')).rows[0].extra_data.staff_role_catalogue.revision,0);
    assert.equal((await f.post(duties,'https://other.example')).status,403);f.state.failAudit=false;
    assert.equal((await f.post(duties)).status,200);assert.equal((await f.post(duties)).status,409);
    f.state.context={user:{id:support.user_id,role:'user'},role:'employee',employee:{...support}};
    assert.equal((await f.post({action:'activate',roleKey:'cashier',revision:1})).status,200);assert.equal((await f.post({action:'activate',roleKey:'warehouse_manager',revision:1})).status,409);
  }finally{delete globalThis.__staffRolesHTTP;await f.db.close();}
});
test('simultaneous duty saves accept one revision and reject the stale competing write',async()=>{
  const f=await routeFixture();try{
    const responses=await Promise.all(['cashier','warehouse_manager'].map(key=>f.post({action:'saveDuties',employeeId:'worker',revision:0,assignments:[assignment(key)]})));
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const employee=await f.state.stores.Employee.get('worker');assert.equal(employee.staff_roles_revision,1);assert.equal(employee.staff_role_assignments.length,1);
    const audits=(await f.db.query("SELECT data FROM records WHERE kind='AuditLog'")).rows;assert.equal(audits.length,1);
  }finally{delete globalThis.__staffRolesHTTP;await f.db.close();}
});
