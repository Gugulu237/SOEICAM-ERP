import {requireStaff,today} from './field-ops.js';
import {eligibleStockRecipient,STOCK_RECIPIENT_ROLES} from './employee-custody.js';
import {salesOrderAction} from './sales-orders.js';
import {commercialRunInventory} from './commercial-runs.js';
import {readRecords} from './commercial-workspace.js';
export const EMPLOYEE_STOCK_ACTIONS=['employeeStockWorkspace','employeeSalesWorkspace','employeeSalesStock','employeeSalesDeliveryPoints','employeeRecordSupply'];
export async function employeeStockAction(client,user,body){
 const {employee}=await requireStaff(client,user,STOCK_RECIPIENT_ROLES,'your issued stock');
 if(!eligibleStockRecipient(employee))throw Error('An active employee other than Hotesse is required.');
 if(body.action==='employeeStockWorkspace'){
   const [stock,sales]=await Promise.all([commercialRunInventory(client.asServiceRole,employee.id,today()),readRecords(client.asServiceRole.entities.SalesOrder,{sales_supply_recorded_by:user.id,order_date:{$gte:today().slice(0,8)+'01'}})]);
   return {...stock,sales:sales.filter(s=>s.salesperson_id===employee.id&&s.dispatch_id).map(s=>({id:s.id,order_number:s.order_number,customer_name:s.customer_name,order_date:s.order_date,total:s.total,payment_type:s.payment_type,status:s.status})),employeeName:employee.full_name};
 }
 const action={employeeSalesWorkspace:'salesOrderWorkspace',employeeSalesStock:'salesOrderStock',employeeSalesDeliveryPoints:'salesOrderDeliveryPoints',employeeRecordSupply:'recordSuppliedOrder'}[body.action];
 if(!action)throw Error('Unknown employee stock action');
 return salesOrderAction(client,user,{...body,action},{ownIssuedStock:true});
}
