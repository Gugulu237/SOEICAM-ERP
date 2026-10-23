'use client';
import React,{useMemo} from 'react';
import { usePageState } from '@/lib/navigation-context';
import { ui } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { businessDate } from '@/lib/business-date';
import { roleHierarchyRank } from '@/lib/role-organigram';
import { occupiesRole } from '@/lib/staff-role-assignments';
import { Input } from '@/components/ui/input';
export default function EmployeeRoleDirectory({definitions,employees,onOpen,category='All',roleFilter='all'}){
  useLocaleRender();const [search,setSearch]=usePageState('employees:search',''),today=businessDate();
  const roles=useMemo(()=>definitions.filter(role=>(category==='All'||role.category===category)&&(roleFilter==='all'||role.key===roleFilter)).sort((a,b)=>roleHierarchyRank(a)-roleHierarchyRank(b)||a.label.localeCompare(b.label)),[definitions,category,roleFilter]);
  const term=search.trim().toLocaleLowerCase();
  const visible=roles.filter(role=>!term||ui(role.label).toLocaleLowerCase().includes(term)||employees.some(person=>occupiesRole(person,role.key,today)&&String(person.full_name||'').toLocaleLowerCase().includes(term)));
  return <section className="space-y-4"><Input aria-label={ui('Search roles or employees')} placeholder={ui('Search roles or employees')} value={search} onChange={e=>setSearch(e.target.value)} className="max-w-md"/><div className="flex flex-col gap-2">{visible.map(role=><button type="button" key={role.key} data-role={role.key} onClick={()=>onOpen(role.key)} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border bg-white p-5 text-left hover:border-green-400 hover:bg-green-50 focus-visible:outline-green-700"><span className="break-words text-sm font-semibold text-slate-900">{ui(role.label)}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600" aria-label={ui('Employees in this role')}>{employees.filter(person=>occupiesRole(person,role.key,today)).length}</span></button>)}</div>{!visible.length&&<p className="py-8 text-sm text-slate-500">{ui('No matching roles.')}</p>}</section>;
}
