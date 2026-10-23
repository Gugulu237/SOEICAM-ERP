import { employeeRemoved } from './employee-lifecycle.js';
import { normalizeRole } from '../server/domain/roles.js';

// Extra duties belong to the same staff/payroll identity. They never combine permissions.
export const SHARED_DUTY_TEMPLATES = ['employee','warehouse_manager','procurement','cashier'];
export const roleKeyValid = key => typeof key==='string' && /^[a-z][a-z0-9_]{2,39}$/.test(key) && !['constructor','prototype','__proto__'].includes(key);
export const primaryRoleKey = employee => normalizeRole(employee?.role) || employee?.role;
export const validStaffDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
export const deletedRoleKeys = catalogue => new Set(Array.isArray(catalogue?.deleted_roles)?catalogue.deleted_roles.filter(roleKeyValid):[]);
export const staffRoleProfile = (catalogue,key) => roleKeyValid(key)&&Object.hasOwn(catalogue?.roles || {},key)?catalogue.roles[key]:null;
export function roleDefinitions(catalogue,defaults=[]) {
  const deleted=deletedRoleKeys(catalogue),byKey=new Map(defaults.filter(r=>!deleted.has(r.key)).map(r=>[r.key,{...r,...staffRoleProfile(catalogue,r.key)}]));
  for(const role of Object.values(catalogue?.roles || {}))if(roleKeyValid(role?.key)&&!deleted.has(role.key))byKey.set(role.key,{...byKey.get(role.key),...role});
  return [...byKey.values()];
}
export function assignmentState(assignment,today) {
  if(!assignment || !roleKeyValid(assignment.role_key) || !validStaffDate(assignment.from_date) || assignment.to_date && !validStaffDate(assignment.to_date))return 'invalid';
  if(assignment.to_date && assignment.to_date<assignment.from_date)return 'invalid';
  return today<assignment.from_date?'scheduled':assignment.to_date && today>assignment.to_date?'ended':'active';
}
export const dutyAssignments = employee => Array.isArray(employee?.staff_role_assignments)?employee.staff_role_assignments:[];
export function occupiesRole(employee,key,today) {
  return !employeeRemoved(employee) && (primaryRoleKey(employee)===key || dutyAssignments(employee).some(a=>a.role_key===key && ['active','scheduled'].includes(assignmentState(a,today))));
}
export function selectableStaffRoles(employee,catalogue,today) {
  const primary=staffRoleProfile(catalogue,primaryRoleKey(employee)),result=primary?[primary]:[];
  if(employee?.status!=='active' || !primary || !SHARED_DUTY_TEMPLATES.includes(primary.template_role))return result;
  for(const a of dutyAssignments(employee)) {
    const profile=staffRoleProfile(catalogue,a.role_key);
    if(assignmentState(a,today)==='active' && profile && SHARED_DUTY_TEMPLATES.includes(profile.template_role) && !result.some(r=>r.key===profile.key))result.push(profile);
  }
  return result;
}
export function activeStaffRole(employee,catalogue,today) {
  return selectableStaffRoles(employee,catalogue,today).find(r=>r.key===employee?.staff_active_role) || staffRoleProfile(catalogue,primaryRoleKey(employee));
}
export function validateDutyAssignments(input,employee,catalogue) {
  const primary=staffRoleProfile(catalogue,primaryRoleKey(employee));
  if(!Array.isArray(input) || input.length>12)throw Error('Assign up to twelve additional duties.');
  if(input.length && (!primary || !SHARED_DUTY_TEMPLATES.includes(primary.template_role)))throw Error('Shared duties are available for factory support, warehouse, purchasing and cashier staff. Management and field roles keep their dedicated accounts.');
  const keys=new Set();
  return input.map(row=>{
    const profile=staffRoleProfile(catalogue,row?.role_key);
    if(!profile || row.role_key===primaryRoleKey(employee) || keys.has(row.role_key) || !SHARED_DUTY_TEMPLATES.includes(profile.template_role))throw Error('Choose distinct factory support, warehouse, purchasing or cashier roles, excluding the primary role.');
    keys.add(row.role_key);
    if(!validStaffDate(row.from_date) || row.to_date && !validStaffDate(row.to_date) || row.to_date && row.to_date<row.from_date)throw Error('Enter a valid start and end date for every duty.');
    if(typeof row.notes!=='string' || row.notes.trim().length>500)throw Error('Use duty notes of up to 500 characters.');
    return {role_key:row.role_key,from_date:row.from_date,to_date:row.to_date || '',notes:row.notes.trim()};
  });
}
