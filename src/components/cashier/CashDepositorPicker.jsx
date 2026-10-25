'use client';
import React,{useState} from 'react';
import {ui} from '@/lib/i18n';
import {formatDate,formatXAF} from '@/lib/formatters';
import {cashDepositors} from '@/lib/cashier-receipts';
import HelpNotice from '@/components/shared/HelpNotice';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
export default function CashDepositorPicker({source,onSelect,onClose}){
 const [search,setSearch]=useState('');
 const rows=cashDepositors(source).filter(row=>(row.name+' '+row.reference).toLowerCase().includes(search.trim().toLowerCase()));
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2">{ui('Who is depositing the cash?')}<HelpNotice title={ui('Receive cash')}><p>{ui('Choose an existing Commercial collection, recorded cash sale or customer invoice. The receipt uses the saved sale; it does not create another sale. Customer receipts keep administrator approval before posting.')}</p></HelpNotice></DialogTitle></DialogHeader><Input autoFocus aria-label={ui('Search depositor or invoice')} placeholder={ui('Search depositor or invoice')} value={search} onChange={e=>setSearch(e.target.value)}/><div className="space-y-4">{['Commercial deposits','Recorded cash sales','Customer payments'].map(group=>{const records=rows.filter(row=>row.group===group);return records.length>0&&<section key={group}><h3 className="mb-2 text-xs font-semibold text-slate-500">{ui(group)}</h3><div className="space-y-2">{records.map(row=><button key={row.id} type="button" disabled={row.blocked} aria-label={ui('Receive cash from {0}',row.name)} onClick={()=>onSelect(row)} className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border p-3 text-left hover:border-primary hover:bg-green-50 disabled:opacity-60"><span className="min-w-0"><span className="block break-words text-sm font-semibold">{row.name}</span><span className="mt-1 block truncate text-xs text-slate-500">{row.group==='Commercial deposits'?formatDate(row.date):row.reference}</span>{row.blocked&&<span className="block text-xs text-red-700">{ui('Reconcile the collection records first.')}</span>}</span><span className="shrink-0 text-sm font-semibold">{formatXAF(row.amount)}</span></button>)}</div></section>;})}{!rows.length&&<p className="py-6 text-sm text-slate-500">{ui('No cash deposits or unpaid customer invoices match.')}</p>}</div><Button variant="outline" onClick={onClose}>{ui('Cancel')}</Button></DialogContent></Dialog>;
}
