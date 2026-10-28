'use client';
import React, { useMemo } from 'react';
import { MoreHorizontal, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { usePageState } from '@/lib/navigation-context';
import { ui } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { formatXAF } from '@/lib/formatters';
import { sortEmployeesByHierarchy } from '@/lib/role-organigram';
import { Link } from '@/lib/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

const desktopColumns='md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_2.5rem]';
export default function EmployeeDirectory({employees,definitions,onEdit,onRole,onInvite,inviting,loading=false}) {
  useLocaleRender();
  const [view,setView]=usePageState('employee-directory:hierarchy-v1',{search:'',page:0});
  const rows=useMemo(()=>{
    const q=view.search.trim().toLowerCase(), labels=new Map(definitions.map(r=>[r.key,r.label]));
    return sortEmployeesByHierarchy(employees,definitions).filter(row=>!q||[row.full_name,row.employee_number,row.job_title,row.responsibilities,row.email,labels.get(row.role)].some(value=>String(value||'').toLowerCase().includes(q)));
  },[employees,definitions,view.search]);
  const pages=Math.max(1,Math.ceil(rows.length/10)),page=Math.min(view.page,pages-1),shown=rows.slice(page*10,page*10+10);
  const label=row=>definitions.find(r=>r.key===row.role)?.label||row.role||ui('Unassigned');
  return <section className="min-w-0" aria-label={ui('Employee directory')} aria-busy={loading}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="relative w-full max-w-sm"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input aria-label={ui('Search employees')} placeholder={ui('Search employees')} value={view.search} onChange={event=>setView({search:event.target.value,page:0})} className="pl-9"/></div><span className="text-xs text-slate-500">{ui('Management first')} · {rows.length} {ui('employees')}</span></div>
    <div className="min-w-0 rounded-xl border bg-white">
      <div aria-hidden="true" className={'hidden items-center gap-3 border-b bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 md:grid '+desktopColumns}><span>{ui('Name')}</span><span>{ui('Role')}</span><span>{ui('Responsibilities')}</span><span className="text-right">{ui('Salary')}</span><span/></div>
      <ul className="divide-y">{shown.map(row=><li key={row.id} className={'grid min-w-0 grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-slate-50 '+desktopColumns}>
        <Link className="col-start-1 row-start-1 min-w-0 break-words text-sm font-semibold text-green-900 hover:underline [overflow-wrap:anywhere]" to={'/employees/'+encodeURIComponent(row.id)}>{row.full_name}</Link>
        <div className="col-start-1 row-start-2 min-w-0 md:col-start-2 md:row-start-1"><span className="sr-only">{ui('Role')}: </span><button type="button" className="max-w-full rounded-lg bg-green-50 px-2 py-1 text-left text-xs font-medium leading-5 text-green-800 [overflow-wrap:anywhere]" onClick={()=>onRole(row.role)}>{ui(label(row))}</button></div>
        <p className="col-span-2 row-start-4 min-w-0 line-clamp-2 break-words text-xs leading-5 text-slate-600 [overflow-wrap:anywhere] md:col-span-1 md:col-start-3 md:row-start-1"><span className="sr-only">{ui('Responsibilities')}: </span>{row.responsibilities||'—'}</p>
        <p className="col-start-1 row-start-3 min-w-0 text-xs tabular-nums [overflow-wrap:anywhere] md:col-start-4 md:row-start-1 md:text-right"><span className="text-slate-500 md:sr-only">{ui('Salary')}: </span>{formatXAF(row.base_salary)}</p>
        <div className="col-start-2 row-start-1 md:col-start-5"><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={ui('Actions for {0}',row.full_name)}><MoreHorizontal size={18}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" collisionPadding={12}>
          <DropdownMenuItem asChild><Link to={'/employees/'+encodeURIComponent(row.id)}>{ui('Open profile')}</Link></DropdownMenuItem>
          <DropdownMenuItem onSelect={()=>onEdit(row)}>{ui('Edit employee')}</DropdownMenuItem>
          {row.role&&definitions.some(r=>r.key===row.role)&&<DropdownMenuItem asChild><Link to={'/team-workspaces?role='+encodeURIComponent(row.role)+'&employee='+encodeURIComponent(row.id)}>{ui('View employee dashboard')}</Link></DropdownMenuItem>}
          {onInvite&&<DropdownMenuItem disabled={!!inviting||row.status!=='active'||!(row.user_email||row.email)||!row.role} onSelect={()=>onInvite(row)}>{inviting===row.id?ui('Sending...'):ui('Invite / check account')}</DropdownMenuItem>}
        </DropdownMenuContent></DropdownMenu></div>
      </li>)}</ul>
      {!shown.length&&<p className="p-8 text-center text-sm text-slate-500">{ui('No employees in this category yet')}</p>}
    </div>
    {pages>1&&<div className="mt-3 flex items-center justify-between text-sm text-slate-500"><span>{ui('Page {0} of {1}',page+1,pages)}</span><div className="flex gap-2"><Button variant="outline" size="sm" aria-label={ui('Previous employees')} disabled={page===0} onClick={()=>setView(v=>({...v,page:page-1}))}><ChevronLeft size={14}/></Button><Button variant="outline" size="sm" aria-label={ui('Next employees')} disabled={page+1===pages} onClick={()=>setView(v=>({...v,page:page+1}))}><ChevronRight size={14}/></Button></div></div>}
  </section>;
}
