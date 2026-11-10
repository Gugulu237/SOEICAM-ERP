import React from 'react';
import {ArrowLeft} from 'lucide-react';
import {ui} from '@/lib/i18n';

export default function MobileCustomerHeader({title,subtitle,back,actions}) {
  return <header className="mb-4 flex min-w-0 items-center gap-3 sm:hidden">
    {back&&<button type="button" onClick={back.onClick} disabled={back.disabled} aria-label={back.label||ui('Back')} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-white disabled:opacity-50"><ArrowLeft size={20}/></button>}
    <div className="min-w-0 flex-1"><h1 className="break-words text-xl font-bold leading-tight">{title}</h1>{subtitle&&<p className="mt-1 break-words text-xs text-muted-foreground">{subtitle}</p>}</div>
    {actions&&<div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </header>;
}
