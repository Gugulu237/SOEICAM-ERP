import {primaryRoleKey} from '../../lib/staff-role-assignments.js';
import {normalizeRole} from './roles.js';
export function idelleCashierAssignment(employees,catalogue){
  const matches=employees.filter(employee=>String(employee.full_name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/[^a-z]+/).includes('idelle'));
  if(matches.length!==1)throw Error('Idelle must match exactly one employee. No employee account was changed.');
  const employee=matches[0],key=primaryRoleKey(employee),profile=catalogue.roles[key],target=catalogue.roles.cashier;
  if(!target||target.template_role!=='cashier')throw Error('Configure the Cashier role before reassigning Idelle.');
  if(employee.status!=='active')throw Error("Review Idelle's inactive employee record before reassignment.");
  if(key==='cashier')return {employee,target,reused:employee.staff_active_role==='cashier'||!employee.staff_active_role};
  const isWarehouse=key!=='supply_chain_manager'&&(normalizeRole(key)==='warehouse_manager'||profile?.template_role==='warehouse_manager'&&profile.category!=='Management'||/warehouse\s*keeper|store\s*keeper|magasinier/i.test(profile?.label||''));
  if(!isWarehouse)throw Error("Idelle's current role is not Warehouse Keeper. No employee account was changed.");
  return {employee,target,reused:false};
}
