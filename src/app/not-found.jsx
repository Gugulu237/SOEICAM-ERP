'use client';
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import Link from 'next/link';
export default function NotFound() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
 return <main className="p-12 text-center"><h1 className="text-2xl font-bold">{ui("Page not found")}</h1><Link className="mt-4 inline-block underline" href="/">{ui("Return to your dashboard")}</Link></main>; }
