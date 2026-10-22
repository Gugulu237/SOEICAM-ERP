
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import AssemblyComponents from "@/components/items/AssemblyComponents";

export default function AssemblyFields({ components, setComponents, products, assets, units, excludedProductIds, onCatalogChange, disabled }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;


  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-purple-50 border border-purple-200 p-3 text-sm text-purple-800">{ui("Add the components needed for one finished-product U/M. Costs start from each item's registered cost. You can adjust a unit cost for this assembly; compatible U/M changes convert the cost automatically.")}</div>
      <AssemblyComponents components={components} setComponents={setComponents} products={products} assets={assets} units={units} excludedProductIds={excludedProductIds} onCatalogChange={onCatalogChange} disabled={disabled} />
    </div>
  );
}
