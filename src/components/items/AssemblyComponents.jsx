import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import HelpNotice from '@/components/shared/HelpNotice';
import { formatNumber } from '@/lib/formatters';
import { Plus, Trash2, Boxes, RefreshCw } from 'lucide-react';
import { COMPONENT_TYPES, blankComponent, componentType, productComponentType, componentFromRecord, componentLineCost, assemblyCost, changeComponentUnit } from '@/lib/assembly-components';
import NewAssemblyComponentDialog from './NewAssemblyComponentDialog';
import AssemblyComponentPicker from './AssemblyComponentPicker';
import { stockUnit, compatibleUnits, DEFAULT_ITEM_UNITS, componentCostInUnit } from '@/lib/item-units';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { itemAttributes } from '@/lib/item-attributes';
const formatXAF = value => Number.isFinite(value) ? formatNumber(value, Number.isInteger(value) ? 0 : 6) + ' XAF' : '\u2014';

export default function AssemblyComponents({components,setComponents,products,assets=[],units=DEFAULT_ITEM_UNITS,excludedProductIds=[],onCatalogChange,onRefreshCatalogue,refreshing=false,disabled=false}) {
  useLocaleRender();
  const {role}=useCurrentUser();
  const [creating,setCreating]=useState(null),[picking,setPicking]=useState(null),[componentError,setComponentError]=useState('');
  const pickerTrigger=useRef(null);
  const addRow=type=>setComponents(rows=>[...rows,blankComponent(type)]);
  const patch=(index,changes)=>setComponents(rows=>rows.map((row,i)=>{
    if(i!==index)return row;
    const next={...row,...changes},cost=componentLineCost(next);
    return {...next,line_cost:Number.isFinite(cost)?cost:0};
  }));
  const created=(type,record)=>{
    onCatalogChange?.(type,record);
    setComponents(rows=>creating?.index==null?[...rows,componentFromRecord(type,record)]:rows.map((row,index)=>index===creating.index?componentFromRecord(type,record,row):row));
    setCreating(null);
  };
  const other=()=>{
    if(creating?.index==null)addRow('other');
    else setComponents(rows=>rows.map((row,index)=>index===creating.index?blankComponent('other'):row));
    setCreating(null);
  };
  const choose=(event,index,type)=>{
    pickerTrigger.current=event?.currentTarget||null;
    setPicking(current=>current?.index===index?null:{index,type});
    onRefreshCatalogue?.();
  };
  const total=assemblyCost(components);
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1"><h3 className="text-sm font-semibold text-slate-900">{ui('Components of this assembly')} <span className="text-slate-400">({components.length})</span></h3><HelpNotice title={ui('Assembly components')}><p>{ui("Add the components needed for one finished-product U/M. Costs start from each item's registered cost. You can adjust a unit cost for this assembly; compatible U/M changes convert the cost automatically.")}</p><p>{ui('Registered component details refresh automatically. Quantities and custom costs stay as entered.')}</p></HelpNotice></div>
      <div className="flex flex-wrap items-center gap-2">
        {onRefreshCatalogue&&<Button type="button" variant="ghost" size="icon" disabled={disabled||refreshing} aria-label={ui('Refresh component details')} title={ui('Refresh component details')} onClick={onRefreshCatalogue}><RefreshCw size={16} className={refreshing?'animate-spin':''}/></Button>}
        <Button type="button" size="sm" disabled={disabled} onClick={()=>addRow('inventory_part')}><Plus size={14} className="mr-1"/>{ui('Add component')}</Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={()=>setCreating({})} ><span className="sm:hidden">{ui('Create')}</span><span className="hidden sm:inline">{ui('Create new component')}</span></Button>
      </div>
    </div>
    {componentError&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{uiMessage(componentError)}</p>}
    {!components.length&&<div className="rounded-lg border border-dashed bg-slate-50 p-4 text-center text-sm text-slate-500"><Boxes size={21} className="mx-auto mb-2 text-slate-400"/>{ui('Add inventory parts, finished assemblies, services, fixed assets or other costs.')}</div>}
    <div className="space-y-2">{components.map((row,index)=>{
      const type=componentType(row,products),definition=COMPONENT_TYPES.find(option=>option.value===type)||COMPONENT_TYPES[0];
      const records=type==='fixed_asset'?assets:products.filter(product=>productComponentType(product)===type&&!excludedProductIds.includes(product.id));
      const selectedId=type==='fixed_asset'?row.asset_id:row.product_id,selected=records.find(record=>record.id===selectedId);
      const measuredItem=selected&&type!=='fixed_asset',baseUnit=measuredItem?stockUnit(selected):row.unit;
      let registeredCost=null;
      if(measuredItem){try{registeredCost=componentCostInUnit(selected,row.unit);}catch{/* Invalid legacy U/M remains visible for correction. */}}
      const unitOptions=measuredItem?compatibleUnits([...new Map([...units,{code:baseUnit,name:baseUnit}].map(unit=>[unit.code,unit])).values()],baseUnit):[];
      return <fieldset key={index} disabled={disabled} className="relative min-w-0 rounded-lg border border-slate-200 bg-white p-3">
        <legend className="sr-only">{ui('Component {0}',index+1)}</legend>
        <div className="grid min-w-0 grid-cols-2 items-start gap-2 sm:grid-cols-4 lg:grid-cols-[minmax(0,1fr)_5.5rem_5rem_8rem_7rem_2.75rem]">
          <div className="col-span-2 min-w-0 pr-12 sm:col-span-4 lg:col-span-1 lg:pr-0">
            <p className="mb-1 text-[11px] font-medium text-slate-500">{index+1}. {definition.label}</p>
            {type==='other'?<Input aria-label={ui('Component description {0}',index+1)} value={row.product_name} maxLength={200} onChange={event=>patch(index,{product_name:event.target.value})} placeholder={ui('e.g. Cold storage overhead')}/>:
              <Button type="button" variant="outline" aria-label={'Choose component item '+(index+1)} aria-haspopup="dialog" aria-expanded={picking?.index===index} className="h-auto min-h-11 w-full min-w-0 justify-between gap-2 whitespace-normal px-2 py-2 text-left text-sm sm:min-h-9" onClick={event=>choose(event,index,type)}><span className="min-w-0 break-words">{selected?.name||row.product_name||ui('Select a component')}</span><span aria-hidden="true" className="shrink-0">&gt;</span></Button>}
          </div>
          <label className="min-w-0 space-y-1 text-[11px] font-medium text-slate-500">{ui('Quantity *')}<Input aria-label={'Component quantity '+(index+1)} type="number" min="0.000001" max="1000000000" step="any" value={row.quantity} onChange={event=>patch(index,{quantity:event.target.value})}/></label>
          <label className="min-w-0 space-y-1 text-[11px] font-medium text-slate-500">{ui('U/M *')}{measuredItem?<select aria-label={'Component unit '+(index+1)} value={row.unit} onChange={event=>patch(index,changeComponentUnit(row,event.target.value,selected))} className="h-11 w-full min-w-0 rounded-md border bg-white px-2 text-base sm:h-9 sm:text-sm">{!unitOptions.some(unit=>unit.code===row.unit)&&<option value={row.unit}>{row.unit}{ui(' - choose compatible unit')}</option>}{unitOptions.map(unit=><option key={unit.code} value={unit.code}>{unit.code}</option>)}</select>:<Input aria-label={'Component unit '+(index+1)} value={row.unit} maxLength={50} onChange={event=>patch(index,{unit:event.target.value})}/>}</label>
          <label className="hidden min-w-0 space-y-1 text-[11px] font-medium text-slate-500 sm:block">{ui(type==='fixed_asset'?'Usage cost / unit':'Unit cost')} (XAF)<Input aria-label={'Component unit cost '+(index+1)} type="number" min="0" max="1000000000000" step="any" value={row.unit_cost} onChange={event=>patch(index,{unit_cost:event.target.value,cost_source:'manual'})}/></label>
          <div className="col-span-2 flex min-w-0 items-center justify-between gap-2 text-[11px] font-medium text-slate-500 sm:col-span-1 sm:block sm:space-y-1"><p>{ui('Component cost')}</p><output aria-label={ui('Component total {0}',index+1)} className="flex min-h-8 min-w-0 items-center break-all text-sm font-semibold tabular-nums text-slate-900 sm:min-h-9">{formatXAF(componentLineCost(row))}</output></div>
          <Button type="button" size="icon" variant="ghost" aria-label={'Remove component '+(index+1)} className="absolute right-2 top-3 h-11 w-11 text-red-600 lg:static lg:mt-5 lg:h-9" onClick={()=>{setComponents(rows=>rows.filter((_,i)=>i!==index));setPicking(null);}}><Trash2 size={15}/></Button>
        </div>
        <details className="mt-1 text-[11px] leading-5 text-slate-500">
          <summary className="w-fit cursor-pointer py-1 font-medium">{ui('Component details')}{row.cost_source==='manual'&&measuredItem&&<span className="ml-2 text-slate-700">{ui('Custom cost for this assembly')}</span>}</summary>
          <div className="mt-2 grid gap-3 border-t pt-2 sm:grid-cols-2">
            <label className="min-w-0 space-y-1 font-medium sm:hidden">{ui(type==='fixed_asset'?'Usage cost / unit':'Unit cost')} (XAF)<Input aria-label={'Edit component unit cost '+(index+1)} type="number" min="0" max="1000000000000" step="any" value={row.unit_cost} onChange={event=>patch(index,{unit_cost:event.target.value,cost_source:'manual'})}/></label>
            <label className="min-w-0 space-y-1 font-medium">{ui('Component type')}<select aria-label={'Component type '+(index+1)} value={type} onChange={event=>{setComponents(rows=>rows.map((value,i)=>i===index?blankComponent(event.target.value):value));setPicking(null);}} className="h-10 w-full rounded-md border bg-white px-2 text-sm">{COMPONENT_TYPES.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <div className="space-y-1">
              {measuredItem&&<><p>{ui(row.cost_source==='manual'?'Custom cost for this assembly':'Using registered item cost')}</p>{registeredCost!=null&&Number.isFinite(registeredCost)&&<><p>{ui('Item cost: ')}{formatXAF(registeredCost)} / {row.unit}</p>{row.cost_source==='manual'&&<button type="button" className="min-h-9 font-semibold text-primary underline" onClick={()=>patch(index,{cost_source:'registered',unit_cost:registeredCost})}>{ui('Reset to item cost')}</button>}</>}</>}
              {type!=='other'&&<button type="button" disabled={disabled||type==='fixed_asset'&&!['admin','cashier'].includes(role)} onClick={()=>setCreating({index,type})} className="min-h-9 font-semibold text-primary underline disabled:text-slate-400">{ui('Create new ')}{definition.label.toLowerCase()}</button>}
            </div>
            {type==='fixed_asset'&&<p className="sm:col-span-2">{ui('Equipment stays in the asset register. Enter only the usage cost allocated to this assembly, if applicable. Its purchase value and depreciation are managed separately.')}</p>}
            {selected&&itemAttributes(selected).length>0&&<dl className="flex flex-wrap gap-2 sm:col-span-2">{itemAttributes(selected).map(attr=><div key={attr.name}><dt className="inline font-medium">{attr.name}: </dt><dd className="inline">{attr.value}</dd></div>)}</dl>}
          </div>
        </details>
        {selected?.is_active===false&&<p className="mt-1 text-xs text-slate-700">{ui('This existing component is inactive. You can retain the link or choose an active replacement.')}</p>}
      </fieldset>;
    })}</div>
    <div className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-600">{ui('Component cost per finished-product U/M: ')}</span><strong className="tabular-nums">{formatXAF(total)}</strong></div>
    {picking&&components[picking.index]&&<AssemblyComponentPicker key={picking.index+'-'+picking.type} returnFocusRef={pickerTrigger} type={picking.type} records={picking.type==='fixed_asset'?assets:products.filter(p=>productComponentType(p)===picking.type&&!excludedProductIds.includes(p.id))} value={picking.type==='fixed_asset'?components[picking.index].asset_id:components[picking.index].product_id} onClose={()=>setPicking(null)} onSelect={record=>{try{patch(picking.index,componentFromRecord(picking.type,record,components[picking.index]));setComponentError('');}catch(error){setComponentError(error.message);}setPicking(null);}}/>}
    {creating&&<NewAssemblyComponentDialog key={creating.index??'new'} initialType={creating.type||''} excludedProductIds={excludedProductIds} onSaved={created} onOther={other} onCatalogItemCreated={onCatalogChange} onClose={()=>setCreating(null)}/>}
  </div>;
}
