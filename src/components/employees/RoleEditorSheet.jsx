'use client';
import React,{useRef,useState} from 'react';
import { ui } from '@/lib/i18n';
import { MODULES,TEMPLATE_MODULES } from '@/server/domain/role-catalogue';
import { ROLE_DEFINITIONS,ROLE_CATEGORIES } from '@/lib/permissions';
import { saveStaffRoleAction } from '@/lib/staff-roles-client';
import { Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
export default function RoleEditorSheet({profile,catalogue,onClose,onSaved}){
 const [draft,setDraft]=useState(profile),[saving,setSaving]=useState(false),[error,setError]=useState(''),existing=Object.hasOwn(catalogue.roles,profile.key),max=MODULES.map(m=>m.key);
 const pending=useRef(false);
 const set=(field,value)=>setDraft(old=>({...old,[field]:value}));
 async function save(){if(pending.current)return;pending.current=true;setSaving(true);setError('');try{const result=await saveStaffRoleAction({action:'saveRole',profile:draft,create:!existing,revision:catalogue.revision});await onSaved(result.catalogue);onClose();}catch(e){setError(e.message);}finally{pending.current=false;setSaving(false);}}
 return <Sheet open onOpenChange={value=>{if(!value&&!pending.current)onClose();}}><SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl"><SheetHeader className="pr-7 text-left"><SheetTitle>{ui(existing?'Edit role access':'Create role')}</SheetTitle><SheetDescription>{ui('Role responsibilities and operational access')}</SheetDescription></SheetHeader>{error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}<fieldset disabled={saving} className="mt-5"><div className="space-y-4">
        <div className="flex items-center justify-between"><h3 className="font-semibold">{existing ? ui("Edit {0}", draft.label) : ui("Create role")}</h3><Button variant="outline" onClick={() => onClose()}>{ui("Back to roles")}</Button></div>
        {!existing && <div><Label>{ui("Role key *")}</Label><Input value={draft.key} onChange={e => set('key',e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,''))} placeholder={ui("e.g. logistics_coordinator")} /><p className="text-xs text-slate-500">{ui("Permanent identifier, lowercase letters, digits and underscores.")}</p></div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>{ui("Role name *")}</Label><Input value={draft.label} maxLength={80} onChange={e => set('label',e.target.value)} /></div>
          <div><Label>{ui("Category")}</Label><Select value={draft.category} disabled={draft.key === 'supply_chain_manager'} onValueChange={value => set('category',value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ROLE_CATEGORIES.map(cat => <SelectItem value={cat} key={cat}>{ui(cat)}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div><Label>{ui("Summary")}</Label><Textarea value={draft.summary} maxLength={500} onChange={e => set('summary',e.target.value)} /></div>
        <div><Label>{ui("Responsibilities (one per line)")}</Label><Textarea value={(draft.duties || []).join('\n')} rows={4} onChange={e => set('duties',e.target.value.split('\n'))} /></div>
        <div><Label>{ui("Access template")}</Label><Select value={draft.template_role} disabled={['admin','driver','commercial'].includes(draft.key)} onValueChange={value => setDraft(current => ({ ...current, template_role:value, modules:[...TEMPLATE_MODULES[value]] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.keys(TEMPLATE_MODULES).filter(key => key !== 'admin' || draft.key==='admin').map(key => <SelectItem key={key} value={key}>{ROLE_DEFINITIONS.find(def => def.key === key)?.label || key}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-xs text-slate-500">{ui("Choose the employee’s default dashboard. Drivers and sales agents retain their job restrictions even when extra modules are checked. Other roles use the selected workflow permissions. Company sales reports remains read-only.")}</p></div>
        <fieldset className="rounded-xl border p-4"><legend className="px-1 text-sm font-semibold">{ui("Permitted modules")}</legend><div className="mb-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={()=>set('modules',MODULES.map(m=>m.key))}>{ui("Select all modules")}</Button><Button type="button" size="sm" variant="outline" onClick={()=>set('modules',draft.key==='admin'?['admin','employees']:[])}>{ui("Clear modules")}</Button><Button type="button" size="sm" variant="outline" onClick={()=>set('modules',[...TEMPLATE_MODULES[draft.template_role]])}>{ui("Use template defaults")}</Button></div><p className="mb-3 text-xs text-slate-500">{ui("Check a feature to enable its actions for employees in this role. Uncheck it to remove access. Only the General Manager can change role permissions and sign-in identities.")}</p><div className="grid gap-2 sm:grid-cols-2">{MODULES.filter(module => max.includes(module.key)).map(module => <label key={module.key} className="flex items-center gap-2 rounded-lg border p-2 text-sm"><input type="checkbox" disabled={draft.key==='admin'&&['admin','employees'].includes(module.key)} checked={draft.modules.includes(module.key)} onChange={e => set('modules',e.target.checked ? [...draft.modules,module.key] : draft.modules.filter(key => key !== module.key))} />{module.label}</label>)}</div></fieldset>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => onClose()}>{ui("Cancel")}</Button><Button disabled={saving || !draft.key || !draft.label.trim()} onClick={save}>{saving ? ui("Saving…") : ui("Save role")}</Button></div>
      </div></fieldset></SheetContent></Sheet>;
}
