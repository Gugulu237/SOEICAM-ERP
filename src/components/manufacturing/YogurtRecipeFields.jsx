import React from 'react';
import { ui } from '@/lib/i18n';
import { Input } from '@/components/ui/input';

export const NativeSelect=({label,value,onChange,children,disabled=false})=><label className="block min-w-0 text-sm text-slate-700"><span className="mb-1 block font-medium">{label}</span><select aria-label={label} value={value || ''} onChange={e=>onChange(e.target.value)} disabled={disabled} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm disabled:bg-slate-50"><option value="">{ui('Select.')}</option>{children}</select></label>;
export const NumberField=({label,value,onChange,disabled=false,step='any',min=0})=><label className="block text-sm text-slate-700"><span className="mb-1 block font-medium">{label}</span><Input aria-label={label} type="number" min={min} step={step} value={value ?? ''} disabled={disabled} onChange={e=>onChange(e.target.value)}/></label>;
