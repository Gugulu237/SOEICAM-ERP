import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { ui } from '@/lib/i18n';

// Phone transactions use a screen-height frame: one back header, a scrolling
// form and a persistent action footer. Desktop retains the existing modal.
export const supplierTransactionClass='max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:flex max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:flex-col max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-none max-sm:border-0 max-sm:p-0 max-sm:[&>button.absolute]:hidden';
export const supplierTransactionBody='contents max-sm:block max-sm:min-h-0 max-sm:flex-1 max-sm:space-y-4 max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:px-5 max-sm:py-4';
export const supplierTransactionFooter='max-sm:shrink-0 max-sm:border-t max-sm:bg-white max-sm:px-5 max-sm:py-3 max-sm:pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]';
export function SupplierTransactionHeader({phone,title,description,onBack,disabled}) {
  if(!phone)return <DialogHeader><DialogTitle>{title}</DialogTitle>{description&&<p className="text-xs text-muted-foreground">{description}</p>}</DialogHeader>;
  return <div className="flex shrink-0 items-center gap-3 border-b bg-white px-5 pb-3 pt-4"><button type="button" aria-label={ui('Back')} disabled={disabled} onClick={onBack} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-white disabled:opacity-50"><ArrowLeft size={20}/></button><DialogHeader className="min-w-0 flex-1 space-y-1 pr-0"><DialogTitle className="break-words text-xl font-bold leading-tight">{title}</DialogTitle>{description&&<p className="text-xs leading-4 text-muted-foreground">{description}</p>}</DialogHeader></div>;
}
