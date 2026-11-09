import {readRecords} from './commercial-workspace.js';
import {businessDate} from '../../lib/business-date.js';
import {periodDates} from './commercial-rules.js';
import {principalRole} from './roles.js';
import {eligibleStockRecipient} from '../../lib/stock-recipient.js';

export const CENTRAL_INVENTORY_POLICY='central-company-stock-v1';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const invalid=()=>Error('Review the protected centralized inventory activation before recording company stock.');

// The mode is authorized by a checked cutover, never by a browser flag. A
// deployment alone cannot adopt personal custody into the company pool.
export async function centralizedInventoryPolicy(stores){
  const settings=await readRecords(stores.CompanySettings),enabled=settings.filter(row=>row.centralized_inventory?.enabled===true);
  if(!enabled.length){if(settings.some(row=>row.centralized_inventory&&row.centralized_inventory.enabled!==false))throw invalid();return null;}
  if(settings.length!==1||enabled.length!==1)throw invalid();
  const setting=enabled[0],config=setting.centralized_inventory;
  if(config.policy!==CENTRAL_INVENTORY_POLICY||!/^CIA-[a-f0-9]{64}$/.test(config.activation_id||'')||typeof config.central_warehouse_id!=='string'||!config.central_warehouse_id)throw invalid();
  try{periodDates(config.effective_date,config.effective_date);}catch{throw invalid();}
  if(config.effective_date>businessDate())throw invalid();
  const [event,warehouse]=await Promise.all([stores.AuditLog.get(config.activation_id),stores.Warehouse.get(config.central_warehouse_id)]);
  if(!event||event.action!=='activate_central_inventory'||event.module!=='inventory'||event.entity_type!=='CompanySettings'||event.entity_id!==setting.id||event.audit_source!=='server_verified'||!event.user_id||event.centralized_inventory_policy!==CENTRAL_INVENTORY_POLICY||!equal(event.centralized_inventory_activation,config))throw invalid();
  if(!warehouse||warehouse.is_active===false||warehouse.warehouse_type!=='general'||warehouse.custodian_employee_id||warehouse.vehicle_id||warehouse.central_inventory_pool!==true)throw invalid();
  return structuredClone(config);
}

export async function assertCentralInventory(stores,date=businessDate()){
  const config=await centralizedInventoryPolicy(stores);
  if(!config)throw Error('Centralized inventory has not been activated.');
  try{periodDates(date,date);}catch{throw Error('Choose a valid centralized inventory date.');}
  if(date<config.effective_date||date>businessDate())throw Error('Record centralized stock on or after its activation date and on or before today.');
  return config;
}

export const centralInventoryMode=centralizedInventoryPolicy;

export async function assertCentralSalesAccess(client,user,employee){
  const role=principalRole(user,employee),denied=message=>Object.assign(Error(message),{status:403});
  if(role==='driver')throw denied('Drivers cannot record customer sales.');
  if(!eligibleStockRecipient(employee)||employee.user_id&&employee.user_id!==user?.id)throw denied('An active linked sales staff account is required.');
  if(role==='admin')return true;
  if(role==='commercial'){await client.auth.assertModule?.('commercial');return true;}
  try{await client.auth.assertModule?.('sales');}
  catch(error){if(error.status!==403)throw error;await client.auth.assertModule?.('commercial');}
  return true;
}

export function centralEmployeeCustomers(customers,employee,user){
  if(!employee?.id||!user?.id)return [];
  return customers.filter(row=>row.is_active!==false&&!row.customer_removed_at);
}

export async function assertCentralCustomer(stores,employee,user,id){
  const customer=centralEmployeeCustomers(await readRecords(stores.Customer),employee,user).find(row=>row.id===id);
  if(!customer)throw Error('Choose an active customer.');
  return customer;
}
