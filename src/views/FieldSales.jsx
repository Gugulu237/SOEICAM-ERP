
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Navigate, useSearchParams } from '@/lib/router';
import { useCurrentUser } from '@/hooks/useCurrentUser';

// Existing bookmarks open the live vehicle workspace instead of the retired
// standalone POS that still queried Commercial custody stock.
export default function FieldSales() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [params] = useSearchParams();
  const { role, loading } = useCurrentUser();
  if (loading) return <p role="status" className="p-6 text-sm text-slate-500">{ui("Opening Field POS...")}</p>;
  const commercialId = params.get('commercial');
  return <Navigate replace to={(role === 'admin' ? '/commercial?section=workspace' : '/commercial?section=pos') + (commercialId && role === 'admin' ? '&employee=' + encodeURIComponent(commercialId) : '')} />;
}
