'use client';
import React,{useEffect,useState} from 'react';
import { ui,uiMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { saveStaffRoleAction } from '@/lib/staff-roles-client';
export default function StaffRoleSwitcher(){
  const {employee,role}=useCurrentUser(),[data,setData]=useState(null),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(!employee?.id || role==='admin')return;let active=true;const load=()=>fetch('/api/staff/roles',{cache:'no-store'}).then(async response=>{if(!response.ok)return;const result=await response.json();if(active){setData(result);setSelected(result.active_role);}}).catch(()=>{});load();const visible=()=>{if(document.visibilityState==='visible')load();};window.addEventListener('focus',visible);window.addEventListener('soeicam:roles-changed',visible);return()=>{active=false;window.removeEventListener('focus',visible);window.removeEventListener('soeicam:roles-changed',visible);};},[employee?.id,employee?.staff_roles_revision,employee?.assigned_role,role]);
  if(!data || data.roles.length<2)return null;
  async function change(){if(busy)return;setBusy(true);setError('');try{await saveStaffRoleAction({action:'activate',roleKey:selected,revision:data.revision});window.location.assign('/');}catch(e){setError(e.message);setBusy(false);}}
  return <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-green-100 px-4 py-2 text-xs sm:px-6 lg:px-8"><label className="flex min-w-0 items-center gap-2">{ui('My work role')}<select aria-label={ui('My work role')} disabled={busy} className="h-9 min-w-0 max-w-48 rounded-md border bg-white px-2 text-xs" value={selected} onChange={e=>setSelected(e.target.value)}>{data.roles.map(r=><option key={r.key} value={r.key}>{ui(r.label)}</option>)}</select></label>{selected!==data.active_role&&<button type="button" onClick={change} disabled={busy} className="rounded-md bg-green-800 px-3 py-2 text-white">{ui(busy?'Switching…':'Switch')}</button>}{error&&<p role="alert" className="w-full text-red-700">{uiMessage(error)}</p>}</div>;
}
