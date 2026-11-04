'use client';
import {UserButton} from '@clerk/nextjs';
import {ui} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import ClerkWidgetBoundary from '@/components/ClerkWidgetBoundary';

export default function ClerkAccountControl(){
  useLocaleRender();
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="font-semibold text-slate-900">{ui('Account')}</h2>
    <ClerkWidgetBoundary className="text-sm text-slate-500"><UserButton showName/></ClerkWidgetBoundary>
  </section>;
}
