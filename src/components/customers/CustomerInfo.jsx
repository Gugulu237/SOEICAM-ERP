'use client';
import React,{useState} from 'react';
import {CircleAlert} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
export default function CustomerInfo({title,children}){
  const [open,setOpen]=useState(false);
  return <span className="inline-flex align-middle" onClick={e=>e.stopPropagation()}>
    <button type="button" aria-label={ui('More information: {0}',title)} aria-haspopup="dialog" aria-expanded={open} title={ui('Learn more')} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary" onClick={()=>setOpen(true)}><CircleAlert size={14}/></button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-md" aria-describedby={undefined}><DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader><div className="space-y-2 text-xs leading-5 text-slate-600">{children}</div></DialogContent></Dialog>
  </span>;
}
