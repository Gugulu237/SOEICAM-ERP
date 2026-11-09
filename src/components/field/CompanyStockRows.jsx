import React from 'react';
import {ui} from '@/lib/i18n';
import {formatQuantity} from '@/lib/formatters';
import ProductThumb from '@/components/shared/ProductThumb';

export const companyStockProducts=data=>(data?.products||[]).filter(product=>Number.isFinite(Number(product.available))&&Number(product.available)>0).sort((left,right)=>String(left.name||'').localeCompare(String(right.name||'')));

export default function CompanyStockRows({products=[]}){
  return <ul className="divide-y divide-slate-100">{products.map(product=><li key={product.id} className="flex min-w-0 items-center gap-3 py-3"><ProductThumb product={product} size={44}/><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{product.name}</p>{product.sku&&<p className="text-xs text-slate-500">{product.sku}</p>}</div><div className="max-w-[40%] text-right"><p className="text-[11px] text-slate-500">{ui('Available for sale')}</p><p className="break-words text-xl font-bold tabular-nums text-green-800">{formatQuantity(product.available)} <span className="text-xs font-medium">{product.unit}</span></p></div></li>)}</ul>;
}
