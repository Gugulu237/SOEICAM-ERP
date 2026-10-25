'use client';
import {useEffect} from 'react';
import {recoverChunkLoad,isChunkLoadFailure} from '@/lib/chunk-recovery';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';

export default function ErrorPage({ error,retry,reset }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
 useEffect(()=>{recoverChunkLoad(error,window);},[error]);
 const reload=()=>window.location.reload();
 const recover=()=>isChunkLoadFailure(error)?reload():(retry||reset||reload)();
 return <main className="p-12"><h1 className="text-xl font-semibold">{ui("This page could not load")}</h1><p className="mt-2 text-slate-600">{ui("Retry the page. If the problem continues, contact your administrator.")}</p><button onClick={recover} className="mt-4 rounded bg-primary px-4 py-2 text-white">{ui("Retry")}</button></main>; }
