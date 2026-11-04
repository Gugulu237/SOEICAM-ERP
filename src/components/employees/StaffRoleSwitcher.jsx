'use client';
import React,{useEffect,useState} from 'react';
import { ui,uiMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { saveStaffRoleAction } from '@/lib/staff-roles-client';
export default function StaffRoleSwitcher(){
  const {employee,role}=useCurrentUser(),[data,setData]=useState(null),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const hasAssignments=Array.isArray(employee?.staff_role_assignments)&&employee.staff_role_assignments.length>0;
  useEffect(()=>{
    setData(null);
    // The authenticated employee already includes shared-duty assignments.
    // A single-role account has no switcher to load; new assignments arrive
    // through the existing authoritative profile refresh.
    if(!employee?.id||role==='admin'||!hasAssignments)return;
    let active=true,pending=false,again=false;
    const controller=new AbortController();
    const load=async()=>{
      if(!active||pending)return;pending=true;
      try{const response=await fetch('/api/staff/roles',{cache:'no-store',signal:controller.signal});if(!response.ok)return;const result=await response.json();if(active){setData(result);setSelected(result.active_role);}}
      catch{/* A later focus/profile refresh can retry the optional switcher. */}
      finally{pending=false;if(active&&again){again=false;void load();}}
    };
    const visible=()=>{if(document.visibilityState==='visible')void load();};
    const changed=()=>{if(pending)again=true;else void load();};
    void load();window.addEventListener('focus',visible);window.addEventListener('soeicam:roles-changed',changed);
    return()=>{active=false;controller.abort();window.removeEventListener('focus',visible);window.removeEventListener('soeicam:roles-changed',changed);};
  },[employee?.id,employee?.staff_roles_revision,employee?.assigned_role,role,hasAssignments]);
  if(!data || data.roles.length<2)return null;
  async function change(){if(busy)return;setBusy(true);setError('');try{await saveStaffRoleAction({action:'activate',roleKey:selected,revision:data.revision});window.location.assign('/');}catch(e){setError(e.message);setBusy(false);}}
  return <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-green-100 px-4 py-2 text-xs sm:px-6 lg:px-8"><label className="flex min-w-0 items-center gap-2">{ui('My work role')}<select aria-label={ui('My work role')} disabled={busy} className="h-9 min-w-0 max-w-48 rounded-md border bg-white px-2 text-xs" value={selected} onChange={e=>setSelected(e.target.value)}>{data.roles.map(r=><option key={r.key} value={r.key}>{ui(r.label)}</option>)}</select></label>{selected!==data.active_role&&<button type="button" onClick={change} disabled={busy} className="rounded-md bg-green-800 px-3 py-2 text-white">{ui(busy?'Switching…':'Switch')}</button>}{error&&<p role="alert" className="w-full text-red-700">{uiMessage(error)}</p>}</div>;
}
