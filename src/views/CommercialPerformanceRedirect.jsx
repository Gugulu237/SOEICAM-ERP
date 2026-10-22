
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Navigate, useSearchParams } from '@/lib/router';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export default function CommercialPerformanceRedirect() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [params] = useSearchParams();
  const { role, loading } = useCurrentUser();
  if (loading) return <p role="status" className="p-6 text-sm text-slate-500">{ui("Opening Commercial performance...")}</p>;
  const selected = params.get('commercial');
  const query = new URLSearchParams({ section: 'performance' });
  if (selected && role === 'admin') query.set('employee', selected);
  if (selected && role === 'production_manager') query.set('commercial', selected);
  return <Navigate replace to={'/commercial?' + query} />;
}
