
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';

import React from 'react';
import { Input } from '@/components/ui/input';
import ItemAccountSelect from './ItemAccountSelect';

export default function InventoryFields({ form, set, accounts, suppliers, isAssembly = false, estimatedCost = 0, quantityOnHand = 0, purchaseUnit = form.unit_of_measure }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <div className="space-y-5">
    <div className={isAssembly?"grid gap-4 md:grid-cols-2":"grid gap-4"}>
      <section className="space-y-4 rounded-xl border border-slate-200 p-4"><h2 className="text-sm font-semibold text-slate-900">{ui("Purchase information")}</h2>
        <label className="block space-y-1.5 text-sm font-medium">{isAssembly ? ui("Component cost") : ui("Cost")}{ui(" (XAF / ")}{isAssembly ? form.unit_of_measure : purchaseUnit})<Input type="number" min="0" step="any" readOnly={isAssembly} value={isAssembly ? estimatedCost : form.purchase_price} onChange={event => set('purchase_price', event.target.value)} /></label>
        {isAssembly && <p className="text-xs text-slate-500">{ui("Calculated from the components for one ")}{form.unit_of_measure}.</p>}
        {!isAssembly && purchaseUnit !== form.unit_of_measure && <p className="text-xs text-amber-800">{ui("Existing purchase pricing is per ")}{purchaseUnit}{ui("; stock is counted in ")}{form.unit_of_measure}.</p>}
        <ItemAccountSelect label={ui("COGS Account")} value={form.cogs_account_id} onChange={value => set('cogs_account_id', value)} accounts={accounts} types={['cogs']} />
        <label className="block space-y-1.5 text-sm font-medium">{ui("Preferred vendor ")}<span className="font-normal text-slate-400">{ui("(optional)")}</span><select value={form.preferred_supplier_id || ''} onChange={event => set('preferred_supplier_id', event.target.value)} className="h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui("None selected")}</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
      </section>
      {isAssembly && <section className="space-y-4 rounded-xl border border-slate-200 p-4"><h2 className="text-sm font-semibold text-slate-900">{ui("Sales information")}</h2>
        <label className="block space-y-1.5 text-sm font-medium">{ui("Sales price (XAF / U/M)")}<Input type="number" min="0" step="0.01" value={form.selling_price} onChange={event => set('selling_price', event.target.value)} /></label>
        <ItemAccountSelect label={ui("Income Account")} value={form.revenue_account_id} onChange={value => set('revenue_account_id', value)} accounts={accounts} types={['revenue', 'other_income']} />
        <p className="text-xs leading-5 text-slate-500">{ui("Sales revenue is posted to the selected income account.")}</p>
      </section>}
    </div>
    <section className="space-y-4 rounded-xl border border-slate-200 p-4"><h2 className="text-sm font-semibold text-slate-900">{ui("Inventory information")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]"><ItemAccountSelect label={ui("Asset Account")} value={form.inventory_account_id} onChange={value => set('inventory_account_id', value)} accounts={accounts} types={['asset']} />
        <label className="block space-y-1.5 text-sm font-medium">{ui("Reorder point")}<Input type="number" min="0" step="any" value={form.reorder_level} onChange={event => set('reorder_level', event.target.value)} /></label>
        <label className="block space-y-1.5 text-sm font-medium">{ui("Quantity on hand")}<Input readOnly value={quantityOnHand} /><span className="block text-xs font-normal text-slate-500">{form.unit_of_measure}{ui(" · from stock records")}</span></label>
      </div><p className="text-xs text-slate-500">{ui("Record quantities through a stock receipt or inventory adjustment.")}</p>
    </section>
  </div>;
}
