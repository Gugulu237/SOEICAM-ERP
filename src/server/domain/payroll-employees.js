import {createHash} from 'node:crypto';
import {readRecords} from './commercial-workspace.js';
import {catalogueFromStored} from './role-catalogue.js';
import {primaryRoleKey} from '../../lib/staff-role-assignments.js';
import {roleHierarchyRank} from '../../lib/role-organigram.js';

export async function payrollEmployeeData(stores){
  const [employees,settings]=await Promise.all([readRecords(stores.Employee),stores.CompanySettings?stores.CompanySettings.filter({},'created_date',1):[]]);
  const raw=settings[0]?.staff_role_catalogue,catalogue=catalogueFromStored(raw);
  const rows=employees.map(employee=>({employee,snapshot:payrollEmployeeSnapshot(employee,catalogue)}));
  return {rows,byId:new Map(rows.map(row=>[row.employee.id,row])),catalogue};
}
export function payrollEmployeeSnapshot(employee,catalogue){
  const role=primaryRoleKey(employee),profile=catalogue.roles[role],source={name:employee.full_name||'',role,base_salary:Number(employee.base_salary||0),status:employee.status||'',contract_type:employee.contract_type||'',contract_end:employee.staff_contract_end||''};
  return {employee_name:source.name,employee_role:role,employee_role_label:profile?.label||role,employee_role_rank:roleHierarchyRank(profile),employee_source_base_salary:source.base_salary,employee_source_status:source.status,employee_contract_type:source.contract_type,employee_contract_end:source.contract_end,employee_source_fingerprint:createHash('sha256').update(JSON.stringify(source)).digest('hex')};
}
export const employeePayrollChanged=(line,snapshot)=>!!line.employee_source_fingerprint&&line.employee_source_fingerprint!==snapshot?.employee_source_fingerprint;
export const payrollHierarchy=(a,b)=>Number(a.employee_role_rank??100)-Number(b.employee_role_rank??100)||String(a.employee_role_label||'').localeCompare(String(b.employee_role_label||''))||String(a.employee_name||'').localeCompare(String(b.employee_name||''),undefined,{sensitivity:'base',numeric:true})||String(a.employee_id||'').localeCompare(String(b.employee_id||''));
