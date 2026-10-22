
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui, getLocale } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Check, Loader2, Package, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { finishedItemSetupIssues,itemAvailabilityLabel } from '@/lib/item-readiness';
import { itemPriceDetails } from '@/lib/item-quick-edit';
import ProductVariantFields from './ProductVariantFields';
import ItemAttributesEditor from './ItemAttributesEditor';
import { PRODUCT_FAMILIES, MATERIAL_GROUPS } from '@/lib/inventory-groups';

const number = value => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 6 }).format(Number(value));
const money = (value, missing = ui("Review cost")) => value == null ? missing : `${number(value)} XAF`;

function Stat({ label, value, note }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3">
    <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
    <dd className="mt-1 break-words text-base font-semibold tabular-nums text-slate-900">{value}</dd>
    {note && <dd className="mt-1 text-[11px] leading-4 text-slate-500">{note}</dd>}
  </div>;
}

export default function QuickItemPanel({ item, draft, choices = [], unitsLoading = false, saving = false, error = '',
  stock = { status: 'loading', data: null, error: '' }, formId = 'quick-item', dirty = false,
  onChange, onRefresh, onSubmit, onCancel, attributeOptions = [] }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const missingDraftUnit = item.configuration_status === 'draft' && !item.unit_of_measure;
  const prices = { ...itemPriceDetails(item), ...(missingDraftUnit ? { unit: 'U/M', purchaseUnit: 'U/M', sellingUnit: 'U/M' } : {}) };
  const inventory = item.item_type !== 'service' && item.inventory_type !== 'service';
  const changedUnit = !!draft.unit_of_measure && draft.unit_of_measure !== prices.unit;
  const purchaseUnit = changedUnit ? draft.unit_of_measure : prices.purchaseUnit;
  const sellingUnit = changedUnit ? draft.unit_of_measure : prices.sellingUnit || prices.unit;
  const current = stock.status === 'ready' ? stock.data : null;
  const stockUnit = missingDraftUnit ? 'U/M' : current?.unit || prices.unit;
  const asOf = current?.as_of && new Date(current.as_of);

  return <form id={formId} onSubmit={onSubmit} noValidate aria-label={ui("Quick edit {0}", item.name)} aria-busy={saving}>
    {(item.configuration_status==='draft'||item.is_active===false)&&<div className="border-b bg-amber-50 px-5 py-3 text-sm text-amber-900"><strong>{ui(itemAvailabilityLabel(item))}</strong><p className="mt-1">{ui(item.configuration_status==='draft'?'Complete assembly setup and activate this product to use it in recipes.':'Activate this item to make it available for new operations.')}</p>{finishedItemSetupIssues(item).length>0&&<p className="mt-1">{ui('Still needed')}: {finishedItemSetupIssues(item).map(label=>ui(label)).join(', ')}</p>}</div>}
    <div className="bg-slate-50 px-5 py-4 sm:px-6">
      <dl aria-label={ui("Current item summary")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={ui("Recorded stock on hand")} value={!inventory ? 'Not stocked' : current ? `${number(current.quantity_on_hand)} ${stockUnit}` : '—'}
          note={!inventory ? 'Service item' : stock.status === 'error' ? 'Stock unavailable' : current ? 'Across the warehouses below' : 'Loading current stock...'} />
        <Stat label={ui("Usable stock")} value={!inventory ? 'Not stocked' : current ? `${number(current.usable_quantity)} ${stockUnit}` : '—'}
          note={inventory ? 'Approved, in-date lots; before order reservations' : undefined} />
        {prices.isAssembly && <Stat label={ui("Current selling price")} value={money(item.configuration_status === 'draft' && item.selling_price == null ? null : prices.sellingPrice, 'Set selling price')} note={`per ${prices.sellingUnit || prices.unit}`} />}
        <Stat label={prices.isAssembly ? ui("Manufacturing cost") : ui("Current purchase cost")}
          value={money(prices.isAssembly ? prices.manufacturingCost : prices.purchasePrice, prices.isAssembly ? 'Components needed' : 'Review cost')} note={`per ${prices.isAssembly ? prices.unit : prices.purchaseUnit}`} />
      </dl>
    </div>
    <div className="grid gap-6 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section aria-labelledby={`${formId}-prices`} className="min-w-0 space-y-4">
        <div><h3 id={`${formId}-prices`} className="text-sm font-semibold text-slate-900">{ui("Prices & units")}</h3><p className="mt-1 text-xs text-slate-500">{ui("Adjust the key details without leaving your inventory.")}</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          {prices.isAssembly && <label className="block space-y-1.5 text-xs font-medium text-slate-700">{ui("Selling price (XAF / ")}{sellingUnit})
            <Input autoFocus type="number" min="0" max="1000000000000" step="any" required
              value={draft.selling_price} disabled={saving} onChange={event => onChange('selling_price', event.target.value)} />
          </label>}
          {prices.isAssembly ? <label className="block space-y-1.5 text-xs font-medium text-slate-700">{ui("Manufacturing cost (XAF / ")}{prices.unit})
            <Input readOnly value={prices.manufacturingCost ?? 'Components needed'} aria-describedby={`${formId}-cost`} className="bg-slate-100 text-slate-600" />
            <span id={`${formId}-cost`} className="block text-[11px] font-normal leading-4 text-slate-500">{ui("Sum of the assembly components. Adjust components in the full item editor.")}</span>
          </label> : <label className="block space-y-1.5 text-xs font-medium text-slate-700">{ui("Purchase cost (XAF / ")}{purchaseUnit})
            <Input type="number" min="0" max="1000000000000" step="any" required value={draft.purchase_price}
              disabled={saving} onChange={event => onChange('purchase_price', event.target.value)} />
          </label>}
          <label className="block space-y-1.5 text-xs font-medium text-slate-700">{ui("Unit of Measure")}<select value={draft.unit_of_measure} disabled={saving || unitsLoading} onChange={event => onChange('unit_of_measure', event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm disabled:opacity-50">
              {!draft.unit_of_measure && <option value="">{ui("Select U/M")}</option>}
              {choices.map(unit => <option key={unit.code} value={unit.code}>{unit.name} ({unit.code})</option>)}
            </select>
            {unitsLoading && <span className="block text-[11px] font-normal text-slate-500">{ui("Loading units...")}</span>}
          </label>
          {inventory && <label className="block space-y-1.5 text-xs font-medium text-slate-700">{ui("Reorder point (")}{draft.unit_of_measure})
            <Input type="number" min="0" max="1000000000000" step="any" required value={draft.reorder_level}
              disabled={saving} onChange={event => onChange('reorder_level', event.target.value)} />
          </label>}
        </div>
        {!changedUnit && (prices.purchaseUnit !== prices.unit || sellingUnit !== prices.unit) && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">{ui("Existing prices use the purchase and sales units shown above. Stock is counted in ")}{prices.unit}.</p>}
        <p className="text-[11px] leading-5 text-slate-500">{ui("Changing an existing unit requires confirmation of its effect across the app, including items with stock history.")}</p>
        {changedUnit && inventory && <p className="text-[11px] leading-5 text-amber-900">{ui("The stock report still uses the recorded unit (")}{stockUnit}{ui("). Your new unit applies after a successful save.")}</p>}
      </section>
      <section aria-labelledby={`${formId}-stock`} aria-busy={inventory && stock.status === 'loading'} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div><h3 id={`${formId}-stock`} className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Package size={16} />{ui("Current stock")}</h3><p className="mt-1 text-[11px] leading-4 text-slate-500">{ui("Recorded balances by warehouse")}</p></div>
          {inventory && <Button type="button" variant="ghost" size="sm" aria-label={ui("Refresh current stock")} onClick={onRefresh} disabled={stock.status === 'loading' || saving} className="h-8 gap-1.5 px-2 text-xs"><RefreshCw size={13} className={stock.status === 'loading' ? 'animate-spin' : ''} />{ui("Refresh")}</Button>}
        </div>
        {!inventory ? <p className="py-8 text-center text-sm text-slate-500">{ui("Service items are not stocked.")}</p>
          : stock.status === 'error' ? <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><p>{uiMessage(stock.error)}</p><Button type="button" variant="outline" size="sm" disabled={saving} onClick={onRefresh} className="mt-2 h-8 text-xs">{ui("Retry stock report")}</Button></div>
            : !current ? <p role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />{ui("Loading current stock...")}</p>
              : <>
                <div className="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs"><caption className="sr-only">{ui("Current stock by warehouse in ")}{stockUnit}</caption>
                    <thead className="sticky top-0 bg-slate-100 text-[11px] text-slate-500"><tr><th scope="col" className="px-3 py-2 font-medium">{ui("Warehouse")}</th><th scope="col" className="px-3 py-2 text-right font-medium">{ui("On hand")}</th><th scope="col" className="px-3 py-2 text-right font-medium">{ui("Usable")}</th></tr></thead>
                    <tbody>{current.warehouses.length ? current.warehouses.map(warehouse => <tr key={warehouse.id} className="border-t border-slate-100"><th scope="row" className="px-3 py-2 font-medium text-slate-700">{warehouse.name}</th><td className="px-3 py-2 text-right tabular-nums">{number(warehouse.quantity_on_hand)}</td><td className="px-3 py-2 text-right tabular-nums">{number(warehouse.usable_quantity)}</td></tr>) : <tr><td colSpan={3} className="px-3 py-5 text-center text-slate-500">{ui("No recorded stock at any warehouse.")}</td></tr>}</tbody>
                  </table>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                  <div><dt className="text-slate-500">{ui("Recorded reorder point")}</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-700">{number(current.reorder_level)} {stockUnit}{current.below_reorder && <span className="ml-1.5 text-amber-800">{ui("Below reorder point")}</span>}</dd></div>
                  <div><dt className="text-slate-500">{ui("Recorded stock value")}</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-700">{money(current.stock_value)}</dd></div>
                  <div className="col-span-2"><dt className="inline text-slate-500">{ui("Held or expired stock: ")}</dt><dd className="inline font-medium tabular-nums text-slate-700">{number(current.blocked_quantity)} {stockUnit}</dd></div>
                </dl>
                {asOf && !Number.isNaN(asOf.valueOf()) && <p className="mt-3 text-[10px] leading-4 text-slate-400">{ui("Stock checked ")}{asOf.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{ui(". Refresh for the latest balances.")}</p>}
              </>}
      </section>
    </div>
    {inventory && <section className="space-y-4 border-t border-slate-200 px-5 py-5 sm:px-6" aria-labelledby={`${formId}-attributes`}>
      <div><h3 id={`${formId}-attributes`} className="text-sm font-semibold text-slate-900">{ui('Classification & attributes')}</h3><p className="mt-1 text-xs text-slate-500">{ui('These details organize the catalogue and help find assembly components.')}</p></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-medium">{prices.isAssembly ? ui('Product family') : ui('Material group')}<Input list={`${formId}-groups`} value={(prices.isAssembly ? draft.product_family : draft.material_group) || ''} disabled={saving} maxLength={80} placeholder={ui('Choose or add a group')} onChange={e=>onChange(prices.isAssembly ? 'product_family' : 'material_group',e.target.value)}/><datalist id={`${formId}-groups`}>{(prices.isAssembly ? PRODUCT_FAMILIES : MATERIAL_GROUPS).map(value=><option key={value} value={value}/>)}</datalist></label>
        {prices.isAssembly ? <ProductVariantFields item={item} values={draft} onChange={onChange} disabled={saving}/> : <label className="space-y-1 text-xs font-medium">{ui('Size')}<Input aria-label={ui('Item size')} value={draft.size || ''} disabled={saving} maxLength={80} onChange={e=>onChange('size',e.target.value)}/></label>}
      </div>
      <ItemAttributesEditor value={draft.attributes} onChange={value=>onChange('attributes',value)} disabled={saving} suggestions={attributeOptions}/>
    </section>}
    <div className="border-t border-slate-200 px-5 py-4 sm:px-6">
      {error && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{uiMessage(error)}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-slate-500">{saving ? ui("Saving your changes...") : dirty ? ui("You have unsaved changes.") : ui("The details shown are the saved values.")}</p><div className="ml-auto flex shrink-0 gap-2">
        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onCancel}>{ui("Cancel")}</Button>
        <Button type="submit" size="sm" disabled={saving || !dirty} className="gap-1.5">{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{saving ? ui("Saving...") : ui("Save changes")}</Button>
      </div></div>
    </div>
  </form>;
}
