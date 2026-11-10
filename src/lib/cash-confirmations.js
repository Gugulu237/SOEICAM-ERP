import {erp} from '@/api/erpClient';
import {businessDate} from './business-date';

// Match cashierWorkspace's native-role or saved full-feature authority. A
// general Accounting grant does not grant access to the cash desk reader.
export function canReadCashConfirmations({principalRole,role,employee,allowedModules,fullAccessModules}={}){
 const principal=principalRole||role;
 if(!principal||Array.isArray(allowedModules)&&!allowedModules.includes('cashier'))return false;
 if(principal==='admin')return true;
 if(!employee||employee.status!=='active'||employee.employee_removed_at||['driver','commercial'].includes(principal))return false;
 return principal==='cashier'||(fullAccessModules||employee.full_access_modules||[]).includes('cashier');
}

export async function loadCashConfirmations(authority,{date=businessDate()}={}){
 if(!canReadCashConfirmations(authority))return null;
 const {data}=await erp.functions.invoke('fieldOps',{action:'cashierWorkspace',view:'confirmations',date});
 return data;
}
