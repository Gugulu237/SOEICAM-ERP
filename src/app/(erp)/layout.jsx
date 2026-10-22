'use client';
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';

import AppLayout from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/AuthContext';
import { Navigate } from '@/lib/router';

export default function ERPLayout({ children }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { isLoadingAuth, isAuthenticated, authError, checkUserAuth, logout } = useAuth();
  if (isLoadingAuth) return <p role="status" className="p-10">{ui("Opening your SOEICAM workspace...")}</p>;
  if (authError) return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><section role="alert" className="max-w-lg rounded-2xl border bg-white p-8 shadow-sm"><h1 className="text-xl font-semibold text-slate-900">{authError.type === 'staff_link_required' ? ui("Your staff access is pending") : ui("Unable to open your workspace")}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{uiMessage(authError.message)}</p><div className="mt-6 flex gap-3"><button onClick={() => checkUserAuth()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">{ui("Check access again")}</button><button onClick={() => logout()} className="rounded-lg border px-4 py-2 text-sm font-medium">{ui("Sign out")}</button></div></section></main>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <AppLayout>{children}</AppLayout>;
}
