import React,{lazy,Suspense,useState} from 'react';
import {ClipboardCheck} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {canAdjustInventory} from '@/lib/inventory-adjustment-access';
import {Button} from '@/components/ui/button';
import ItemRemoval from './ItemRemoval';
const StockAdjustmentDialog=lazy(()=>import('@/components/inventory/StockAdjustmentDialog'));
export default function ItemMaintenance({item,disabled=false,onDone,onStockAdjusted,onBusyChange}){
  const {role,employee,allowedModules}=useCurrentUser(),[adjust,setAdjust]=useState(false);
  const canManage=['admin','warehouse_manager','procurement','production_manager'].includes(role)&&(!allowedModules||allowedModules.includes('inventory'));
  if(!item)return null;
  const removed=Boolean(item.item_removed_at);
  const canAdjust=canAdjustInventory(role,employee,allowedModules)&&!removed&&item.inventory_type!=='service'&&item.is_active!==false&&item.configuration_status!=='draft';
  if(!canManage&&!canAdjust)return null;
  return <section className="mt-4 space-y-2 border-t pt-4">
    {removed&&<p className="rounded-lg border bg-slate-50 p-3 text-sm">{ui('This item is deleted from the catalogue. Restore it before editing.')}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      {canAdjust&&<Button type="button" className="min-h-11" variant="outline" disabled={disabled} onClick={()=>setAdjust(true)}><ClipboardCheck size={16} className="mr-2"/>{ui('Adjust quantity')}</Button>}
      {canManage&&<ItemRemoval item={item} disabled={disabled} onDone={onDone} onBusyChange={onBusyChange}/>}
    </div>
    {adjust&&canAdjust&&<Suspense fallback={<p role="status" className="text-sm">{ui('Loading warehouse quantities...')}</p>}><StockAdjustmentDialog open productId={item.id} onOpenChange={setAdjust} onBusyChange={onBusyChange} onSaved={onStockAdjusted}/></Suspense>}
  </section>;
}
