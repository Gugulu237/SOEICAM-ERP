import {assertEmployeeNotRemoved} from '../../lib/employee-lifecycle.js';
import {employeeRoleChange} from './employee-role-change.js';
import { catalogueFromStored,parseStoredRoleCatalogue,validateRoleProfile } from './role-catalogue.js';
import { normalizeOrganigramLayout } from '../../lib/role-organigram.js';
import { activeStaffRole,selectableStaffRoles,validateDutyAssignments,dutyAssignments,validStaffDate,assignmentState,roleKeyValid,primaryRoleKey } from '../../lib/staff-role-assignments.js';
import { businessDate } from '../../lib/business-date.js';

const forbidden=message=>Object.assign(Error(message),{status:403});
const conflict=()=>Object.assign(Error('This record changed. Refresh before saving.'),{status:409});
const at=()=>new Date().toISOString();
const version=value=>{if(!Number.isSafeInteger(value)||value<0)throw Error('Refresh this record before saving.');return value;};
const bounded=(value,label)=>{if(typeof value!=='string'||value.trim().length>500)throw Error('Enter valid '+label+'.');return value.trim();};
async function allEmployees(store){const result=[];for(let skip=0;;skip+=200){const page=await store.filter({},'id',200,skip);if(!Array.isArray(page))throw Error('Could not read all employee records.');result.push(...page);if(page.length<200)return result;}}
const revisionOf=employee=>Number(employee.staff_roles_revision || 0);
function active(context){assertEmployeeNotRemoved(context.employee);if(!context.user || context.employee?.status && context.employee.status!=='active' || context.role!=='admin'&&!context.employee)throw forbidden('An active signed-in staff account is required.');}
async function audit(stores,context,action,entity,id,details={}){await stores.AuditLog.create({action,module:'employees',entity_type:entity,entity_id:id,user_id:context.user.id,user_name:context.employee?.full_name || context.user.full_name || context.user.email || '',actor_employee_id:context.employee?.id || '',audit_source:'server_verified',...details});}
function rawCatalogue(settings){const raw=parseStoredRoleCatalogue(settings.staff_role_catalogue) || {};return {raw,catalogue:catalogueFromStored(raw)};}
export function ownRoleWorkspace(employee,catalogue,today=businessDate()){
  return {employee_id:employee.id,revision:revisionOf(employee),primary_role:primaryRoleKey(employee),active_role:activeStaffRole(employee,catalogue,today)?.key || '',roles:selectableStaffRoles(employee,catalogue,today).map(r=>({key:r.key,label:r.label}))};
}
// The caller wraps all writes and audits in one transaction. All mutations take
// the same company-settings lock before reading employees or checking versions.
export async function staffRoleAction(stores,context,body,{loadSettings,saveSettings}){
  active(context);const today=businessDate();
  if(body.action==='ownRoles' || body.action==='activate'){
    if(!context.employee?.id)throw forbidden('Link your own employee account before switching duties.');
    if(body.employeeId && body.employeeId!==context.employee.id)throw forbidden('You can switch only your own work role. Employee previews remain read only.');
    const settings=await loadSettings(body.action==='activate'),{catalogue}=rawCatalogue(settings);
    const employee=await stores.Employee.get(context.employee.id);
    if(!employee || employee.status!=='active' || !employee.user_id || employee.user_id!==context.user.id)throw forbidden('Use your own active linked staff account.');
    if(body.action==='ownRoles')return ownRoleWorkspace(employee,catalogue,today);
    if(context.role==='admin' || catalogue.roles[primaryRoleKey(employee)]?.template_role==='admin')throw forbidden('The General Manager cannot act through a delegated staff role.');
    if(version(body.revision)!==revisionOf(employee))throw conflict();
    if(!selectableStaffRoles(employee,catalogue,today).some(r=>r.key===body.roleKey))throw forbidden('This work role is unavailable or outside its approved dates.');
    const previous=activeStaffRole(employee,catalogue,today)?.key;
    if(previous===body.roleKey)return {...ownRoleWorkspace(employee,catalogue,today),reused:true};
    const saved=await stores.Employee.update(employee.id,{staff_active_role:body.roleKey,staff_role_activated_at:at(),staff_roles_revision:revisionOf(employee)+1});
    await audit(stores,context,'activate_staff_duty','Employee',employee.id,{description:'Switched own work role',previous_role:previous,active_role:body.roleKey});
    return ownRoleWorkspace(saved,catalogue,today);
  }
  if(context.role!=='admin')throw forbidden('Only the General Manager may manage roles, duties and contracts.');
  const settings=await loadSettings(true),{raw,catalogue}=rawCatalogue(settings);
  if(['saveRole','deleteRole'].includes(body.action)){
    if(version(body.revision)!==catalogue.revision)throw conflict();
    let next;
    if(body.action==='saveRole'){
      const profile=validateRoleProfile(body.profile,catalogue.roles?.[body.profile?.key]);
      if(body.create && Object.hasOwn(catalogue.roles,profile.key))throw Object.assign(Error('This role key already exists. Choose another key.'),{status:409});
      if(!Object.hasOwn(catalogue.roles,profile.key)&&Object.keys(catalogue.roles).length>=40)throw Error('The role catalogue is full.');
      next={...raw,revision:catalogue.revision+1,roles:{...raw.roles,[profile.key]:profile},deleted_roles:(raw.deleted_roles || []).filter(key=>key!==profile.key)};
      next.layout=normalizeOrganigramLayout(Object.values(catalogueFromStored(next).roles),next.layout);
      await saveSettings(settings,next);
      await audit(stores,context,'save_staff_role','CompanySettings',settings.id,{description:'Saved role '+profile.key,role_key:profile.key,previous_profile:catalogue.roles[profile.key] || null,profile,catalogue_revision:next.revision});
    }else{
      const key=body.roleKey;
      if(!roleKeyValid(key) || !Object.hasOwn(catalogue.roles,key))throw Error('Choose an existing role.');
      if(key==='admin')throw forbidden('The General Manager role is protected.');
      const reason=bounded(body.reason,'role deletion reason');if(!reason)throw Error('Explain why this role is being removed.');
      const people=await allEmployees(stores.Employee);
      if(people.some(person=>primaryRoleKey(person)===key || dutyAssignments(person).some(a=>a.role_key===key&&['active','scheduled'].includes(assignmentState(a,today)))))throw Object.assign(Error('Reassign the employees and active or scheduled duties before deleting this role.'),{status:409});
      const roles={...raw.roles};delete roles[key];
      next={...raw,roles,revision:catalogue.revision+1,deleted_roles:[...new Set([...(raw.deleted_roles || []),key])],deleted_role_profiles:{...raw.deleted_role_profiles,[key]:{...catalogue.roles[key],deleted_at:at(),deleted_by:context.user.id,reason}}};
      next.layout=normalizeOrganigramLayout(Object.values(catalogueFromStored(next).roles),next.layout);
      await saveSettings(settings,next);
      await audit(stores,context,'delete_staff_role','CompanySettings',settings.id,{description:'Deleted role '+key,role_key:key,profile:catalogue.roles[key],reason,catalogue_revision:next.revision});
    }
    return {catalogue:catalogueFromStored(next)};
  }
  if(!['saveDuties','renewContract','changePrimaryRole'].includes(body.action))throw Error('Unknown staff role action.');
  const employee=await stores.Employee.get(body.employeeId);if(!employee)throw Error('Employee not found.');assertEmployeeNotRemoved(employee);
  if(body.action==='changePrimaryRole'){
    const target=catalogue.roles[body.roleKey],reason=bounded(body.reason,'reassignment reason');
    if(!target||!reason)throw Error('Choose an existing role and explain the reassignment.');
    if(primaryRoleKey(employee)===target.key&&employee.staff_active_role===target.key)return {employee,reused:true};
    if(version(body.revision)!==revisionOf(employee))throw conflict();
    const input={role:target.key,...(body.useRoleResponsibilities?{job_title:target.label,responsibilities:(target.duties||[]).join('\n')}:{})};
    const saved=await stores.Employee.update(employee.id,employeeRoleChange(employee,input,catalogue,context,true));
    await audit(stores,context,'reassign_primary_staff_role','Employee',employee.id,{description:'Reassigned primary role',previous_role:primaryRoleKey(employee),role_key:target.key,reason});
    return {employee:saved};
  }
  if(version(body.revision)!==revisionOf(employee))throw conflict();
  if(body.action==='saveDuties'){
    const duties=validateDutyAssignments(body.assignments,employee,catalogue);
    const saved=await stores.Employee.update(employee.id,{staff_role_assignments:duties,staff_roles_revision:revisionOf(employee)+1,staff_duties_updated_by:context.user.id,staff_duties_updated_at:at()});
    const activeRole=activeStaffRole(saved,catalogue,today)?.key || primaryRoleKey(saved);
    if(saved.staff_active_role!==activeRole)await stores.Employee.update(saved.id,{staff_active_role:activeRole});
    await audit(stores,context,'assign_staff_duties','Employee',employee.id,{description:'Updated additional duties and rotation dates',primary_role:employee.role,previous_assignments:dutyAssignments(employee),assignments:duties});
    return {employee:await stores.Employee.get(employee.id)};
  }
  const until=body.until,reason=bounded(body.reason,'contract renewal reason');
  if(!employee.contract_type || employee.contract_type==='permanent')throw Error('Choose a term contract before recording an extension.');
  if(!reason || !validStaffDate(until) || until<today || employee.staff_contract_end && until<=employee.staff_contract_end || employee.start_date && until<employee.start_date)throw Error('Enter an extension date after the current contract end and explain the renewal.');
  const saved=await stores.Employee.update(employee.id,{staff_contract_end:until,staff_contract_renewed_at:at(),staff_contract_renewed_by:context.user.id,staff_roles_revision:revisionOf(employee)+1});
  await audit(stores,context,'renew_staff_contract','Employee',employee.id,{description:'Extended term contract',previous_end:employee.staff_contract_end || '',new_end:until,reason});
  return {employee:saved};
}
