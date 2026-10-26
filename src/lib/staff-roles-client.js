import { invalidateERPReads } from '@/api/erpClient';
import {notifyRoleChanges} from './role-permission-sync';
const pending=new Map();
export function saveStaffRoleAction(body) {
  const key=JSON.stringify(body);
  if(pending.has(key))return pending.get(key);
  const request=(async()=>{
    const response=await fetch('/api/staff/roles',{method:'POST',headers:{'Content-Type':'application/json'},body:key});
    const result=await response.json();
    if(!response.ok)throw Error(result.error || result.message || 'Could not save staff role changes.');
    invalidateERPReads();
    notifyRoleChanges();
    return result;
  })();
  pending.set(key,request);
  request.then(()=>pending.delete(key),()=>pending.delete(key));
  return request;
}
