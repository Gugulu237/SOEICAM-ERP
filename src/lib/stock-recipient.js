import {principalRole} from '../server/domain/roles.js';
export const STOCK_RECIPIENT_ROLES=['admin','procurement','warehouse_manager','cashier','production_manager','employee','commercial','driver'];
export const eligibleStockRecipient=employee=>Boolean(employee&&employee.role_label!=='Unrecognized role'&&employee.status==='active'&&!employee.employee_removed_at&&STOCK_RECIPIENT_ROLES.includes(principalRole({role:'user'},employee)));
