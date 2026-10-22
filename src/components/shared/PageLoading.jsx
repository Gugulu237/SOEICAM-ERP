'use client';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
export default function PageLoading() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <div role="status" aria-live="polite" aria-label={ui("Loading page")} className="space-y-5 py-2">
    <p className="text-sm text-slate-500">{ui("Opening workspace…")}</p>
    <div aria-hidden="true" className="h-7 w-48 animate-pulse rounded-md bg-slate-200" />
    <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2"><div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white" /><div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white" /></div>
  </div>;
}
