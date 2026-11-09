import test from 'node:test';
import assert from 'node:assert/strict';
import {guardMutation} from '../src/server/access.js';
import {guardEmployeeAttribution} from '../src/server/domain/employee-action-access.js';
import {companyProfileAction} from '../src/server/domain/company-profile.js';

const context={user:{id:'gm',role:'admin'},role:'admin'};
test('linked customer contact edits preserve protected acquisition evidence without making the customer read-only',()=>{
 for(const marker of [{customer_acquisition_assignment_id:'CAA-event',customer_acquisition_assignment_policy:'reviewed-customer-acquisition-v1'},{customer_acquisition_registration_backfill:{id:'CRB-event',policy:'verified-registrar-employee-link-v1'}}]){
  const customer={id:'customer',business_name:'Before',phone:'699000000',address:'Before address',acquired_by_id:'agent',registered_employee_id:'registrar',...marker},before=structuredClone(customer);
  for(const payload of [{phone:'699111111'},{business_name:'Updated customer name'},{address:'Updated delivery address'}])assert.doesNotThrow(()=>guardMutation(context,'Customer','update',payload,customer));
  assert.deepEqual(customer,before);
  for(const operation of ['delete','deleteMany'])assert.throws(()=>guardMutation(context,'Customer',operation,{},customer),{status:403});
  for(const payload of [{customer_acquisition_assignment_id:'forged'},{customer_acquisition_registration_backfill:null},{customer_acquisition_new_proof:'forged'}])for(const operation of ['create','update'])assert.throws(()=>guardMutation(context,'Customer',operation,payload,operation==='update'?customer:null),{status:403});
  for(const payload of [{acquired_by_id:'another-agent'},{registered_employee_id:'another-registrar'}])assert.throws(()=>guardEmployeeAttribution(context,'Customer','update',payload,customer),{status:403});
 }
});
test('acquisition audit and retry evidence remains wholly immutable and cannot be forged by generic callers',()=>{
 const existing={id:'CAA-event',customer_acquisition_assignment:{customer_id:'customer',employee_id:'agent'}};
 for(const operation of ['update','delete','deleteMany'])assert.throws(()=>guardMutation(context,'AuditLog',operation,{description:'Alter evidence'},existing),{status:403});
 for(const payload of [{customer_acquisition_assignment:{id:'forged'}},{id:'CAA-forged'}])assert.throws(()=>guardMutation(context,'AuditLog','create',payload,null),{status:403});
 assert.throws(()=>guardMutation(context,'AuditLog','update',{description:'Alter ordinary audit'},{id:'ordinary-event'}),{status:403});
});
test('activated company settings allow ordinary settings updates while legal changes retain their checked profile workflow',async()=>{
 const existing={id:'settings',company_name:'Original company',default_language:'fr',centralized_inventory:{enabled:true,policy:'central-company-stock-v1',activation_id:'CIA-event'}},before=structuredClone(existing);
 assert.doesNotThrow(()=>guardMutation(context,'CompanySettings','update',{display_density:'compact'},existing));
 for(const payload of [{company_name:'Updated company'},{default_language:'en'}])assert.throws(()=>guardMutation(context,'CompanySettings','update',payload,existing),/Manage legal, fiscal and language details through Administration company settings/);
 for(const operation of ['create','delete','deleteMany','updateMany'])assert.throws(()=>guardMutation(context,'CompanySettings',operation,{},existing),{status:403});
 for(const payload of [{centralized_inventory:null},{central_inventory_pool:'forged'},{centralized_inventory_activation_id:'forged'},{central_degustation_id:'forged'}])assert.throws(()=>guardMutation(context,'CompanySettings','update',payload,existing),{status:403});
 for(const entity of ['AuditLog','Warehouse','StockMovement','StockBalance'])for(const operation of ['update','delete'])assert.throws(()=>guardMutation(context,entity,operation,{name:'Alter control evidence'},{id:'evidence',central_inventory_pool:true}),{status:403});
 assert.deepEqual(existing,before);
 const saved=structuredClone(existing),audits=[];
 const stores={CompanySettings:{filter:async()=>[structuredClone(saved)],update:async(id,value)=>{assert.equal(id,existing.id);Object.assign(saved,value);return structuredClone(saved);}},AuditLog:{create:async value=>{audits.push(value);return value;}}};
 const profile={company_name:'Updated company',currency:'XAF',timezone:'Africa/Douala',fiscal_year_start_month:1,default_language:'en',document_language:'en',additional_registrations:[]};
 const result=await companyProfileAction(stores,context,{revision:0,profile});
 assert.equal(result.company_name,'Updated company');assert.equal(result.default_language,'en');assert.equal(result.revision,1);
 assert.deepEqual(saved.centralized_inventory,before.centralized_inventory);assert.equal(audits.length,1);
});
