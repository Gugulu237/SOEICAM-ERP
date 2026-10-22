'use client';
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';

export default function ErrorPage({ reset }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
 return <main className="p-12"><h1 className="text-xl font-semibold">{ui("This page could not load")}</h1><p className="mt-2 text-slate-600">{ui("Retry the page. If the problem continues, contact your administrator.")}</p><button onClick={reset} className="mt-4 rounded bg-slate-900 px-4 py-2 text-white">{ui("Retry")}</button></main>; }
