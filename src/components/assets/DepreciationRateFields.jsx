import {ui} from '@/lib/i18n';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {flatDepreciationTerms} from '@/lib/asset-schedule';
import {formatXAF} from '@/lib/formatters';

export default function DepreciationRateFields({mode,months,annualRate,basis,onChange,remaining=false}) {
  let terms;try{terms=flatDepreciationTerms({mode,months,annualRate,basis});}catch{ /* Incomplete form. */ }
  return <div className="space-y-3">
    <div><Label htmlFor="depreciation-rate-mode">{ui('Set depreciation by')}</Label><select id="depreciation-rate-mode" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={mode} onChange={e=>onChange({mode:e.target.value})}><option value="life">{ui('Useful life')}</option><option value="rate">{ui('Annual flat rate')}</option></select></div>
    {mode==='rate'?<div><Label htmlFor="asset-annual-rate">{ui('Annual flat rate (%)')}</Label><Input id="asset-annual-rate" type="number" min="1" max="1200" step="any" value={annualRate} onChange={e=>onChange({annualRate:e.target.value})} /><p className="mt-1 text-xs text-slate-500">{ui('For example, 20% per year spreads the depreciable value over 5 years.')}</p></div>:<div><Label htmlFor="asset-months">{ui(remaining?'Remaining useful life (months)':'Useful Life (months)')}</Label><Input id="asset-months" type="number" min="1" max="1200" step="1" value={months} onChange={e=>onChange({months:e.target.value})} /></div>}
    <div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{ui('Monthly expense: ')}{terms?formatXAF(terms.monthly_amount):'—'}</strong>{terms&&<p>{ui('{0} months · {1}% per year',terms.months,Number(terms.annual_rate.toFixed(4)))}</p>}<p className="mt-1 text-xs text-slate-600">{ui(remaining?'The revised rate applies to remaining depreciable value. Posted charges stay unchanged.':'Monthly expense = (cost − residual value) × annual rate ÷ 100 ÷ 12, or depreciable value ÷ useful-life months.')}</p></div>
  </div>;
}
