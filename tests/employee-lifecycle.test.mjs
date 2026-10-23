import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {employeeLifecycle} from '../src/server/domain/employee-lifecycle.js';
import {assertEmployeeNotRemoved} from '../src/lib/employee-lifecycle.js';
import {occupiesRole} from '../src/lib/staff-role-assignments.js';
import {guardMutation as guardEmployeeAttribution} from '../src/server/access.js';
import {staffRoleAction} from '../src/server/domain/staff-role-management.js';
import {catalogueFromStored} from '../src/server/domain/role-catalogue.js';

const manager={user:{id:'manager-login',role:'admin'},employee:{id:'manager',full_name:'Manager',status:'active',role:'admin'},role:'admin',roleCatalogue:catalogueFromStored(null)};
const worker={id:'worker',user_id:'worker-login',full_name:'Sales Person',status:'active',role:'commercial',base_salary:125000,bank_account:'retained',staff_roles_revision:2};
const input=(extra={})=>({action:'remove',revision:0,reason:'Employee has left the company',requestKey:crypto.randomUUID(),...extra});
async function fixture(db){
  const records={Employee:[structuredClone(worker),structuredClone(manager.employee)],DispatchRequest:[],AuditLog:[],Payroll:[{id:'payroll',employee_id:'worker',gross:125000}],StockMovement:[{id:'sale',commercial_id:'worker',quantity:10}],User:[{id:'worker-login',role:'user'}]};
  if(db){await db.exec('CREATE TABLE lifecycle_records(kind text,id text,data jsonb,PRIMARY KEY(kind,id))');for(const [kind,rows] of Object.entries(records))for(const row of rows)await db.query('INSERT INTO lifecycle_records VALUES($1,$2,$3)',[kind,row.id,row]);}
  const matches=(row,q)=>Object.entries(q).every(([key,value])=>key==='$or'?value.some(branch=>matches(row,branch)):row[key]===value);
  const state={context:structuredClone(manager),failAudit:false};
  const stores=Object.fromEntries(Object.entries(records).map(([kind,rows])=>{
    const list=async()=>db?(await db.query('SELECT data FROM lifecycle_records WHERE kind=$1 ORDER BY id',[kind])).rows.map(r=>r.data):structuredClone(rows);
    return [kind,{list,get:async id=>(await list()).find(r=>r.id===id),filter:async(q,_,limit=200,skip=0)=>(await list()).filter(r=>matches(r,q)).slice(skip,skip+limit),update:async(id,patch)=>{const next={...(await list()).find(r=>r.id===id),...patch};if(db)await db.query('UPDATE lifecycle_records SET data=$3 WHERE kind=$1 AND id=$2',[kind,id,next]);else Object.assign(rows.find(r=>r.id===id),patch);return next;},create:async data=>{if(kind==='AuditLog'&&state.failAudit)throw Error('Audit unavailable');const row={...data,id:data.id||crypto.randomUUID()};if(db)await db.query('INSERT INTO lifecycle_records VALUES($1,$2,$3)',[kind,row.id,row]);else rows.push(row);return row;}}];
  }));
  state.stores=stores;state.db=db;
  return {state,stores,records,call:(body=input(),id='worker',context=state.context)=>employeeLifecycle(context,stores,id,body)};
}
test('removal hides staff and blocks access while preserving identity, salary, payroll and sales references',async()=>{
  const f=await fixture(),body=input(),saved=(await f.call(body)).employee;
  assert.equal(saved.status,'inactive');assert.ok(saved.employee_removed_at);assert.equal(saved.user_id,worker.user_id);assert.equal(saved.base_salary,worker.base_salary);assert.equal(saved.bank_account,'retained');assert.equal(saved.staff_roles_revision,3);
  assert.equal(occupiesRole(saved,'commercial'),false);assert.throws(()=>assertEmployeeNotRemoved(saved),{status:403});
  assert.equal(f.records.Payroll.length,1);assert.equal(f.records.StockMovement[0].commercial_id,'worker');assert.equal(f.records.User.length,1);
  assert.equal(f.records.AuditLog[0].user_id,manager.user.id);assert.equal(f.records.AuditLog[0].reason,body.reason);
  assert.equal((await f.call(body)).reused,true);assert.equal(f.records.AuditLog.length,1);
  await assert.rejects(f.call({...body,reason:'Different reason'}),{status:409});await assert.rejects(f.call(input()),{status:409});
});
test('restore returns an inactive employee, with access blocked until the manager activates the profile',async()=>{
  const f=await fixture();await f.call();const restored=(await f.call(input({action:'restore',revision:1,reason:'Employee returns to work'}))).employee;
  assert.equal(restored.employee_removed_at,null);assert.equal(restored.status,'inactive');assert.equal(restored.employee_lifecycle_revision,2);assert.equal(restored.staff_roles_revision,4);
  assert.throws(()=>assertEmployeeNotRemoved(restored),{status:403});assert.doesNotThrow(()=>assertEmployeeNotRemoved({...restored,status:'active'}));assert.equal(f.records.AuditLog.length,2);
  assert.doesNotThrow(()=>guardEmployeeAttribution(manager,'Employee','update',{status:'active'},restored));
});
test('staff, removed managers, self-removal, stale versions and invalid confirmations are refused',async()=>{
  const f=await fixture();await assert.rejects(f.call(input(),'worker',{...manager,role:'commercial'}),{status:403});
  await assert.rejects(f.call(input(),'worker',{...manager,employee:{...manager.employee,employee_removed_at:'now'}}),{status:403});
  await assert.rejects(f.call(input(),'manager'),/own employee/);
  for(const patch of [{revision:1},{requestKey:'bad'},{reason:'x'},{action:'delete'},{revision:-1}])await assert.rejects(f.call(input(patch)));
  assert.equal(f.records.AuditLog.length,0);assert.equal((await f.stores.Employee.get('worker')).status,'active');
});
test('the last active General Manager cannot be removed, including aliased role names',async()=>{
  const f=await fixture();await f.stores.Employee.update('manager',{status:'inactive'});await f.stores.Employee.update('worker',{role:'general manager'});
  await assert.rejects(f.call(),/at least one active General Manager/);await f.stores.Employee.create({id:'other-gm',role:'admin',status:'active'});assert.ok((await f.call()).employee.employee_removed_at);
});
test('active delivery runs block removal until closed; completed historical runs remain',async()=>{
  const f=await fixture();await f.stores.DispatchRequest.create({id:'run',commercial_id:'worker',status:'departed'});await assert.rejects(f.call(),/active delivery runs/);
  await f.stores.DispatchRequest.update('run',{status:'completed'});await f.call();assert.equal(f.records.DispatchRequest.length,1);
});
test('generic deletes, forged removal metadata and edits to removed employees cannot bypass the workflow',async()=>{
  const f=await fixture();for(const operation of ['delete','deleteMany'])assert.throws(()=>guardEmployeeAttribution(manager,'Employee',operation,{},worker),{status:403});
  for(const data of [{employee_removed_at:null},{employee_restored_at:'now'},{employee_removal_reason:'fake'},{employee_lifecycle_revision:0}])assert.throws(()=>guardEmployeeAttribution(manager,'Employee','update',data,worker),{status:403});
  const saved=(await f.call()).employee;assert.throws(()=>guardEmployeeAttribution(manager,'Employee','update',{status:'active'},saved),{status:403});
  const options={loadSettings:async()=>({staff_role_catalogue:{}}),saveSettings:async()=>{}};
  await assert.rejects(staffRoleAction(f.stores,manager,{action:'changePrimaryRole',employeeId:'worker',roleKey:'driver',revision:3,reason:'Bypass'},options),{status:403});
});
let route;
async function routeModule(){
  if(route)return route;
  const mocks={
    '@/server/auth':`export const authenticateRequest=async()=>globalThis.__employeeLifecycle.context,checkOrigin=r=>{if(r.headers.get('origin')&&r.headers.get('origin')!==new URL(r.url).origin)throw Object.assign(Error('Origin rejected'),{status:403});},apiError=e=>Response.json({error:e.message},{status:e.status||400});`,
    '@/server/entities':`export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__employeeLifecycle.stores[key]});`,
    '@/server/db':`export const transaction=async fn=>{const db=globalThis.__employeeLifecycle.db;await db.exec('BEGIN');try{const value=await fn();await db.exec('COMMIT');return value;}catch(e){await db.exec('ROLLBACK');throw e;}};`,
  };
  const result=await build({entryPoints:['src/app/api/admin/employees/[id]/lifecycle/route.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'employee-lifecycle-http',setup(b){b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
  route=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));return route;
}
test('HTTP removal and its audit commit together, with origin and GM checks and safe retry',async()=>{
  const db=new PGlite();try{
    const f=await fixture(db),api=await routeModule();globalThis.__employeeLifecycle=f.state;const body=input();
    const post=(origin='http://localhost')=>api.POST(new Request('http://localhost/api/admin/employees/worker/lifecycle',{method:'POST',headers:{origin},body:JSON.stringify(body)}),{params:Promise.resolve({id:'worker'})});
    assert.equal((await post('https://other.test')).status,403);f.state.context={...manager,role:'cashier'};assert.equal((await post()).status,403);f.state.context=manager;
    f.state.failAudit=true;assert.equal((await post()).status,400);assert.equal((await f.stores.Employee.get('worker')).status,'active');assert.equal((await f.stores.AuditLog.list()).length,0);
    f.state.failAudit=false;const response=await post();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await post()).status,200);assert.equal((await f.stores.AuditLog.list()).length,1);
  }finally{delete globalThis.__employeeLifecycle;await db.close();}
});
