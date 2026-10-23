'use client';
import React,{useRef,useState} from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { employeeRemoved } from '@/lib/employee-lifecycle';
import { ui,uiMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';

export default function EmployeeRemovalAction({employee,onSaved}) {
  const {role,user,employee:actor}=useCurrentUser(),[open,setOpen]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef(false),key=useRef(null);
  if(role!=='admin'||!employee||employee.id===actor?.id||(employee.user_id&&employee.user_id===user?.id))return null;
  const removed=employeeRemoved(employee);
  async function submit(){
    if(pending.current)return;pending.current=true;setBusy(true);setError('');
    try{
      const input={action:removed?'restore':'remove',reason:reason.trim(),revision:Number(employee.employee_lifecycle_revision||0)};
      const fingerprint=JSON.stringify(input);if(key.current?.fingerprint!==fingerprint)key.current={fingerprint,value:crypto.randomUUID()};
      const response=await fetch('/api/admin/employees/'+encodeURIComponent(employee.id)+'/lifecycle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,requestKey:key.current.value})});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Employee change could not be saved.');
      setOpen(false);await onSaved?.(result.employee);
    }catch(e){setError(e.message);}finally{pending.current=false;setBusy(false);}
  }
  return <><Button variant={removed?'outline':'ghost'} className={removed?'':'text-red-700 hover:text-red-800'} onClick={()=>{setReason('');setError('');key.current=null;setOpen(true);}}>{ui(removed?'Restore employee':'Remove employee')}</Button>
    <Dialog open={open} onOpenChange={value=>{if(!pending.current)setOpen(value);}}><DialogContent><DialogHeader><DialogTitle>{ui(removed?'Restore employee':'Remove employee')}</DialogTitle><DialogDescription>{employee.full_name}</DialogDescription></DialogHeader>
      <p className="text-sm text-slate-600">{ui(removed?'Restore this employee to the directory as inactive. Review the profile before activating access.':'Remove this employee from the directory and block ERP access. Payroll and transaction history will be retained.')}</p>
      <label className="space-y-1 text-sm font-medium">{ui('Reason')}<Input aria-label={ui('Employee removal or restoration reason')} value={reason} maxLength={1000} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
      {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>{ui('Cancel')}</Button><Button variant={removed?'default':'destructive'} disabled={busy||reason.trim().length<3} onClick={submit}>{ui(busy?'Saving...':removed?'Confirm restore':'Confirm removal')}</Button></div>
    </DialogContent></Dialog></>;
}
