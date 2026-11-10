import React from 'react';
import { Button } from '@/components/ui/button';

export default function DashboardTaskGrid({ label, tasks }) {
  return <nav data-task-grid aria-label={label} className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
    {tasks.map(({key,label:caption,icon:Icon,onSelect,disabled,primary}) => <Button key={key} type="button" variant="ghost" aria-label={caption} disabled={disabled} onClick={onSelect} className={'group flex h-auto min-h-32 min-w-0 flex-col items-center justify-center gap-3 whitespace-normal break-words rounded-2xl border px-3 py-5 text-center text-sm font-semibold leading-snug shadow-none sm:shadow-sm transition-colors focus-visible:ring-offset-2 [&_svg]:size-7 sm:h-auto sm:min-h-40 sm:whitespace-normal sm:text-base '+(primary?'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground':'border-slate-200 bg-white text-slate-900 hover:border-primary/40 hover:bg-primary/5')}>
      <span className={'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl sm:h-14 sm:w-14 '+(primary?'bg-white/15':'bg-slate-50 text-primary sm:bg-primary/10')}><Icon size={26} strokeWidth={1.7} aria-hidden="true"/></span>
      <span className="min-w-0 break-words leading-snug">{caption}</span>
    </Button>)}
  </nav>;
}
