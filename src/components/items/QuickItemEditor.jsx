
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Pencil, X } from 'lucide-react';
import { erp } from '@/api/erpClient';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { ProductPhoto } from '@/components/shared/ProductThumb';
import { itemUnits } from '@/lib/item-units';
import { buildQuickItemChanges, quickItemDraft } from '@/lib/item-quick-edit';
import { fetchItemStockSummary } from '@/lib/item-stock-summary';
import QuickItemPanel from './QuickItemPanel';
import UnitChangeDialog from './UnitChangeDialog';
import { stockUnit } from '@/lib/item-units';
import { attributeFacets } from '@/lib/item-attributes';
import { validateAssemblyYieldChanges } from '@/lib/assembly-yield';

export default function QuickItemEditor({ item, units = [], unitsLoading = false, onOpen, onSaved, onEditDetails, catalogueItems = [], className = '' }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const formId = useId();
  const toggleRef = useRef(null);
  const savingRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [baseItem,setBaseItem] = useState(item);
  const [draft, setDraft] = useState(() => quickItemDraft(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingSave,setPendingSave] = useState(null);
  const [stockVersion, setStockVersion] = useState(0);
  const [stock, setStock] = useState({ status: 'idle', data: null, error: '' });
  const attributeOptions = useMemo(() => editing ? attributeFacets(catalogueItems) : [], [editing,catalogueItems]);
  const choices = useMemo(() => itemUnits(units, [item]), [units, item]);
  const inventory = item.item_type !== 'service' && item.inventory_type !== 'service';
  let dirty = false;
  try { dirty = Object.keys(buildQuickItemChanges(editing ? baseItem : item, draft)).length > 0; }
  catch { dirty = true; }

  // Form typing never refreshes stock. Abort replies from closed/replaced dialogs.
  useEffect(() => {
    if (!editing || !inventory) return;
    const controller = new AbortController();
    let active = true;
    setStock({ status: 'loading', data: null, error: '' });
    fetchItemStockSummary(item.id, { signal: controller.signal }).then(data => {
      if (active && !controller.signal.aborted) setStock({ status: 'ready', data, error: '' });
    }).catch(failure => {
      if (active && !controller.signal.aborted) setStock({ status: 'error', data: null, error: failure.message || ui("Unable to load current stock.") });
    });
    return () => { active = false; controller.abort(); };
  }, [editing, inventory, item.id, stockVersion]);

  function changeOpen(next) {
    if (savingRef.current) return;
    if (next) {
      setBaseItem(item);
      setDraft(quickItemDraft(item));
      setError('');
      setPendingSave(null);
      setStock({ status: 'loading', data: null, error: '' });
      onOpen?.();
    }
    setEditing(next);
  }

  function change(field, value) {
    setDraft(current => ({ ...current, [field]: value, ...(['product_family','size'].includes(field)?validateAssemblyYieldChanges({[field]:value},{...baseItem,...current}):{}) }));
    setError('');
  }

  async function save(event) {
    event.preventDefault();
    event.stopPropagation();
    if (savingRef.current) return;
    let changes;
    try {
      changes = buildQuickItemChanges(baseItem, draft);
      if (!Object.keys(changes).length) { changeOpen(false); return; }
    } catch (failure) {
      setError(failure.message);
      return;
    }
    const input={id:baseItem.id,changes,...(baseItem.updated_date ? {updatedDate:baseItem.updated_date} : {})};
    if (changes.unit_of_measure && changes.unit_of_measure !== stockUnit(baseItem)) input.unitChange={confirmed:true,mode:'correct_label',fromUnit:stockUnit(baseItem),toUnit:changes.unit_of_measure,updatedDate:baseItem.updated_date,requestKey:crypto.randomUUID()};
    setPendingSave(input);
  }

  async function persist(input) {
    if (savingRef.current || !input) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    let saved;
    try {
      saved = await erp.items.quickEdit(input);
    } catch (failure) {
      setError(failure.message || sourceMessage("Unable to save this item. Your changes are still here."));
      return;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    setDraft(quickItemDraft(saved));
    setEditing(false);
    setPendingSave(null);
    onSaved?.(saved);
  }

  return <div className={className} onClick={event => event.stopPropagation()} onKeyDown={event => {
    // Let Escape reach Radix's document handler; keep form keys out of card navigation.
    if (event.key !== 'Escape') event.stopPropagation();
  }}>
    <Button ref={toggleRef} type="button" variant="outline" size="sm" onClick={() => changeOpen(true)}
      disabled={saving} aria-haspopup="dialog" aria-expanded={editing} aria-controls={editing ? `${formId}-dialog` : undefined}
      aria-label={ui("Quick edit {0}", item.name)} className="h-auto min-h-8 max-w-full gap-1.5 whitespace-normal text-xs">
      <Pencil size={13} />{ui("Quick edit")}</Button>
    <Dialog open={editing} onOpenChange={changeOpen}>
      <DialogPortal>
        <DialogOverlay className="bg-slate-950/50 backdrop-blur-[2px]" />
        <DialogPrimitive.Content id={`${formId}-dialog`}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw_-_2rem)] max-w-[1000px] max-h-[calc(100dvh_-_2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl focus:outline-none"
          onEscapeKeyDown={event => { if (savingRef.current) event.preventDefault(); }}
          onPointerDownOutside={event => { if (savingRef.current) event.preventDefault(); }}
          onCloseAutoFocus={event => { event.preventDefault(); toggleRef.current?.focus(); }}>
          <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 pr-14 sm:px-6">
            <ProductPhoto product={item} className="h-14 w-14 shrink-0 rounded-xl" imageClassName="p-1" />
            <div className="min-w-0 space-y-1">
              <DialogTitle className="break-words text-lg font-semibold leading-tight text-slate-900">{ui("Quick edit: ")}{item.name}</DialogTitle>
              <DialogDescription className="text-xs leading-5 text-slate-500">{item.sku || ui("No item code")}{ui(" · Update prices, attributes and units alongside current stock.")}</DialogDescription>
            </div>
          </div>
          <button type="button" onClick={() => changeOpen(false)} disabled={saving} aria-label={ui("Close quick edit")}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-wait disabled:opacity-40"><X size={18} /></button>
          <QuickItemPanel item={baseItem} draft={draft} choices={choices} unitsLoading={unitsLoading} saving={saving}
            error={uiMessage(error)} stock={stock} attributeOptions={attributeOptions} formId={formId} dirty={dirty} onChange={change}
            onRefresh={() => setStockVersion(value => value + 1)} onSubmit={save} onCancel={() => changeOpen(false)} />
          {onEditDetails && <div className="border-t px-5 py-3"><Button type="button" variant="outline" disabled={saving} onClick={()=>{changeOpen(false);onEditDetails(item);}}>{ui('Edit all item details')}</Button></div>}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
    <UnitChangeDialog open={!!pendingSave} itemName={item.name} fromUnit={stockUnit(baseItem)} toUnit={pendingSave?.changes.unit_of_measure || stockUnit(baseItem)} saving={saving} error={uiMessage(error)} onConfirm={()=>persist(pendingSave)} onCancel={()=>setPendingSave(null)} />
  </div>;
}
