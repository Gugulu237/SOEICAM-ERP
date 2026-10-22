
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState,useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ProductThumb from '@/components/shared/ProductThumb';
import { formatNumber } from '@/lib/formatters';
import { Plus, Trash2, Boxes, Landmark } from 'lucide-react';
import { COMPONENT_TYPES, blankComponent, componentType, productComponentType, componentFromRecord, componentLineCost, assemblyCost, changeComponentUnit } from '@/lib/assembly-components';
import NewAssemblyComponentDialog from './NewAssemblyComponentDialog';
import AssemblyComponentPicker from './AssemblyComponentPicker';
import { stockUnit, compatibleUnits, DEFAULT_ITEM_UNITS, componentCostInUnit } from '@/lib/item-units';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { itemAttributes } from '@/lib/item-attributes';
const formatXAF = value => formatNumber(value, Number.isInteger(value) ? 0 : 6) + ' XAF';

export default function AssemblyComponents({ components, setComponents, products, assets = [], units = DEFAULT_ITEM_UNITS, excludedProductIds = [], onCatalogChange, disabled = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { role } = useCurrentUser();
  const [creating, setCreating] = useState(null), [picking,setPicking] = useState(null);
  const pickerTrigger=useRef(null);
  const addRow = type => setComponents(rows => [...rows, blankComponent(type)]);
  const patch = (index, changes) => setComponents(rows => rows.map((row, i) => {
    if (i !== index) return row;
    const next = { ...row, ...changes }, cost = componentLineCost(next);
    return { ...next, line_cost: Number.isFinite(cost) ? cost : 0 };
  }));
  const created = (type, record) => {
    onCatalogChange?.(type, record);
    setComponents(rows => creating?.index == null ? [...rows, componentFromRecord(type, record)]
      : rows.map((row, index) => index === creating.index ? componentFromRecord(type, record, row) : row));
    setCreating(null);
  };
  const other = () => {
    if (creating?.index == null) addRow('other');
    else setComponents(rows => rows.map((row, index) => index === creating.index ? blankComponent('other') : row));
    setCreating(null);
  };
  const total = assemblyCost(components);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">{ui("Components of this assembly")}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{ui("Choose a component from grouped materials or create one here.")}</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => addRow('inventory_part')}><Plus size={14} className="mr-1" />{ui("Add component")}</Button><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setCreating({})}>{ui("Create new component")}</Button></div></div>
    {!components.length && <div className="rounded-xl border border-dashed bg-slate-50 p-6 text-center"><Boxes size={25} className="mx-auto text-purple-500" /><p className="mt-3 text-sm text-slate-600">{ui("Add inventory parts, finished assemblies, services, fixed assets or other costs.")}</p></div>}
    <div className="space-y-3">{components.map((row, index) => {
      const type = componentType(row, products), definition = COMPONENT_TYPES.find(option => option.value === type) || COMPONENT_TYPES[0];
      const records = type === 'fixed_asset' ? assets : products.filter(product => productComponentType(product) === type && !excludedProductIds.includes(product.id));
      const selectedId = type === 'fixed_asset' ? row.asset_id : row.product_id;
      const selected = records.find(record => record.id === selectedId);
      const measuredItem = selected && type !== 'fixed_asset';
      let registeredCost = null;
      if (measuredItem) { try { registeredCost = componentCostInUnit(selected, row.unit); } catch { /* Keep incompatible legacy units editable. */ } }
      const baseUnit = measuredItem ? stockUnit(selected) : row.unit;
      const unitOptions = measuredItem ? compatibleUnits([...new Map([...units, { code: baseUnit, name: baseUnit }].map(unit => [unit.code, unit])).values()], baseUnit) : [];
      return <fieldset key={index} disabled={disabled} className="space-y-4 rounded-xl border bg-white p-4">
        <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2">{type === 'fixed_asset' ? <Landmark size={20} className="text-purple-600" /> : selected ? <ProductThumb product={selected} size={32} /> : <Boxes size={20} className="text-purple-500" />}<div><p className="text-xs font-semibold text-slate-500">{ui("Component ")}{index + 1}</p><p className="mt-1 text-sm font-medium">{selected?.name || row.product_name || ui("Select a component")}</p></div></div><Button type="button" size="icon" variant="ghost" aria-label={'Remove component ' + (index + 1)} className="shrink-0 text-red-500" onClick={() => { setComponents(rows => rows.filter((_, i) => i !== index)); setPicking(null); }}><Trash2 size={16} /></Button></div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"><label className="space-y-1 text-xs font-medium">{ui("Component type")}<select aria-label={'Component type ' + (index + 1)} value={type} onChange={event => { setComponents(rows => rows.map((value, i) => i === index ? blankComponent(event.target.value) : value)); setPicking(null); }} className="h-10 w-full rounded-md border bg-white px-2">{COMPONENT_TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          {type === 'other' ? <label className="space-y-1 text-xs font-medium">{ui("Component description *")}<Input value={row.product_name} maxLength={200} onChange={event => patch(index, { product_name: event.target.value })} placeholder={ui("e.g. Cold storage overhead")} /></label>
            : <div className="space-y-2"><Button type="button" variant="outline" aria-label={'Choose component item ' + (index + 1)} aria-haspopup="dialog" aria-expanded={picking?.index===index} className="h-auto min-h-10 w-full justify-between whitespace-normal text-left" onClick={event=>{pickerTrigger.current=event?.currentTarget || null;setPicking(current=>current?.index===index?null:{index,type});}}><span>{selected?.name || row.product_name || ui('Select a component')}</span><span aria-hidden="true">›</span></Button><div className="flex justify-end"><button type="button" disabled={disabled || type === 'fixed_asset' && !['admin', 'cashier'].includes(role)} onClick={() => setCreating({ index, type })} className="min-h-8 text-xs font-semibold text-purple-700 underline disabled:text-slate-400">{ui("Create new ")}{definition.label.toLowerCase()}</button></div></div>}

        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="space-y-1 text-xs font-medium">{ui("Quantity *")}<Input type="number" min="0.000001" max="1000000000" step="any" value={row.quantity} onChange={event => patch(index, { quantity: event.target.value })} /></label>
          <label className="space-y-1 text-xs font-medium">{ui("U/M *")}{measuredItem ? <select aria-label={'Component unit ' + (index + 1)} value={row.unit} onChange={event => patch(index, changeComponentUnit(row, event.target.value, selected))} className="h-10 w-full rounded-md border bg-white px-2">{!unitOptions.some(unit => unit.code === row.unit) && <option value={row.unit}>{row.unit}{ui(" - choose compatible unit")}</option>}{unitOptions.map(unit => <option key={unit.code} value={unit.code}>{unit.code}</option>)}</select> : <Input value={row.unit} maxLength={50} onChange={event => patch(index, { unit: event.target.value })} />}</label>
          <div className="space-y-1 text-xs font-medium"><label className="block space-y-1">{type === 'fixed_asset' ? ui("Usage cost / unit") : ui("Unit cost")}{ui(" (FCFA)")}<Input aria-label={'Component unit cost ' + (index + 1)} type="number" min="0" max="1000000000000" step="any" value={row.unit_cost} onChange={event => patch(index, { unit_cost: event.target.value, cost_source: 'manual' })} /></label>
            {measuredItem && <div className="space-y-1 text-[11px] leading-4"><p className={row.cost_source === 'manual' ? 'text-purple-700' : 'text-slate-500'}>{row.cost_source === 'manual' ? ui("Custom cost for this assembly") : ui("Using registered item cost")}</p>{registeredCost != null && Number.isFinite(registeredCost) && <><p className="text-slate-500">{ui("Item cost: ")}{formatXAF(registeredCost)} / {row.unit}</p>{row.cost_source === 'manual' && <button type="button" className="min-h-8 text-left font-semibold text-purple-700 underline" onClick={() => patch(index, { cost_source: 'registered', unit_cost: registeredCost })}>{ui("Reset to item cost")}</button>}</>}</div>}
          </div>
          <div className="space-y-2 text-xs font-medium"><p>{ui("Component cost")}</p><p className="pt-2 text-sm font-semibold text-slate-900">{formatXAF(Number.isFinite(componentLineCost(row)) ? componentLineCost(row) : 0)}</p></div>
        </div>
        {type === 'fixed_asset' && <p className="rounded-lg bg-purple-50 p-3 text-xs leading-5 text-purple-800">{ui("Equipment stays in the asset register. Enter only the usage cost allocated to this assembly, if applicable. Its purchase value and depreciation are managed separately.")}</p>}
        {selected && itemAttributes(selected).length>0 && <dl className="flex flex-wrap gap-2 text-[11px] text-slate-600">{itemAttributes(selected).map(attr=><div key={attr.name} className="rounded-md bg-slate-50 px-2 py-1"><dt className="inline font-medium">{attr.name}: </dt><dd className="inline">{attr.value}</dd></div>)}</dl>}
        {selected?.is_active === false && <p className="text-xs text-amber-800">{ui("This existing component is inactive. You can retain the link or choose an active replacement.")}</p>}
      </fieldset>;
    })}</div>
    <div className="rounded-xl bg-slate-50 p-4 text-right text-sm">{ui("Component cost per finished-product U/M: ")}<span className="font-bold">{formatXAF(Number.isFinite(total) ? total : 0)}</span></div>
    {picking&&components[picking.index]&&<AssemblyComponentPicker key={picking.index+'-'+picking.type} returnFocusRef={pickerTrigger} type={picking.type} records={picking.type==='fixed_asset'?assets:products.filter(p=>productComponentType(p)===picking.type&&!excludedProductIds.includes(p.id))} value={picking.type==='fixed_asset'?components[picking.index].asset_id:components[picking.index].product_id} onClose={()=>setPicking(null)} onSelect={record=>{patch(picking.index,componentFromRecord(picking.type,record,components[picking.index]));setPicking(null);}}/>}
    {creating && <NewAssemblyComponentDialog key={creating.index ?? 'new'} initialType={creating.type || ''} excludedProductIds={excludedProductIds} onSaved={created} onOther={other} onCatalogItemCreated={onCatalogChange} onClose={() => setCreating(null)} />}
  </div>;
}
