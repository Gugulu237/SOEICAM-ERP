import React from 'react';
import { Input } from '@/components/ui/input';
import { ui } from '@/lib/i18n';
import { assemblyBucketYield, bucketYieldWeight } from '@/lib/assembly-yield';
import { formatNumber } from '@/lib/formatters';

export default function AssemblyYieldFields({item={},values,onChange,disabled=false}) {
  const combined={...item,...values},estimate=assemblyBucketYield(combined);
  const volume=/ml$/i.test(estimate.size);
  return <section className="space-y-3 rounded-xl border border-primary/20 bg-secondary/40 p-4" aria-label={ui('Manufacturing yield')}>
    <div><h2 className="text-sm font-semibold text-foreground">{ui('Manufacturing yield')}</h2><p className="mt-1 text-xs text-muted-foreground">{ui('The finished-product assembly supplies the yield estimate used by new and revised recipes.')}</p></div>
    {!estimate.family||!estimate.size?<p className="text-sm text-muted-foreground">{ui('Choose the yogurt family and size to estimate output per 30 L bucket.')}</p>:<>
      {volume&&<label className="block space-y-1 text-sm font-medium">{ui('Net weight per unit (g)')}<Input aria-label={ui('Net weight per unit (g)')} type="number" min="0.001" max="100000" step="any" disabled={disabled} value={values.yogurt_net_weight_g??''} onChange={e=>onChange('yogurt_net_weight_g',e.target.value)}/><span className="block text-xs font-normal text-muted-foreground">{ui('Enter measured net grams for volume sizes; ml is not converted to grams.')}</span></label>}
      <div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1 text-sm font-medium">{ui('Estimated units per 30 L bucket')}<Input aria-label={ui('Estimated units per 30 L bucket')} type="number" min="1" max="1000000" step="1" disabled={disabled} placeholder={String(estimate.estimated_units||'')} value={values.yogurt_units_per_bucket??''} onChange={e=>onChange('yogurt_units_per_bucket',e.target.value)}/><span className="block text-xs font-normal text-muted-foreground">{ui('Leave blank to use the size-based estimate. Enter a reviewed yield to override it.')}</span></label>
        <div className="rounded-lg bg-white p-3"><p className="text-xs text-muted-foreground">{ui('Expected output per bucket')}</p><p className="mt-1 text-xl font-semibold text-primary">{estimate.units?formatNumber(estimate.units):'—'} <span className="text-sm font-normal">{ui('units')}</span></p><p className="mt-1 text-xs text-muted-foreground">{ui('Size')}: {estimate.size} · {ui('Family estimate')}: {bucketYieldWeight(estimate.family)} kg</p></div></div>
      <p className="text-xs text-muted-foreground">{ui('Estimates plan packaging requirements. Actual finished stock is recorded only when production is completed.')}</p>
    </>}
  </section>;
}
