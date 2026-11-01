'use client';
import React from 'react';
import {ShoppingBag,Wallet,AlertTriangle,Pencil} from 'lucide-react';
import {ui} from '@/lib/i18n';
export default function CustomerActionGrid({onSale,onReceive,onSpoilage,onEdit,disabled=false}) {
  return <nav aria-label={ui('Customer actions')} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
    {[[onSale,'Register sales',ShoppingBag],[onReceive,'Receive payments',Wallet],[onSpoilage,'Report spoilage',AlertTriangle],[onEdit,'Edit customer',Pencil]].filter(([action])=>action).map(([action,label,Icon])=>
      <button key={label} type="button" aria-label={ui(label)} disabled={disabled} onClick={action} className="flex min-h-28 min-w-0 flex-col items-center justify-center gap-3 rounded-2xl border bg-white p-3 text-center shadow-sm hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
        <span className="rounded-xl bg-primary/10 p-3 text-primary"><Icon size={24} aria-hidden="true"/></span><span className="break-words text-sm font-semibold">{ui(label)}</span>
      </button>)}
  </nav>;
}

