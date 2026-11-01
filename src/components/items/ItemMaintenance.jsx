import React from 'react';
import {ui} from '@/lib/i18n';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import ItemRemoval from './ItemRemoval';
// Catalogue maintenance never changes counts; adjustments belong in Accounting.
export default function ItemMaintenance({item,disabled=false,onDone,onBusyChange}){
  const {role,allowedModules}=useCurrentUser();
  const canManage=['admin','warehouse_manager','procurement','production_manager'].includes(role)&&(!allowedModules||allowedModules.includes('inventory'));
  if(!item)return null;
  const removed=Boolean(item.item_removed_at);
  if(!canManage)return null;
  return <section className="mt-4 space-y-2 border-t pt-4">
    {removed&&<p className="rounded-lg border bg-slate-50 p-3 text-sm">{ui('This item is deleted from the catalogue. Restore it before editing.')}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      {canManage&&<ItemRemoval item={item} disabled={disabled} onDone={onDone} onBusyChange={onBusyChange}/>}
    </div>
  </section>;
}
