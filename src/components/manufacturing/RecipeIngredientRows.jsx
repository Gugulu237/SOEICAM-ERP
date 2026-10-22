import React,{useRef,useState} from 'react';
import { stockUnit,compatibleUnits,itemUnits,unitFactor } from '@/lib/item-units';
import { ui } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import AssemblyComponentPicker from '@/components/items/AssemblyComponentPicker';
import { NativeSelect,NumberField } from './YogurtRecipeFields';

const counted=unit=>['ea','each','unit','units','bottle','bottles','bouteille','bouteilles'].includes(String(unit).toLowerCase());
export default function RecipeIngredientRows({rows,items,onChange,disabled=false,per,roles=false,fixed=false,protectedRoles=[],protectedPresets=[],excludedMaterialIds=[],bucketCount}){
  const [picking,setPicking]=useState(null),anchorRef=useRef(null);
  const update=(index,changes)=>onChange(current=>current.map((row,i)=>i===index?{...row,...changes}:row));
  function open(event,index){anchorRef.current=event.currentTarget;setPicking({index});}
  function select(item){
    if(disabled||!picking)return;
    const index=picking.index;
    onChange(current=>{
      if(index==null){if(current.some(row=>row.material_id===item.id))return current;return [...current,{...(roles?{role:'other'}:{recipe_role:'additive'}),material_id:item.id,quantity:'',unit:stockUnit(item)}];}
      return current.map((row,i)=>{if(i!==index||row.material_id===item.id)return row;const unit=stockUnit(item),measured=row.measure_count>0,per=row.measure_unit==='bottle'&&counted(unit)?1:'';return {...row,material_id:item.id,unit:row.recipe_role==='martinal'?'':unit,quantity:row.recipe_role==='martinal'?20:measured?per===''?'':Number(row.measure_count)*Number(per):row.recipe_role==='flavour'&&counted(unit)?2:'',...(measured?{quantity_per_measure:per}:{})};});
    });
    setPicking(null);
  }
  const selectedId=picking?.index!=null?rows[picking.index]?.material_id:'';
  const candidates=items.filter(item=>!excludedMaterialIds.includes(item.id)&&!rows.some(row=>row.material_id===item.id&&row.material_id!==selectedId));
  return <div className="space-y-3">{rows.map((row,index)=>{
    const item=items.find(p=>p.id===row.material_id),base=row.role==='milk'?'kg':item?stockUnit(item):row.unit || 'g';
    const units=compatibleUnits(itemUnits([],items),base),locked=fixed&&(roles&&row.role!=='other'||row.recipe_role==='sugar');
    const measure=row.measure_count>0;
    const title=ui({milk:'Milk',culture:'Culture',sugar:'Sugar',martinal:'Martinal (20 per bucket)'}[row.role || row.recipe_role] || (row.recipe_role==='flavour'?'Flavour (2 bottles per bucket)':row.material_label || {sorbate:'Sorbate',benzoate:'Benzoate',citric_acid:'Citric acid'}[row.preset_key] || 'Ingredient'));
    return <div key={index} className="space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><span className="mb-1 block text-sm font-medium">{title}</span>
        {locked?<p className="break-words text-sm">{item?.name || ui('Inventory needs one uniquely named shared material.')}</p>:<Button type="button" variant="outline" disabled={disabled} aria-label={ui('Choose ingredient {0}',item?.name || row.material_label || index+1)} aria-haspopup="dialog" aria-expanded={picking?.index===index} onClick={event=>open(event,index)} className="h-auto min-h-10 w-full justify-between whitespace-normal text-left"><span>{item?.name || ui('Select ingredient')}</span><span aria-hidden="true">›</span></Button>}
      </div>{(!roles||row.role==='other')&&!protectedRoles.includes(row.recipe_role)&&!protectedPresets.includes(row.preset_key)&&<Button type="button" variant="ghost" disabled={disabled} aria-label={ui('Remove ingredient {0}',item?.name || row.material_label || index+1)} onClick={()=>{onChange(current=>current.filter((_,i)=>i!==index));setPicking(null);}}>{ui('Remove')}</Button>}</div>
      {measure&&<div className="space-y-2"><p className="text-sm font-medium">{ui('{0} {1} per bucket',row.measure_count,row.measure_unit==='teaspoon'?'teaspoons':'bottles')}</p><NumberField label={ui('Inventory quantity per {0} ({1})',row.measure_unit,row.unit || base)} value={row.quantity_per_measure ?? ''} disabled={disabled||(row.measure_unit==='bottle'?counted(row.unit):['tsp','teaspoon','teaspoons'].includes(String(row.unit).toLowerCase()))} onChange={quantity_per_measure=>update(index,{quantity_per_measure,quantity:String(quantity_per_measure).trim()===''?'':Number(quantity_per_measure)*Number(row.measure_count)})}/></div>}
      <div className="grid grid-cols-2 gap-2"><NumberField label={per} value={row.quantity} onChange={quantity=>update(index,{quantity})} disabled={disabled||measure||row.role==='milk'||fixed&&(row.recipe_role==='sugar'||row.recipe_role==='martinal'||row.recipe_role==='flavour'&&counted(row.unit))}/>
        <NativeSelect label={ui('Unit')} value={row.unit} disabled={disabled||measure||row.role==='milk'||fixed&&row.recipe_role==='sugar'} onChange={unit=>{let quantity=row.quantity,quantity_per_measure=row.quantity_per_measure;if(row.recipe_role==='martinal')quantity=20;else if(String(quantity).trim()!==''&&Number.isFinite(Number(quantity))){try{const factor=unitFactor(row.unit,unit);quantity=Math.round(Number(quantity)*factor*1e9)/1e9;if(measure)quantity_per_measure=Math.round(Number(quantity_per_measure)*factor*1e9)/1e9;}catch{quantity='';if(measure)quantity_per_measure='';}}update(index,{unit,quantity,...(measure?{quantity_per_measure}:{})});}}>
          {!units.some(u=>u.code===row.unit)&&row.unit&&<option value={row.unit} disabled>{row.unit} — {ui('Choose a compatible unit')}</option>}{units.map(u=><option key={u.code} value={u.code}>{u.code}</option>)}
        </NativeSelect>
      </div>{row.recipe_role==='martinal'&&!row.unit&&<p className="text-xs text-amber-800">{ui('Confirm the unit for 20 Martinal per bucket.')}</p>}{bucketCount!=null&&<p className="text-xs text-slate-600">{ui('Total for {0} buckets',bucketCount)}: <strong>{Number(row.quantity)*Number(bucketCount) || 0} {row.unit}</strong></p>}
    </div>;
  })}
    {!disabled&&<Button type="button" variant="outline" size="sm" onClick={event=>open(event,null)}>{ui(roles?'Add base material':'Add ingredient')}</Button>}
    {picking&&!disabled&&<AssemblyComponentPicker key={picking.index ?? 'new'} records={candidates} type="inventory_part" value={selectedId} label="Choose recipe ingredient" searchLabel="Search recipe ingredients" returnFocusRef={anchorRef} onClose={()=>setPicking(null)} onSelect={select}/>}
  </div>;
}
