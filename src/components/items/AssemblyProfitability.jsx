import React from 'react';
import { ui } from '@/lib/i18n';
import { formatNumber, formatXAF } from '@/lib/formatters';
import { assemblyProfitability } from '@/lib/assembly-pricing';
import HelpNotice from '@/components/shared/HelpNotice';

export default function AssemblyProfitability({cost,sellingPrice,compact=false}) {
  const values=assemblyProfitability(cost,sellingPrice);
  const percent=value=>value==null?'\u2014':formatNumber(value,1)+'%';
  const entries=[...(compact?[]:[['Estimated profit / unit',values.profit==null?'\u2014':formatXAF(values.profit),values.profit]]),['Markup',percent(values.markup),values.markup],['Margin',percent(values.margin),values.margin]];
  return <div className={compact?'min-w-0':'space-y-1'}>
    {!compact&&<div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-slate-600">{ui('Estimated profitability')}</span><HelpNotice title={ui('Markup and margin')}><p>{ui('Markup = (selling price - component cost) / component cost. Margin = (selling price - component cost) / selling price. Estimates exclude operating expenses and use current registered component costs. A dash means the basis is missing or zero.')}</p></HelpNotice></div>}
    <dl className={compact?'grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]':'grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-xs'}>{entries.map(([label,value,numeric])=><div key={label} className="min-w-0"><dt className="break-words text-slate-500">{ui(label)}</dt><dd className={'mt-0.5 break-words font-semibold tabular-nums '+(numeric<0?'text-red-700':'text-green-800')}>{value}</dd></div>)}</dl>
  </div>;
}
