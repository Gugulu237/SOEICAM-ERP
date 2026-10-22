
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { lazy, Suspense, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { COMPONENT_TYPES } from '@/lib/assembly-components';
import AssetDialog from '@/components/assets/AssetDialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const ItemForm = lazy(() => import('@/views/ItemForm'));

export default function NewAssemblyComponentDialog({ initialType = '', excludedProductIds, onSaved, onOther, onClose, onCatalogItemCreated }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { role } = useCurrentUser();
  const [type, setType] = useState(initialType), [busy, setBusy] = useState(false);
  const canRegisterAsset = ['admin', 'cashier'].includes(role);
  if (type === 'fixed_asset') return <AssetDialog onClose={onClose} onDone={asset => onSaved('fixed_asset', asset)} />;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className={type ? 'max-h-[92dvh] max-w-5xl overflow-y-auto' : 'max-w-2xl'} onPointerDownOutside={event => event.preventDefault()}>
    <DialogHeader><DialogTitle>{type ? ui("Create component item") : ui("What kind of component?")}</DialogTitle><DialogDescription>{type ? ui("The new item will be selected in your assembly after it is saved.") : ui("Choose a type. Your assembly details stay open while you add the component.")}</DialogDescription></DialogHeader>
    {!type ? <div className="grid gap-3 sm:grid-cols-2">{COMPONENT_TYPES.map(option => <button type="button" key={option.value} disabled={option.value === 'fixed_asset' && !canRegisterAsset} onClick={() => option.value === 'other' ? onOther() : setType(option.value)} className="rounded-xl border p-4 text-left transition hover:border-purple-300 hover:bg-purple-50 disabled:opacity-50"><span className="block text-sm font-semibold">{option.label}</span><span className="mt-2 block text-xs leading-5 text-slate-500">{option.value === 'fixed_asset' && !canRegisterAsset ? ui("Finance registers new assets. You can select existing assets in the component list.") : option.hint}</span></button>)}</div>
      : <><Button type="button" variant="ghost" className="justify-self-start" disabled={busy} onClick={() => setType('')}>{ui("Change component type")}</Button><Suspense fallback={<p role="status" className="p-6 text-sm text-slate-500">{ui("Loading item form...")}</p>}><ItemForm embedded initialType={type === 'inventory_part' ? 'inventory_item' : type} excludedProductIds={excludedProductIds} onBusyChange={setBusy} onCatalogItemCreated={onCatalogItemCreated} onCancel={onClose} onSaved={item => onSaved(item.inventory_type === 'service' ? 'service' : ['assembly', 'finished_product'].includes(item.inventory_type) ? 'assembly' : 'inventory_part', item)} /></Suspense></>}
  </DialogContent></Dialog>;
}
