'use client';
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Navigate } from '@/lib/router';

export default function Page() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { role, loading } = useCurrentUser();
  if (loading) return <p role="status" className="p-8 text-sm text-slate-500">{ui("Opening deliveries...")}</p>;
  return <Navigate to={role === 'driver' ? '/distribution?tab=deliveries' : role === 'admin' ? '/team-workspaces?role=driver' : '/'} replace />;
}
