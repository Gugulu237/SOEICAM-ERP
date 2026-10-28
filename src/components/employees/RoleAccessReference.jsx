'use client';
import React,{useEffect,useMemo,useState} from 'react';
import { ui } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { ROLE_DEFINITIONS } from '@/lib/permissions';
import { roleDefinitions } from '@/lib/staff-role-assignments';
import { TEMPLATE_MODULES } from '@/server/domain/role-catalogue';
import { normalizeOrganigramLayout,moveOrganigramRole,ORGANIGRAM_GROUPS } from '@/lib/role-organigram';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import RoleOrganigram from './RoleOrganigram';
import EmployeeRoleDrawer from './EmployeeRoleDrawer';
import RoleEditorSheet from './RoleEditorSheet';
const newRole={key:'',label:'',category:'Operations',summary:'',duties:[],template_role:'employee',modules:[...TEMPLATE_MODULES.employee]};
export default function RoleAccessReference({open,onOpenChange,catalogue,initialRole='',onSaved,embedded=false,employees,onEditEmployee,onInvite,inviting}){
  useLocaleRender();const {principalRole,role}=useCurrentUser(),canManage=(principalRole||role)==='admin',{toast}=useToast();
  const [selectedRole,setSelectedRole]=useState(''),[draft,setDraft]=useState(null),[layout,setLayout]=useState(null),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[savedCatalogue,setSavedCatalogue]=useState(null);
  const current=savedCatalogue&&savedCatalogue.revision>=(catalogue?.revision||0)?savedCatalogue:catalogue;
  const definitions=useMemo(()=>roleDefinitions(current,ROLE_DEFINITIONS),[current]),selected=definitions.find(r=>r.key===selectedRole),currentLayout=normalizeOrganigramLayout(definitions,dirty?layout:current?.layout);
  useEffect(()=>{if(open)setSelectedRole(initialRole||'');},[open,initialRole]);
  const edit=profile=>setDraft({...profile,category:profile.category||'Operations',duties:[...(profile.duties||[])],modules:[...(profile.modules||[])]});
  async function saved(next){if(next)setSavedCatalogue(next);await onSaved?.();}
  function move(key,before,group){if(!canManage||!definitions.some(r=>r.key===key&&key!=='admin'))return;setLayout(moveOrganigramRole(currentLayout,key,group,before));setDirty(true);}
  async function saveLayout(){if(!dirty||saving)return;setSaving(true);try{const response=await fetch('/api/admin/roles',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:current.revision,layout:currentLayout})});const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save chart.');setDirty(false);await saved(result);toast({title:ui('Organigram saved')});}catch(error){toast({variant:'destructive',title:ui('Could not save chart'),description:error.message});}finally{setSaving(false);}}
  const content=<><div className="mb-5 flex flex-wrap items-center justify-between gap-3">{embedded?<h2 className="text-xl font-semibold">{ui('Company organigram')}</h2>:<DialogHeader><DialogTitle>{ui('Company organigram')}</DialogTitle><DialogDescription>{ui('Open a role to view its employees.')}</DialogDescription></DialogHeader>}{canManage&&<div className="flex flex-wrap gap-2">{dirty&&<><Button variant="outline" onClick={()=>setDirty(false)}>{ui('Discard placement')}</Button><Button disabled={saving} onClick={saveLayout}>{ui('Save chart')}</Button></>}<Button variant="outline" onClick={()=>{setLayout(normalizeOrganigramLayout(definitions,null));setDirty(true);}}>{ui('Use recommended formation')}</Button><Button onClick={()=>edit(newRole)}>{ui('Create new role')}</Button></div>}</div><RoleOrganigram definitions={definitions} layout={currentLayout} onOpen={setSelectedRole} onMove={canManage?move:undefined}/>{selected&&<EmployeeRoleDrawer key={selected.key} open onOpenChange={value=>{if(!value)setSelectedRole('');}} role={selected} definitions={definitions} employees={employees} catalogue={current} onSaved={()=>saved()} canManage={canManage} onEditEmployee={onEditEmployee} onEditRole={canManage?edit:undefined} onInvite={onInvite} inviting={inviting} onMove={canManage?move:undefined} currentGroup={{value:ORGANIGRAM_GROUPS.find(g=>currentLayout[g.key]?.includes(selected.key))?.key,options:ORGANIGRAM_GROUPS}}/>}{draft&&<RoleEditorSheet key={draft.key||'new'} profile={draft} catalogue={current} definitions={definitions} onClose={()=>setDraft(null)} onSaved={saved}/>}</>;
  return embedded?<section className="min-w-0 rounded-2xl border bg-white p-4 sm:p-5">{content}</section>:<Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] max-w-[96vw] overflow-y-auto xl:max-w-6xl">{content}</DialogContent></Dialog>;
}
