
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { useLocation, Navigate } from "@/lib/router";
import AppSidebar from "@/components/layout/AppSidebar";
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { canOpenFieldPath } from '@/lib/permissions';
import { permitsWorkspace } from '@/lib/workspace-navigation';
import TopBar from "@/components/layout/TopBar";
import { useAuth } from '@/lib/AuthContext';
import { NavigationProvider } from '@/lib/navigation-context';

export default function AppLayout({ children }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { user, role, loading, error, employee, allowedModules } = useCurrentUser();
  const location = useLocation();
  const { profileRefreshError, checkUserAuth } = useAuth();
  if (loading) return <div role="status" className="p-10 text-slate-500">{ui("Loading your workspace…")}</div>;
  if (error) return <div role="alert" className="p-10 text-red-700">{uiMessage(error)}<button className="ml-3 underline" onClick={() => window.location.reload()}>{ui("Refresh")}</button></div>;
  if (['commercial', 'driver', 'cashier', 'production_manager', 'hotesse'].includes(role) && employee?.status && employee.status !== 'active') return <div className="p-10 text-slate-700">{ui("Your staff account is not active. Please contact your manager.")}</div>;
  if (!canOpenFieldPath(role, location.pathname+location.search, allowedModules) || !permitsWorkspace(location.pathname+location.search,allowedModules)) return <Navigate to="/" replace />;
  return (
    <NavigationProvider key={[user?.id, employee?.id, role, allowedModules?.join(',')].join(':')} identity={[user?.id, employee?.id, role, allowedModules?.join(',')].join(':')}><div className="flex min-h-screen bg-background">
      <AppSidebar />
      <main data-erp-main className="flex-1 min-w-0 w-full">
        <TopBar />
        {profileRefreshError && <aside role="status" className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs"><p>{ui('The connection could not be refreshed. Your current input is kept.')}</p><button type="button" className="min-h-11 font-semibold underline" onClick={()=>checkUserAuth({background:true})}>{ui('Retry')}</button></aside>}
        <div data-erp-content className="mx-auto w-full min-w-0 max-w-7xl px-3 py-4 sm:px-5 sm:py-6 xl:px-8 xl:py-8">
          {children}
        </div>
      </main>
    </div></NavigationProvider>
  );
}
