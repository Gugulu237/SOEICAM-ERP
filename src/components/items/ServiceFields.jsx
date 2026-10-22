
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';

import React from 'react';
import { Input } from '@/components/ui/input';
export default function ServiceFields({ form, set }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <section className="space-y-4 rounded-xl border p-4"><h2 className="text-sm font-semibold">{ui("Internal service cost")}</h2><label className="block space-y-1.5 text-sm">{ui('Cost (XAF / U/M)')}<Input type="number" min="0" step="any" value={form.purchase_price} onChange={event=>set('purchase_price',event.target.value)}/></label><p className="text-xs text-slate-500">{ui('Services are cost components and do not track stock. Only finished products carry a selling price.')}</p></section>;
}
