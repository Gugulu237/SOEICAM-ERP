import { requireStaff } from './field-ops.js';
import { canReadManagementAccounting } from '../../lib/management-access.js';
export async function requireFinancialReader(client,user) {
  const context=await requireStaff(client,user,['admin','cashier','production_manager','warehouse_manager'],'financial reporting');
  if (context.role!=='admin' && context.employee?.status!=='active') throw Error('An active staff account is required');
  if (!canReadManagementAccounting(context.role,context.employee)) throw Error('Financial reporting is restricted to authorized management and accounting staff');
  client.auth.assertModule?.('accounting');
  return context;
}
