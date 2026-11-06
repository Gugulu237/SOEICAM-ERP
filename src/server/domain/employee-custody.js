import {catalogueFromStored} from './role-catalogue.js';
import {activeStaffRole} from '../../lib/staff-role-assignments.js';
import {businessDate} from '../../lib/business-date.js';
import {readRecords} from './commercial-workspace.js';
import {createHash} from 'node:crypto';
import {eligibleStockRecipient} from '../../lib/stock-recipient.js';
export {eligibleStockRecipient,STOCK_RECIPIENT_ROLES} from '../../lib/stock-recipient.js';
export async function stockStaff(stores,rows){
 const settings=stores.CompanySettings?await readRecords(stores.CompanySettings):[],catalogue=catalogueFromStored(settings[0]?.staff_role_catalogue);
 return rows.map(e=>{if(!e)return e;const profile=activeStaffRole(e,catalogue,businessDate());return profile?{...e,access_template:profile.template_role}:{...e,role:'unassigned',access_template:'unassigned'};});
}
export const employeeStockLocationId=id=>'employee-stock-'+createHash('sha256').update(id).digest('hex').slice(0,32);
export function validEmployeeStockLocation(warehouse,employeeId){return Boolean(warehouse&&warehouse.is_active!==false&&warehouse.warehouse_type==='commercial_custody'&&warehouse.employee_delivery_custody===true&&warehouse.custodian_employee_id===employeeId&&!warehouse.vehicle_id);}
// A new empty location cannot accidentally adopt old unreconciled custody.
export async function ensureEmployeeStockLocation(stores,employeeId){
 const [employee]=await stockStaff(stores,[await stores.Employee.get(employeeId)]);
 if(!eligibleStockRecipient(employee))throw Error('Choose an active employee other than Hotesse to receive goods.');
 const id=employeeStockLocationId(employee.id),existing=await stores.Warehouse.get(id);
 if(existing){if(!validEmployeeStockLocation(existing,employee.id))throw Error('The employee stock location needs management review.');return existing;}
 return stores.Warehouse.create({id,code:'EMP-'+id.slice(-16).toUpperCase(),name:'Goods held by '+employee.full_name,warehouse_type:'commercial_custody',custodian_employee_id:employee.id,employee_delivery_custody:true,is_active:true});
}
