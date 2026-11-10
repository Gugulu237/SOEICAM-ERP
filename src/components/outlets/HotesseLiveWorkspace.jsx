
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import HotesseHome from '@/components/home/HotesseHome';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {DashboardIdentity} from '@/components/home/DashboardIdentity';
import {StaffWelcome} from '@/components/home/StaffMobileParts';
import {RefreshCw} from 'lucide-react';
import {useDashboardNavigation} from '@/hooks/useDashboardNavigation';
export default function HotesseLiveWorkspace() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const dashboardNavigation=useDashboardNavigation();
  const {roleLabel,employee,user}=useCurrentUser(),mobileHome=dashboardNavigation.activeTab==='home';

  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true, pending = false;
    const refresh = async () => {
      if (!active || pending) return;
      pending = true; setLoading(true); setError('');
      try { const result = await invokeFieldOps({ action: 'employeeDashboard', mode: 'hotesse' }); if (result.data.error) throw new Error(result.data.error); if (active) setData(result.data); }
      catch (failure) { if (active) setError(errorMessage(failure)); }
      finally { pending = false; if (active) setLoading(false); }
    };
    const visible = () => { if (!document.hidden) refresh(); };
    refresh(); const timer = window.setInterval(visible, 30000); window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [reload]);
  return <DashboardIdentity value={{roleName:roleLabel||'Hotesse',employeeName:data?.employee?.full_name||employee?.full_name||user?.full_name,centralHero:mobileHome}}><div className="space-y-4">
    {mobileHome&&<header className="relative pr-14 sm:hidden"><StaffWelcome date={data?.date} force/><Button size="icon" variant="ghost" aria-label={ui('Refresh shelves')} className="absolute right-0 top-0 h-12 w-12" disabled={loading} onClick={()=>setReload(value=>value+1)}><RefreshCw size={18} className={loading?'animate-spin':''}/></Button></header>}
    <div className={(mobileHome?'hidden sm:flex ':'flex ')+"justify-end"}><Button size="sm" variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}>{ui("Refresh shelves")}</Button></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{uiMessage(error)}</p>}
    <HotesseHome {...dashboardNavigation} data={data} loading={loading && !data} onRefresh={() => setReload(value => value + 1)} />
  </div></DashboardIdentity>;
}
