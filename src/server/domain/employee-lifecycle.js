import { createHash } from 'node:crypto';
import { readRecords } from './commercial-workspace.js';
import { employeeRemoved, assertEmployeeNotRemoved } from '../../lib/employee-lifecycle.js';
import { primaryRoleKey, staffRoleProfile } from '../../lib/staff-role-assignments.js';
import { normalizeRole } from './roles.js';

const error=(message,status=400)=>Object.assign(Error(message),{status});
// Called inside the route's serializable transaction. Removal is reversible;
// employee IDs, sign-in bindings and all payroll/transaction history are retained.
export async function employeeLifecycle(context,stores,employeeId,input) {
  assertEmployeeNotRemoved(context.employee);
  if(context.role!=='admin')throw error('Only the General Manager can remove or restore employees.',403);
  if(!input||!['remove','restore'].includes(input.action)||!Number.isSafeInteger(input.revision)||input.revision<0||!/^[a-f0-9-]{36}$/i.test(input.requestKey||''))throw error('Refresh the employee before changing its directory status.');
  const reason=typeof input.reason==='string'?input.reason.trim():'';
  if(reason.length<3||reason.length>1000)throw error('Enter a removal or restoration reason of 3 to 1000 characters.');
  const employee=await stores.Employee.get(employeeId);
  if(!employee)throw error('Employee not found.',404);
  if(context.employee?.id===employee.id||employee.user_id===context.user.id)throw error('You cannot remove your own employee account.');
  const payload=JSON.stringify({employeeId,action:input.action,revision:input.revision,reason});
  const id='employee-lifecycle-'+createHash('sha256').update(context.user.id+':'+input.requestKey).digest('hex');
  const previous=await stores.AuditLog.get(id);
  if(previous){if(previous.employee_lifecycle_payload!==payload)throw error('This confirmation was already used for different employee changes.',409);return {employee:await stores.Employee.get(employeeId),reused:true};}
  if(Number(employee.employee_lifecycle_revision||0)!==input.revision)throw error('This employee changed. Refresh before continuing.',409);
  const removed=employeeRemoved(employee);
  if(input.action==='remove'&&removed||input.action==='restore'&&!removed)throw error(input.action==='remove'?'This employee is already removed.':'This employee is already in the directory.',409);
  if(input.action==='remove') {
    const isGM=row=>normalizeRole(primaryRoleKey(row))==='admin'||staffRoleProfile(context.roleCatalogue || {roles:{}},primaryRoleKey(row))?.template_role==='admin';
    if(isGM(employee)&&employee.status==='active'){
      const others=(await readRecords(stores.Employee,{})).filter(row=>row.id!==employee.id&&!employeeRemoved(row)&&row.status==='active'&&isGM(row));
      if(!others.length)throw error('Keep at least one active General Manager employee.');
    }
    const dispatches=await readRecords(stores.DispatchRequest,{$or:[{driver_id:employee.id},{commercial_id:employee.id}]});
    if(dispatches.some(row=>!['completed','closed','cancelled','rejected','draft'].includes(row.status)))throw error('Close or reassign this employee’s active delivery runs before removal.');
  }
  const at=new Date().toISOString();
  const change=input.action==='remove'
    ? {status:'inactive',employee_removed_at:at,employee_removed_by:context.user.id,employee_removal_reason:reason}
    : {status:'inactive',employee_removed_at:null,employee_removed_by:null,employee_removal_reason:null,employee_restored_at:at,employee_restored_by:context.user.id};
  const saved=await stores.Employee.update(employee.id,{...change,employee_lifecycle_revision:input.revision+1,staff_roles_revision:Number(employee.staff_roles_revision||0)+1});
  await stores.AuditLog.create({id,action:input.action==='remove'?'remove_employee':'restore_employee',module:'employees',entity_type:'Employee',entity_id:employee.id,user_id:context.user.id,user_name:context.employee?.full_name||context.user.full_name||context.user.id,description:`${input.action==='remove'?'Removed':'Restored'} employee ${employee.full_name}`,reason,employee_lifecycle_payload:payload,employee_lifecycle_before:{status:employee.status,removed_at:employee.employee_removed_at||null},employee_lifecycle_after:{status:saved.status,removed_at:saved.employee_removed_at||null}});
  return {employee:saved};
}
