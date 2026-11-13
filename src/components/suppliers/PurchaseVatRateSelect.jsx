import React from 'react';
import {formatNumber} from '@/lib/formatters';
import {ui} from '@/lib/i18n';
import {STANDARD_VAT_RATE} from '@/lib/sale-vat';

export default function PurchaseVatRateSelect({value,onChange,disabled,label}){
  return <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(Number(event.target.value))}>
    <option value={STANDARD_VAT_RATE}>{ui('{0}% VAT included',formatNumber(STANDARD_VAT_RATE,2))}</option>
    <option value={0}>{ui('No VAT')}</option>
  </select>;
}
