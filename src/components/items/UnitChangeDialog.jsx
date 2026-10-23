import React from 'react';
import { ui } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export default function UnitChangeDialog({ open, itemName, fromUnit, toUnit, saving, error, onConfirm, onCancel }) {
  useLocaleRender();
  if (!open) return null;
  const changedUnit = fromUnit && toUnit && fromUnit!==toUnit;
  return <AlertDialog open={open} onOpenChange={value=>{if(!value && !saving)onCancel();}}>
    <AlertDialogContent overlayClassName="z-[90]" className="z-[100] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto" onEscapeKeyDown={event=>{if(saving)event.preventDefault();}}>
      <AlertDialogHeader>
        <AlertDialogTitle>{changedUnit ? ui('Change this item unit across the app?') : ui('Save changes to {0}?',itemName)}</AlertDialogTitle>
        <AlertDialogDescription>{changedUnit ? ui('You are changing {0} from {1} to {2}. This affects inventory, purchasing, sales and production for this item.',itemName,fromUnit,toUnit) : ui('These item details are shared across the app. Choose Proceed to save, or Cancel to keep editing.')}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="space-y-3 text-sm">
        {changedUnit ? <><p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-950">{ui('This corrects the unit label: 1 {0} becomes 1 {1}. Existing stock quantities and stock values keep their numbers. This does not convert physical measurements.',fromUnit,toUnit)}</p>
          <p>{ui('The prices entered will apply per {0}. Current recipes, supplier offers and open stock documents will be updated. Posted documents keep their recorded units.',toUnit)}</p></> : <p>{ui('Existing stock quantities, stock values and posted transactions are preserved. Changes to prices and general details apply to the item throughout the app.')}</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={saving} onClick={event=>{event.preventDefault();if(!saving)return onCancel();}}>{ui('Cancel')}</AlertDialogCancel>
        <AlertDialogAction disabled={!!saving} onClick={event=>{event.preventDefault();if(!saving)return onConfirm();}}>{saving ? ui('Saving...') : ui('Proceed')}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
