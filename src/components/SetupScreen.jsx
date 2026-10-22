'use client';
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';

import { Database, ShieldCheck, Factory, ShoppingBag } from 'lucide-react';
export default function SetupScreen() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <main className="flex min-h-screen items-center justify-center bg-[#094178] p-6"><section className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-xl"><div className="bg-sky-50 p-8"><img src="/brand/soeicam-logo.png" alt={ui("SOEICAM")} className="mb-4 h-auto w-44 rounded-xl bg-white p-1.5" /><p className="text-xs font-bold tracking-[0.3em] text-slate-800">{ui("SOEICAM · YOLA ERP")}</p><h1 className="mt-4 text-3xl font-bold text-slate-950">{ui("Your new workspace is ready to connect")}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-800">{ui("The Next.js application is running. Connect the SOEICAM Supabase project to load your existing records and staff accounts.")}</p></div><div className="space-y-6 p-8"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[[Database,ui("56 table schemas")],[ShieldCheck,ui("Role-based access")],[Factory,'Production'],[ShoppingBag,ui("Field sales")]].map(([Icon,label])=><div key={label} className="rounded-xl bg-slate-50 p-4"><Icon size={22} className="mb-3 text-sky-700" /><p className="text-xs font-semibold">{label}</p></div>)}</div><div className="rounded-xl border p-5"><h2 className="font-semibold">{ui("Connection required")}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{ui("Your administrator needs to finish the database connection and migration before sign-in is available. Existing SOEICAM records have not been replaced with sample data.")}</p></div></div></section></main>;
}
