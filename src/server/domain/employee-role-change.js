import {primaryRoleKey,dutyAssignments,SHARED_DUTY_TEMPLATES,staffRoleProfile} from '../../lib/staff-role-assignments.js';
import {normalizeRole} from './roles.js';

// Profile saves and explicit reassignments share one role transition. The
// employee, payroll and sign-in identities remain attached to the same record.
export function employeeRoleChange(employee,input,catalogue,context,forcePrimary=false){
  if(!Object.hasOwn(input,'role'))return input;
  const role=normalizeRole(input.role)||input.role;
  const profile=staffRoleProfile(catalogue,role);
  if(!profile)throw Error('Choose a configured system role.');
  if(role===primaryRoleKey(employee)&&!forcePrimary)return {...input,role};
  if(context.role!=='admin')throw Object.assign(Error('Only the General Manager may reassign an employee.'),{status:403});
  const assignments=SHARED_DUTY_TEMPLATES.includes(profile.template_role)?dutyAssignments(employee).filter(row=>row.role_key!==role&&SHARED_DUTY_TEMPLATES.includes(staffRoleProfile(catalogue,row.role_key)?.template_role)):[];
  return {...input,role,staff_active_role:role,staff_role_assignments:assignments,staff_roles_revision:Number(employee.staff_roles_revision||0)+1,staff_primary_role_changed_by:context.user.id,staff_primary_role_changed_at:new Date().toISOString()};
}
