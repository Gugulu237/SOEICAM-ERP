import test from 'node:test';
import assert from 'node:assert/strict';
import {permitsWorkspace,workspacePath,employeeReportPath} from '../src/lib/workspace-navigation.js';
import {moduleForPath,catalogueFromStored,assertModule} from '../src/server/domain/role-catalogue.js';
import {canOpenFieldPath} from '../src/lib/permissions.js';
import {qualityPath} from '../src/lib/quality-workspace.js';
import {employeeWorkspaceAction} from '../src/server/domain/employee-workspace.js';
import {fixture,fieldHandler,request,staff,user} from './helpers/commercial-supply.mjs';
import {businessDate} from '../src/lib/business-date.js';

test('Manufacturing permits quality-only access at the root without granting recipes or order entry',()=>{
 const modules=['quality'];
 assert.equal(workspacePath('/manufacturing',modules),'/manufacturing?section=quality');
 assert.equal(permitsWorkspace('/manufacturing',modules),true);
 assert.equal(permitsWorkspace('/manufacturing?section=quality&quality=expiry',modules),true);
 for(const path of ['/manufacturing/new','/manufacturing/recipes/new','/manufacturing?section=recipes','/manufacturing/order-id?section=quality'])assert.equal(permitsWorkspace(path,modules),false,path);
 assert.equal(permitsWorkspace('/manufacturing?section=quality',['manufacturing']),false);
 assert.equal(moduleForPath(qualityPath('traceability',{batch:'B / 1',product:'p'})),'quality');
 assert.equal(permitsWorkspace('/manufacturing',[]),false);
});

test('Customers is the permitted commercial route and its legacy alias uses the same module',()=>{
 for(const path of ['/customers','/customers/new','/field-customers']){
  assert.equal(canOpenFieldPath('commercial',path),true);
  assert.equal(moduleForPath(path),'customers');
  assert.equal(permitsWorkspace(path,['customers']),true);
  assert.equal(permitsWorkspace(path,['commercial']),false);
 }
 for(const role of ['driver','hotesse','cashier'])assert.equal(canOpenFieldPath(role,'/customers'),false);
 const path=employeeReportPath('commercial','worker / A');
 const url=new URL(path,'http://localhost');
 assert.equal(url.pathname,'/team-workspaces');assert.equal(url.searchParams.get('section'),'reports');assert.equal(url.searchParams.get('employee'),'worker / A');
 assert.equal(canOpenFieldPath('commercial',url.pathname),false);
});

test('customer-only commercial access reads its own customers and cannot select another employee',async()=>{
 const handler=await fieldHandler(),f=fixture();
 Object.assign(f.tables.Customer[0],{acquired_by_id:staff.id,salesperson_id:staff.id});
 f.tables.Customer.push({id:'private-other',business_name:'Other staff customer',acquired_by_id:'another-agent'});
 f.client.auth.assertModule=module=>assertModule({role:'commercial',employee:{...staff,allowed_modules:['customers']}},module);
 globalThis.__dailySupplyClient=f.client;
 try{
  const response=await handler(request({action:'fieldCustomers'}));assert.equal(response.status,200);
  assert.deepEqual((await response.json()).customers.map(row=>row.id),['customer-a']);
  assert.equal((await handler(request({action:'fieldCustomers',commercialId:'another-agent'}))).status,400);
  f.client.auth.assertModule=module=>assertModule({role:'commercial',employee:{...staff,allowed_modules:['commercial']}},module);
  assert.equal((await handler(request({action:'fieldCustomers'}))).status,403);
 }finally{delete globalThis.__dailySupplyClient;}
});

test('GM acquisition verification uses Customers permission and preserves the actual reviewer',async()=>{
 const handler=await fieldHandler(),f=fixture(),gm={id:'gm-login',role:'admin',full_name:'GM'};
 Object.assign(f.tables.Customer[0],{acquired_by_id:staff.id,acquisition_verified:'pending'});
 f.client.auth.me=async()=>gm;f.client.entities.Employee.filter=async()=>[];
 f.client.auth.assertModule=module=>assertModule({role:'admin',roleCatalogue:{roles:{admin:{modules:['customers','employees','admin']}}}},module);
 globalThis.__dailySupplyClient=f.client;
 try{
  const response=await handler(request({action:'verifyFieldCustomer',customerId:'customer-a',status:'verified_unique',notes:'Confirmed original acquisition'}));
  assert.equal(response.status,200);
  assert.equal(f.tables.Customer[0].acquisition_verified_by,gm.id);
  assert.equal(f.tables.Customer[0].acquired_by_id,staff.id);
  assert.equal(f.tables.AuditLog.at(-1).user_id,gm.id);
  assert.equal(f.tables.JournalEntry.length,0);
 }finally{delete globalThis.__dailySupplyClient;}
});

test('GM can review every supported staff template without writing records or taking over their identity',async()=>{
 const catalogue=catalogueFromStored(null),people=Object.values(catalogue.roles).filter(r=>r.key!=='admin').map(role=>({id:'worker-'+role.key,full_name:role.label,role:role.key,status:'active'}));
 const reads=[],stores=new Proxy({Employee:{filter:async()=>people,get:async id=>people.find(p=>p.id===id)}},{get:(target,name)=>target[name] || {filter:async query=>{reads.push({name,query});return [];}}});
 const client={auth:{roleCatalogue:async()=>catalogue},entities:{Employee:{filter:async()=>[]}},asServiceRole:{entities:stores}};
 for(const person of people){const result=await employeeWorkspaceAction(client,{id:'gm',role:'admin'},{action:'employeeDashboard',mode:person.role,employeeId:person.id});assert.equal(result.employee.id,person.id);assert.equal(result.choices.length,1);}
 assert.equal(people.length,Object.keys(catalogue.roles).length-1);
 assert.ok(reads.length>0);
 assert.equal(people.every(p=>p.status==='active'),true);
});

test('rotated duties are listed and validated by the same active-role rule',async()=>{
 const catalogue=catalogueFromStored(null),today=businessDate(),person={id:'rotating-worker',full_name:'Rotating staff',role:'employee',status:'active',staff_active_role:'procurement',staff_role_assignments:[{role_key:'procurement',from_date:today,to_date:'',notes:''}]};
 const stores=new Proxy({Employee:{filter:async()=>[person],get:async()=>person}},{get:(target,name)=>target[name] || {filter:async()=>[]}});
 const client={auth:{roleCatalogue:async()=>catalogue},entities:{Employee:{filter:async()=>[]}},asServiceRole:{entities:stores}};
 const result=await employeeWorkspaceAction(client,{id:'gm',role:'admin'},{action:'employeeDashboard',mode:'procurement',employeeId:person.id});
 assert.deepEqual(result.choices,[{id:person.id,full_name:person.full_name,status:'active'}]);
 await assert.rejects(employeeWorkspaceAction(client,{id:'gm',role:'admin'},{action:'employeeDashboard',mode:'employee',employeeId:person.id}),/matching role/);
 assert.equal(person.staff_active_role,'procurement');
});
