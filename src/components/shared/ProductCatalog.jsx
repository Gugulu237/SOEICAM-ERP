
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useMemo } from 'react';
import { usePageState } from '@/lib/navigation-context';
import { Check, PackageSearch, Plus, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ProductPhoto } from './ProductThumb';
import { normalizeProductText, productPresentation } from '@/lib/product-images';
import { formatXAF } from '@/lib/formatters';
import { isAssemblyInventoryType } from '@/lib/item-types';

export default function ProductCatalog({ products, onSelect, lines = [], selling = false, selecting = false, disabled = false, emptyMessage = ui("No products yet."), actions = undefined, renderDetails = undefined, hidePrice = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const picking = selling || selecting;
  const [search, setSearch] = usePageState(picking ? 'product-picker:search' : 'catalogue:search', '');
  const [family, setFamily] = usePageState(picking ? 'product-picker:family' : 'catalogue:family', 'All');
  const [flavor, setFlavor] = usePageState(picking ? 'product-picker:flavor' : 'catalogue:flavor', 'All');
  const decorated = useMemo(() => products.map((product) => ({ product, ...productPresentation(product) })), [products]);
  const families = [...new Set(decorated.map((p) => p.family))];
  const flavors = [...new Set(decorated.map((p) => p.flavor).filter(Boolean))];
  const filtered = decorated.filter((p) => (family === 'All' || p.family === family) && (flavor === 'All' || p.flavor === flavor)
    && normalizeProductText([p.product.name, p.product.sku, p.product.category, p.size, p.flavor].join(' ')).includes(normalizeProductText(search)));
  const reset = () => { setSearch(''); setFamily('All'); setFlavor('All'); };
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
          <Input aria-label={ui("Search products")} placeholder={ui("Find a product, flavor or code…")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 bg-white pl-10 pr-10" />
          {search && <button type="button" aria-label={ui("Clear product search")} onClick={() => setSearch('')} className="absolute right-0 top-0 flex h-11 w-10 items-center justify-center"><X size={16} /></button>}
        </div>
        {flavors.length > 1 && <select aria-label={ui("Filter by flavor")} value={flavor} onChange={(e) => setFlavor(e.target.value)} className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm sm:max-w-40">
          <option value="All">{ui("All flavors")}</option>{flavors.map((f) => <option key={f}>{f}</option>)}
        </select>}
      </div>
      {families.length > 1 && <div className="flex flex-wrap gap-2" aria-label={ui("Product categories")}>
        {['All', ...families].map((f) => <button type="button" key={f} aria-pressed={family === f} onClick={() => setFamily(f)}
          className={`min-h-10 rounded-full border px-4 text-sm font-medium transition-colors ${family === f ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}>{f}</button>)}
      </div>}
      <div className="flex items-center justify-between text-xs text-slate-500"><span>{filtered.length}{ui(" product")}{filtered.length !== 1 ? 's' : ''}</span>{picking && <span>{ui("Tap a photo to add")}</span>}</div>
      {!filtered.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center">
        <PackageSearch className="mx-auto mb-3 h-9 w-9 text-slate-400" /><p className="text-sm text-slate-600">{products.length ? ui("No products match these filters.") : emptyMessage}</p>
        {products.length > 0 && <Button variant="link" onClick={reset}>{ui("Clear filters")}</Button>}
      </div> : <div className={`grid grid-cols-2 gap-3 ${picking ? 'sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'}`}>
        {filtered.map(({ product, size, flavor: productFlavor }) => {
          const quantity = Number(lines.find((line) => line.product_id === product.id)?.quantity) || 0;
          const remaining = Math.max(0, Math.round(((product.quantity || 0) - quantity) * 1000) / 1000);
          const unavailable = picking && (remaining <= 0 || (selling && !(Number(product.selling_price) > 0)));
          return <article key={product.id} className={`group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-white transition-shadow hover:shadow-md ${quantity ? 'border-amber-400 ring-1 ring-amber-400' : 'border-slate-200'}`}>
            <button type="button" disabled={disabled || unavailable} onClick={() => onSelect(product)} aria-label={picking ? ui("Add {0} to {1}", product.name, selling ? 'sale' : 'selection') : ui("Open {0}", product.name)}
              className="flex flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 disabled:cursor-default">
              <div className="relative w-full">
                <ProductPhoto product={product} className="aspect-[4/3] w-full" imageClassName="p-2 transition-transform group-hover:scale-105" />
                {size && <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-1 text-[11px] font-semibold text-slate-800 shadow-sm">{size}</span>}
                {quantity > 0 && <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-amber-400 px-2 py-1 text-xs font-bold text-slate-900"><Check size={12} />{quantity} {selecting ? ui("selected") : ui("in cart")}</span>}
              </div>
              <div className="flex w-full flex-1 flex-col p-3">
                <span className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{productFlavor || product.category || product.inventory_type?.replaceAll('_', ' ') || ui("Product")}</span>
                <h3 className="mb-1 break-words text-sm font-semibold leading-snug text-slate-900">{product.name}</h3>
                {!picking && <p className="mb-2 text-xs text-slate-500">{product.sku || ui("No code")}{isAssemblyInventoryType(product.inventory_type) ? ` · ${(product.components || []).length} components` : ''}</p>}
                <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-3">
                  <div>{!selecting && !hidePrice && <div className="text-sm font-bold tabular-nums text-slate-900">{formatXAF(product.selling_price || 0)}</div>}
                    {picking && <div className={`mt-1 text-[11px] ${remaining > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>{selling && !(Number(product.selling_price) > 0) ? ui("Price needed") : `${remaining} ${product.storage_unit || ui("units")} left`}</div>}
                    {!picking && product.quantity != null && <p className="mt-1 text-xs text-slate-500">{product.quantity} {product.storage_unit || ui("units")}{ui(" on hand")}</p>}
                    {!picking && product.is_active === false && <span className="text-xs text-slate-500">{ui("Inactive")}</span>}
                  </div>
                  {picking && <span className={`flex h-9 w-9 items-center justify-center rounded-full ${unavailable ? 'bg-slate-100 text-slate-400' : 'bg-amber-400 text-slate-900'}`}><Plus size={18} /></span>}
                </div>
              </div>
            </button>
            {renderDetails && <div className="border-t border-slate-100 p-3">{renderDetails(product)}</div>}
            {actions && <div className="border-t border-slate-100 px-2 py-1 text-right">{actions(product)}</div>}
          </article>;
        })}
      </div>}
    </div>
  );
}
