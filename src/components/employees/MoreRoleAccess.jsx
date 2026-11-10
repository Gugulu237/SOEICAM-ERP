'use client';
import React,{lazy,Suspense,useCallback,useEffect,useState} from 'react';
import {Link} from '@/lib/router';
import {ui,uiMessage} from '@/lib/i18n';
import {MODULES} from '@/server/domain/role-catalogue';
import {roleDefinitions} from '@/lib/staff-role-assignments';
import {ChevronRight,Pencil,RefreshCw} from 'lucide-react';
const RoleEditorSheet=lazy(()=>import('./RoleEditorSheet'));
const order=['admin','warehouse_manager','production_manager','commercial','cashier','hotesse'];
const primaryModules=['sales','inventory','accounting','purchases','customers'];

// Role summaries use the saved catalogue. Changes use the existing reviewed editor.
export default function MoreRoleAccess(){
  const [catalogue,setCatalogue]=useState(null),[selected,setSelected]=useState('warehouse_manager');
  const [error,setError]=useState(''),[loading,setLoading]=useState(true),[editing,setEditing]=useState(null);
  const load=useCallback(async(signal)=>{
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/admin/roles',{cache:'no-store',credentials:'same-origin',signal});
      const result=await response.json();
      if(!response.ok)throw Error(result.error||'Could not load roles.');
      if(!signal?.aborted)setCatalogue(result);
    }catch(e){if(!signal?.aborted)setError(e.message);}
    finally{if(!signal?.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{const controller=new AbortController();load(controller.signal);return()=>controller.abort();},[load]);
  const roles=roleDefinitions(catalogue).sort((a,b)=>{
    const i=order.indexOf(a.key),j=order.indexOf(b.key);
    return (i<0?order.length:i)-(j<0?order.length:j);
  });
  const current=roles.find(r=>r.key===selected)||roles[0];
  const moduleRows=modules=><div className="divide-y rounded-xl border bg-white">{modules.map(module=>{
    const enabled=current?.modules?.includes(module.key)||false;
    return <div key={module.key} className="flex min-h-14 items-center justify-between gap-3 px-3 py-2"><span className="text-sm font-semibold">{module.label}</span><span role="img" aria-label={ui(enabled?'Enabled':'Disabled')} className={'flex h-7 w-12 shrink-0 items-center rounded-full p-1 '+(enabled?'justify-end bg-primary':'justify-start bg-muted')}><span className="h-5 w-5 rounded-full border bg-white"/></span></div>;
  })}</div>;
  return <section data-more-role-access className="space-y-3">
    <h2 className="text-xs font-bold uppercase tracking-wide text-primary">{ui('Role access')}</h2>
    {error&&<p role="alert" className="rounded-xl border border-red-200 p-3 text-sm text-red-700">{uiMessage(error)} <button type="button" className="underline" onClick={()=>load()}>{ui('Retry')}</button></p>}
    {loading&&!catalogue&&<p role="status" className="text-sm text-muted-foreground">{ui('Loading roles...')}</p>}
    {!!roles.length&&<>
      <div role="group" aria-label={ui('Select role')} className="flex gap-2 overflow-x-auto pb-1">{roles.map(role=><button key={role.key} type="button" aria-pressed={current?.key===role.key} onClick={()=>setSelected(role.key)} className={'min-h-11 shrink-0 rounded-lg border px-3 text-sm font-semibold '+(current?.key===role.key?'border-primary bg-primary text-white':'bg-white')}>{ui(role.label)}</button>)}</div>
      {moduleRows(MODULES.filter(m=>primaryModules.includes(m.key)))}
      <div className="flex gap-2"><button type="button" disabled={loading} onClick={()=>setEditing({...current})} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border bg-white px-3 text-sm font-semibold"><Pencil size={17}/>{ui('Edit role access')}</button><button type="button" disabled={loading} onClick={()=>load()} aria-label={ui('Refresh roles')} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-white"><RefreshCw size={17}/></button></div>
      <details className="rounded-xl border bg-white p-3"><summary className="min-h-8 cursor-pointer text-sm font-semibold">{ui('All role modules')}</summary><div className="mt-3">{moduleRows(MODULES.filter(m=>!primaryModules.includes(m.key)))}</div></details>
    </>}
    <Link to="/team-workspaces?section=roles" className="flex min-h-12 items-center justify-between rounded-xl border bg-white px-3 text-sm font-semibold">{ui('Roles & organigram')}<ChevronRight size={18}/></Link>
    {editing&&catalogue&&<Suspense fallback={<p role="status">{ui('Loading...')}</p>}><RoleEditorSheet key={editing.key} profile={editing} catalogue={catalogue} onClose={()=>setEditing(null)} onSaved={value=>setCatalogue(value)}/></Suspense>}
  </section>;
}
