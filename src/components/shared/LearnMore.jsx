'use client';
import React,{useState} from 'react';
import {CircleHelp} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';

export default function LearnMore({title,children,iconOnly=false}) {
  const [open,setOpen]=useState(false);
  return <span className="inline-block" onClick={event=>event.stopPropagation()}>
    <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={ui('Learn more: {0}',title)} className={"inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-8"+(iconOnly?" min-w-11 justify-center sm:min-w-8":"")} onClick={()=>setOpen(true)}><CircleHelp size={iconOnly?17:14}/>{!iconOnly&&ui('Learn more')}</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-md" aria-describedby={undefined}><DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader><div className="space-y-2 text-xs leading-5 text-slate-600">{children}</div></DialogContent></Dialog>
  </span>;
}
