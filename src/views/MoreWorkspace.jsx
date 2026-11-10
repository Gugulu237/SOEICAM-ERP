'use client';
import React from 'react';
import {Link} from '@/lib/router';
import {useAuth} from '@/lib/AuthContext';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {useLocaleRender} from '@/lib/localization';
import {modulesForRole} from '@/lib/appModules';
import {ui} from '@/lib/i18n';
import MyProfile from './MyProfile';
import DeviceNotificationSettings from '@/components/pwa/DeviceNotificationSettings';
import LanguageSelector from '@/components/layout/LanguageSelector';
import {ChevronRight,LogOut,ShieldCheck,Menu,HelpCircle} from 'lucide-react';

// Adapted from the exported Plus screen: every preference and module uses the
// existing authenticated profile, device and role settings.
export default function MoreWorkspace(){
  useLocaleRender();
  const {logout}=useAuth(),{user,employee,role,roleLabel,principalRole,allowedModules}=useCurrentUser();
  const name=employee?.full_name||user?.full_name||user?.email||ui('My profile');
  const modules=modulesForRole(role,allowedModules).filter(m=>!user?.centralized_inventory?.enabled||!['distribution','driver'].includes(m.key));
  return <div data-sleek-screen="more" className="mx-auto max-w-3xl space-y-5">
    <h1 className="text-2xl font-bold">{ui('More')}</h1>
    <section className="rounded-xl border bg-white p-4"><div className="flex items-center gap-3"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-secondary text-lg font-bold text-primary">{name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()}</span><div className="min-w-0"><h2 className="break-words font-bold">{name}</h2><p className="text-xs text-muted-foreground">{ui(roleLabel||'Employee')}</p></div></div></section>
    <MyProfile embedded/>
    <section className="space-y-3"><h2 className="text-xs font-bold uppercase tracking-wide text-primary">{ui('Preferences')}</h2><div className="flex items-center justify-between rounded-xl border bg-white p-4"><span className="text-sm font-semibold">{ui('Language preferences')}</span><LanguageSelector id="more-language"/></div><DeviceNotificationSettings/></section>
    {(principalRole||role)==='admin'&&<section className="rounded-xl border bg-white p-4"><h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><ShieldCheck size={18}/>{ui('Role access')}</h2><p className="mb-3 text-xs text-muted-foreground">{ui('Manage saved module access for every role.')}</p><Link to="/team-workspaces?section=roles" className="flex min-h-12 items-center justify-between rounded-lg border px-3 text-sm font-semibold">{ui('Roles & organigram')}<ChevronRight size={18}/></Link></section>}
    <section className="space-y-3"><h2 className="text-xs font-bold uppercase tracking-wide text-primary">{ui('Modules')}</h2><nav className="divide-y rounded-xl border bg-white">{modules.map(({key,label,path,icon:Icon})=><Link key={key} to={path} className="flex min-h-14 items-center gap-3 px-4 py-3 text-sm font-semibold"><Icon size={20} className="text-primary"/><span className="flex-1">{label}</span><ChevronRight size={17} className="text-muted-foreground"/></Link>)}</nav></section>
    <button type="button" onClick={()=>window.dispatchEvent(new Event('soeicam:open-navigation'))} className="flex min-h-12 w-full items-center gap-3 rounded-xl border bg-white px-4 text-sm font-semibold"><Menu size={19}/>{ui('All ERP modules')}<ChevronRight size={17} className="ml-auto"/></button>
    <details className="rounded-xl border bg-white p-4"><summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold"><HelpCircle size={19}/>{ui('Help and guidance')}</summary><p className="mt-3 text-sm text-muted-foreground">{ui('Use the module list to open your workspaces. Each screen keeps its help buttons, filters and reports. Your role determines the actions available to you.')}</p></details>
    <button type="button" onClick={()=>logout()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white text-sm font-semibold text-red-700"><LogOut size={18}/>{ui('Sign Out')}</button>
  </div>;
}
