import { usePageState } from '@/lib/navigation-context';
import { employeeRemoved } from '@/lib/employee-lifecycle';
import EmployeeRemovalAction from '@/components/employees/EmployeeRemovalAction';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { erp } from '@/api/erpClient';
import { readAll } from '@/lib/field-pos';
import { ROLE_CATEGORIES, ROLE_DEFINITIONS } from '@/lib/permissions';
import PageHeader from '@/components/shared/PageHeader';
import EmployeeRoleDirectory from '@/components/employees/EmployeeRoleDirectory';
import EmployeeRoleDrawer from '@/components/employees/EmployeeRoleDrawer';
import RoleEditorSheet from '@/components/employees/RoleEditorSheet';
import { roleDefinitions,occupiesRole } from '@/lib/staff-role-assignments';
import { businessDate } from '@/lib/business-date';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import RoleAccessReference from '@/components/employees/RoleAccessReference';
import EmployeeFormDialog from '@/components/employees/EmployeeFormDialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, ShieldCheck } from 'lucide-react';
import { usesClerk } from '@/lib/auth-provider';
import { inviteEmployee } from '@/lib/staff-invitations-client';
import { useToast } from '@/components/ui/use-toast';


export default function Employees({ embedded=false, section='people', initialRole='' }) {
  useLocaleRender();
  const [roleCatalogue,setRoleCatalogue]=useState(null), [employees,setEmployees]=useState([]);
  const [loading,setLoading]=useState(true), [loadError,setLoadError]=useState('');
  const [category,setCategory]=usePageState('employees:category','All'), [roleFilter,setRoleFilter]=usePageState('employees:role','all');
  const [showForm,setShowForm]=useState(false), [editing,setEditing]=useState(null), [showRoles,setShowRoles]=useState(false), [roleToOpen,setRoleToOpen]=useState('');
  const [inviting,setInviting]=useState('');
  const request=useRef(0), {toast}=useToast(),{role:myRole}=useCurrentUser(),canManage=myRole==='admin',today=businessDate();
  const [selectedRole,setSelectedRole]=useState(''),[roleDraft,setRoleDraft]=useState(null);
  const definitions=useMemo(()=>roleDefinitions(roleCatalogue,ROLE_DEFINITIONS),[roleCatalogue]);
  const load=useCallback(async()=>{
    const version=++request.current;setLoading(true);setLoadError('');
    try {
      const [catalogue,people]=await Promise.all([
        fetch('/api/admin/roles',{cache:'no-store'}).then(async response=>{if(!response.ok)throw Error(ui('Could not load roles.'));return response.json();}),
        readAll(erp.entities.Employee,{},'-created_date,-id'),
      ]);
      if(version!==request.current)return;
      setRoleCatalogue(catalogue);if(people)setEmployees(people);
    }catch(error){if(version===request.current)setLoadError(error.message);}
    finally{if(version===request.current)setLoading(false);}
  },[]);
  useEffect(()=>{load();return()=>{request.current++;};},[load]);
  const counts=useMemo(()=>Object.fromEntries(definitions.map(def=>[def.key,employees.filter(person=>occupiesRole(person,def.key,today)).length])),[definitions,employees,today]);
  const categoryCount=cat=>definitions.filter(r=>cat==='All'||r.category===cat).reduce((sum,r)=>sum+(counts[r.key]||0),0);
  const openRole=key=>{if(key)setSelectedRole(key);else{setRoleToOpen('');setShowRoles(true);}};
  const editEmployee=row=>{setEditing(row);setShowForm(true);};
  async function invite(row){
    if(inviting)return;setInviting(row.id);
    try{const result=await inviteEmployee(row.id);toast({title:result.status==='invited'?ui('Invitation sent to {0}',result.email):result.status==='pending'?ui('Invitation already pending for {0}',result.email):ui('{0} can sign in',result.email)});}
    catch(error){toast({variant:'destructive',title:ui('Could not invite employee'),description:error.message});}
    finally{setInviting('');}
  }
  if(loading&&!roleCatalogue)return <p role="status" className="py-12 text-sm text-slate-500">{ui('Loading employees...')}</p>;
  const error=loadError&&<p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{uiMessage(loadError)} <button className="underline" onClick={load}>{ui('Retry')}</button></p>;
  const form=<EmployeeFormDialog open={showForm} onOpenChange={setShowForm} employee={editing} employees={employees} roleDefinitions={definitions} onSaved={load}/>;
  const visibleEmployees=employees.filter(person=>!employeeRemoved(person)),removedEmployees=employees.filter(employeeRemoved);
  const shared={employees:visibleEmployees,onEditEmployee:canManage?editEmployee:undefined,onInvite:canManage&&usesClerk()?invite:undefined,inviting};
  if(embedded&&section==='roles')return <div className="min-w-0">{error}{roleCatalogue&&<RoleAccessReference embedded open catalogue={roleCatalogue} initialRole={initialRole} onSaved={load} {...shared}/>} {form}</div>;
  return <div className="min-w-0">
    <PageHeader title={embedded?ui('Employee directory'):ui('Employees')} actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>openRole('')}><ShieldCheck size={16} className="mr-1"/>{ui('Roles & organigram')}</Button>{canManage&&<Button onClick={()=>{setEditing(null);setShowForm(true);}}><Plus size={16} className="mr-1"/>{ui('New Employee')}</Button>}</div>}/>
    {error}
    <div className="mb-4 flex flex-wrap items-center gap-2">{['All',...ROLE_CATEGORIES].map(cat=><button type="button" key={cat} onClick={()=>{setCategory(cat);setRoleFilter('all');}} className={'rounded-full border px-3 py-1.5 text-xs transition '+(category===cat?'border-primary bg-primary text-white':'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}>{ui(cat)} <span className="opacity-60">{categoryCount(cat)}</span></button>)}<div className="w-full sm:ml-auto sm:w-56"><Select value={roleFilter} onValueChange={value=>{setRoleFilter(value);setCategory('All');}}><SelectTrigger aria-label={ui('Filter employees by role')}><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">{ui('All roles')}</SelectItem>{definitions.map(def=><SelectItem key={def.key} value={def.key}>{ui(def.label)} ({counts[def.key]||0})</SelectItem>)}</SelectContent></Select></div></div>
    {loading&&<p role="status" className="mb-3 text-xs text-slate-500">{ui('Loading employees...')}</p>}
    {!loadError&&<EmployeeRoleDirectory employees={visibleEmployees} definitions={definitions} category={category} roleFilter={roleFilter} onOpen={openRole}/>}
    {form}
    {canManage&&removedEmployees.length>0&&<details className="mt-5 rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-medium">{ui('Removed employees')} ({removedEmployees.length})</summary><ul className="mt-3 divide-y">{removedEmployees.map(person=><li key={person.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="text-sm">{person.full_name}</span><EmployeeRemovalAction employee={person} onSaved={load}/></li>)}</ul></details>}
    <RoleAccessReference open={showRoles} onOpenChange={setShowRoles} catalogue={roleCatalogue} initialRole={roleToOpen} onSaved={load} {...shared}/>
    {selectedRole&&definitions.some(r=>r.key===selectedRole)&&<EmployeeRoleDrawer key={selectedRole} open onOpenChange={value=>{if(!value)setSelectedRole('');}} role={definitions.find(r=>r.key===selectedRole)} definitions={definitions} catalogue={roleCatalogue} onSaved={load} canManage={canManage} onEditRole={canManage?profile=>setRoleDraft(profile):undefined} {...shared}/>}
    {roleDraft&&<RoleEditorSheet key={roleDraft.key} profile={roleDraft} catalogue={roleCatalogue} definitions={definitions} onClose={()=>setRoleDraft(null)} onSaved={load}/>}

  </div>;
}
