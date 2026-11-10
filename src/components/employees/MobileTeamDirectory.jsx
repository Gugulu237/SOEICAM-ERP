import React from 'react';
import {Link} from '@/lib/router';
import {ui} from '@/lib/i18n';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Search,Plus,ShieldCheck,ChevronRight,Users} from 'lucide-react';
import {activeStaffRole} from '@/lib/staff-role-assignments';
import {businessDate} from '@/lib/business-date';

// The Team destination lists real employees and opens the exported profile
// layout directly. Role editing remains a separate, explicit administrator tool.
export default function MobileTeamDirectory({employees,definitions,search,onSearch,roleFilter,onRoleFilter,onNew,onRoles,canManage,loading,error,navigation,children}) {
 const catalogue={roles:Object.fromEntries(definitions.map(role=>[role.key,role]))},today=businessDate();
 const people=employees.map(employee=>({employee,profile:activeStaffRole(employee,catalogue,today)})).filter(({employee,profile})=>(roleFilter==='all'||profile?.key===roleFilter)&&[employee.full_name,employee.employee_number,employee.job_title,profile?.label].filter(Boolean).join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a,b)=>String(a.employee.full_name).localeCompare(String(b.employee.full_name)));
 return <div data-sleek-screen="team-directory" className="space-y-4">
  <header className="flex items-center justify-between gap-3"><div><h1 className="text-xl font-bold">{ui('Team')}</h1><p className="mt-1 text-xs text-muted-foreground">{ui('Choose an employee to open their profile')}</p></div>{canManage&&<Button size="icon" aria-label={ui('New Employee')} className="h-12 w-12 rounded-xl" onClick={onNew}><Plus size={20}/></Button>}</header>
  {navigation}
  {error}
  <div className="relative"><Search size={17} className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground"/><Input value={search} onChange={event=>onSearch(event.target.value)} aria-label={ui('Search employees')} placeholder={ui('Search employees')} className="h-12 pl-10"/></div>
  <div className="flex min-w-0 gap-2"><select aria-label={ui('Filter employees by role')} className="h-12 min-w-0 flex-1 rounded-xl border bg-white px-3 text-sm" value={roleFilter} onChange={event=>onRoleFilter(event.target.value)}><option value="all">{ui('All roles')}</option>{definitions.map(role=><option key={role.key} value={role.key}>{ui(role.label)}</option>)}</select><Button variant="outline" aria-label={ui('Roles & organigram')} className="h-12 w-12 p-0" onClick={onRoles}><ShieldCheck size={19}/></Button></div>
  <p className="text-xs text-muted-foreground">{ui('{0} employees',people.length)}</p>
  <div className="divide-y overflow-hidden rounded-[22px] border bg-white">{people.map(({employee,profile})=><Link key={employee.id} to={'/employees/'+encodeURIComponent(employee.id)} className="flex min-h-20 items-center gap-3 p-3" aria-label={ui('Open employee profile: {0}',employee.full_name)}><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-primary">{employee.full_name?.split(' ').filter(Boolean).map(word=>word[0]).slice(0,2).join('').toUpperCase()||<Users size={19}/>}</span><span className="min-w-0 flex-1"><strong className="block break-words text-sm">{employee.full_name}</strong><span className="mt-1 block text-xs text-muted-foreground">{ui(profile?.label||employee.role||'Unassigned')}{employee.department_name?' · '+employee.department_name:''}</span><span className={'mt-1 block text-[11px] '+(employee.status==='active'?'text-primary':'text-muted-foreground')}>{ui(employee.status||'Not recorded')}</span></span><ChevronRight size={18} className="shrink-0 text-muted-foreground"/></Link>)}{!loading&&!people.length&&<p className="p-6 text-center text-sm text-muted-foreground">{ui('No matching employees.')}</p>}</div>
  {children}
 </div>;
}
