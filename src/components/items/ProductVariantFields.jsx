import React from 'react';
import { ui } from '@/lib/i18n';
import { PRODUCT_FLAVOURS, canonicalFlavour, flavourChoice, canonicalSize, productSizeChoices, variantFamily } from '@/lib/product-variants';

export default function ProductVariantFields({ item={}, values, onChange, disabled=false }) {
  const combined={...item,...values},flavour=canonicalFlavour(values.flavor),size=canonicalSize(values.size),sizes=productSizeChoices(combined);
  const selectClass='h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm disabled:opacity-50';
  return <>
    <label className="min-w-0 space-y-1 text-xs font-medium">{ui('Flavour')}<select aria-label={ui('Item flavour')} value={flavour} disabled={disabled} onChange={e=>onChange('flavor',e.target.value)} className={selectClass}><option value="">{ui('Choose flavour')}</option>{flavour && !flavourChoice(flavour) && <option value={flavour}>{ui('Existing value: {0}',flavour)}</option>}{PRODUCT_FLAVOURS.map(option=><option key={option.value} value={option.value}>{ui(option.label)}</option>)}</select></label>
    <label className="min-w-0 space-y-1 text-xs font-medium">{ui('Size')}<select aria-label={ui('Item size')} value={size} disabled={disabled} onChange={e=>onChange('size',e.target.value)} className={selectClass}><option value="">{ui('Choose size')}</option>{size && !sizes.includes(size) && <option value={size}>{ui('Existing value: {0}',values.size)}</option>}{sizes.map(value=><option key={value} value={value}>{value}</option>)}</select>{!variantFamily(combined) && <span className="block text-[11px] font-normal text-slate-500">{ui('Choose a product family to narrow sizes.')}</span>}{size && !sizes.includes(size) && <span className="block text-[11px] font-normal text-slate-500">{ui('Choose a listed gram size when updating this product size.')}</span>}</label>
  </>;
}
