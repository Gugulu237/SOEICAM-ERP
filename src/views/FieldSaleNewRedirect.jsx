
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Navigate, useSearchParams } from '@/lib/router';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export default function FieldSaleNewRedirect() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [params] = useSearchParams();
  const { role, loading } = useCurrentUser();
  if (loading) return <p role="status" className="p-6 text-sm text-slate-500">{ui("Opening Field POS...")}</p>;
  const query = new URLSearchParams({ section: 'pos', new: '1' });
  if (params.get('customer')) query.set('customer', params.get('customer'));
  if (params.get('commercial') && role === 'admin') query.set('employee', params.get('commercial'));
  return <Navigate replace to={'/commercial?' + query} />;
}
