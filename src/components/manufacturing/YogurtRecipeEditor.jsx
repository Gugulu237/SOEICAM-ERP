import RecipeDeleteButton from './RecipeDeleteButton';
import React,{useEffect,useRef,useState} from 'react';
import { invokeFieldOps } from '@/lib/field-ops';
import { useNavigate } from '@/lib/router';
import { emptyYogurtConfig,YOGURT_BASES,yogurtBase,standardBucketUnits,sharedYogurtMaterial,yogurtProductIdentity,recipeBucketPlan,yogurtRequirements,standardBucketWeight } from '@/lib/yogurt-production';
import { productRecipeDraft,presetBlend,commitProductDraft } from '@/lib/yogurt-recipe-presets';
import RecipeProductCatalogue from './RecipeProductCatalogue';
import PhasedYogurtRecipeEditor from './PhasedYogurtRecipeEditor';
import LegacyYogurtRecipeEditor from './LegacyYogurtRecipeEditor';
import { ProductPhoto } from '@/components/shared/ProductThumb';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { PRODUCT_FLAVOURS,PRODUCT_SIZES } from '@/lib/product-variants';
import { stockUnit } from '@/lib/item-units';
import { NativeSelect,NumberField } from './YogurtRecipeFields';
import FormulaRows from './RecipeIngredientRows';
import { ui,uiMessage } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export { NativeSelect,NumberField } from './YogurtRecipeFields';
export { default as FormulaRows } from './RecipeIngredientRows';
const ItemForm=React.lazy(()=>import('@/views/ItemForm'));
export function VisualYogurtRecipeEditor({initialRecipe=null}) {
  useLocaleRender();
  const navigate=useNavigate(),{role}=useCurrentUser(),canEdit=['admin','production_manager'].includes(role);
  const [recipe,setRecipe]=useState(initialRecipe),[config,setConfig]=useState(initialRecipe?.yogurt_config || emptyYogurtConfig());
  const [name,setName]=useState(initialRecipe?.recipe_name || ''),[notes,setNotes]=useState(initialRecipe?.notes || '');
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
  const [editing,setEditing]=useState(null),[setupError,setSetupError]=useState(''),[managingItem,setManagingItem]=useState(null);
  const productTrigger=useRef(null);
  const managedItemBusy=useRef(false);
  useEffect(()=>{let active=true;invokeFieldOps({action:'yogurtRecipeCatalogue'}).then(({data})=>{
    if(!active)return;
    setItems(data.products);
    setConfig(c=>c.formula_version===2&&!initialRecipe?{...c,fermentation:c.fermentation.map(line=>{
      const item=sharedYogurtMaterial(data.products,line.role);return item?{...line,material_id:item.id,...(line.role==='culture'&&String(line.quantity).trim()===''?{unit:stockUnit(item)}:{})}:line;
    })}:c);
  }).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  const raw=items.filter(p=>p.is_active!==false&&p.configuration_status!=='draft'&&['raw_material','inventory_part','consumable','additive','inventory_item'].includes(p.inventory_type));
  const change=c=>{setConfig(c);setDirty(true);setError('');};
  function regroup(c){
    const flavors=[...new Set(c.outputs.map(o=>o.flavor))];
    return {...c,expected_kg_per_bucket:c.product_bucket_recipe?Math.max(standardBucketWeight(c.family),...c.outputs.map(o=>Number(o.standard_units_per_bucket || standardBucketUnits(c.family,o.size))*Number(o.kg_per_unit || 0))):c.expected_kg_per_bucket,blends:flavors.map(flavor=>c.blends.find(b=>b.flavor===flavor))};
  }
  function changeBase(family){
    if(!family||family===config.family)return;
    if(config.outputs.length){setError('Remove or replace products before changing the yogurt base. Your recipe has been kept.');return;}
    change({...config,family,expected_kg_per_bucket:standardBucketWeight(family),fermentation:config.fermentation.map(line=>line.role==='milk'?{...line,quantity:yogurtBase(family).milk}:line)});
  }
  function openProduct(item){
    productTrigger.current=typeof document==='undefined'?null:document.activeElement;
    setSetupError('');setEditing(productRecipeDraft(item,config,items));
  }
  function setOutput(fields){setEditing({...editing,output:{...editing.output,...fields}});setSetupError('');}
  function classifyOutput(fields){
    const old=editing.output,override={family:config.family,flavor:old.flavor,size:old.size,...old.variant_override,...fields};
    let output={...old,...fields,variant_override:override};
    try {output={...output,...yogurtProductIdentity(items.find(p=>p.id===old.product_id),config.family,{variant_override:override})};}catch{/* Incomplete setup stays editable. */}
    output.standard_units_per_bucket=standardBucketUnits(config.family,output.size);
    const blend=output.flavor===editing.blend.flavor?editing.blend:structuredClone(config.blends.find(b=>b.flavor===output.flavor) || presetBlend(items,output.flavor));
    setEditing({...editing,output,blend});setSetupError('');
  }
  function applyProduct(){
    try {
      const o=editing.output,item=items.find(p=>p.id===o.product_id);
      const identity=yogurtProductIdentity(item,config.family,o);
      if(!(Number(o.buckets)>0)||!Number.isFinite(Number(o.buckets)))throw Error('Enter a positive bucket allocation.');
      if(!Number.isSafeInteger(Number(o.standard_units_per_bucket))||Number(o.standard_units_per_bucket)<=0)throw Error('Enter the expected whole units per bucket.');
      const output={...o,...identity};
      if(/ml$/i.test(output.size)){
        if(!(Number(o.net_weight_g)>0))throw Error('Enter the net grams per finished unit.');
        output.kg_per_unit=Number(o.net_weight_g)/1000;
      }
      if(!Number.isSafeInteger(Number(output.buckets)*Number(output.standard_units_per_bucket)))throw Error('Product bucket allocation must produce whole finished units.');
      const next=commitProductDraft(config,{...editing,output});
      if(next.outputs.reduce((n,row)=>n+Number(row.buckets),0)>Number(config.planned_buckets)+1e-6)throw Error('Product buckets exceed the batch size. Increase the recipe buckets or reduce an allocation.');
      change(regroup(next));setEditing(null);
    }catch(e){setSetupError(e.message);}
  }
  function removeProduct(id){change(regroup({...config,outputs:config.outputs.filter(o=>o.product_id!==id)}));setEditing(null);}
  let required=[],projectionError='';
  if(config.product_bucket_recipe){try{required=yogurtRequirements(config,recipeBucketPlan(config));}catch(e){projectionError=e.message;}}
  const missingMaterials=[...config.fermentation,...config.blends.flatMap(b=>b.materials)].some(r=>!r.material_id);
  const allocated=config.outputs.reduce((n,o)=>n+Number(o.buckets || 0),0);
  async function save(){setBusy(true);setError('');try{const {data}=await invokeFieldOps({action:'saveYogurtRecipe',recipeId:recipe?.id,name,notes,config});setRecipe(data.recipe);setConfig(data.recipe.yogurt_config);setDirty(false);navigate('/manufacturing/recipes/'+data.recipe.id,{replace:true});}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function approve(){setBusy(true);setError('');try{const {data}=await invokeFieldOps({action:'approveYogurtRecipe',recipeId:recipe.id});setRecipe(data.recipe);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <div className="mx-auto max-w-6xl space-y-4">
    <PageHeader title={ui(recipe?'Yogurt recipe':'New Recipe')} actions={<div className="flex gap-2">{recipe&&canEdit&&<RecipeDeleteButton recipe={recipe} disabled={busy} onDeleted={()=>navigate('/manufacturing?section=recipes')}/>}<Button variant="outline" onClick={()=>navigate('/manufacturing?section=recipes')}>{ui('Back')}</Button></div>}/>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    {loading?<p role="status">{ui('Loading materials.')}</p>:<fieldset disabled={busy||!canEdit} className="space-y-4">
      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-3 font-semibold">{ui('1. Set the batch')}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label={ui('Recipe buckets')} value={config.planned_buckets || 1} min={1} step="1" onChange={planned_buckets=>change({...config,planned_buckets})}/>
          <NativeSelect label={ui('Yogurt base')} value={config.family} onChange={changeBase}>{YOGURT_BASES.map(b=><option key={b.value} value={b.value}>{b.label}</option>)}</NativeSelect>
          <label className="text-sm font-medium">{ui('Recipe name')}<Input aria-label={ui('Recipe name')} value={name} onChange={e=>{setName(e.target.value);setDirty(true);}}/></label>
        </div>{recipe&&<div className="mt-3"><StatusBadge status={recipe.status}/></div>}
      </section>
      <section className="rounded-xl border bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{ui('2. Choose your products')}</h2><p className="text-sm" aria-live="polite">{ui('Allocated buckets')}: <strong>{allocated} / {config.planned_buckets || 1}</strong></p></div>
        <RecipeProductCatalogue key={config.family} items={items} family={config.family} outputs={config.outputs} onSelect={openProduct} onEditItem={setManagingItem} onItemSaved={saved=>setItems(current=>current.map(item=>item.id===saved.id?saved:item))} disabled={busy||!canEdit}/>
      </section>
      {config.outputs.length>0&&<section className="rounded-xl border bg-white p-4">
        <h2 className="mb-3 font-semibold">{ui('Batch summary')}</h2>
        <div className="divide-y">{config.outputs.map(o=><div key={o.product_id} className="flex flex-wrap items-center gap-3 py-2">
          <ProductPhoto product={items.find(p=>p.id===o.product_id)} name={o.product_name} className="h-12 w-12 shrink-0"/>
          <div className="min-w-0 flex-1 text-sm"><strong>{ui(PRODUCT_FLAVOURS.find(f=>f.value===o.flavor)?.label || o.flavor)} · {o.size}</strong><p className="text-slate-600">{ui('{0} buckets · {1} units',o.buckets,Number(o.buckets)*Number(o.standard_units_per_bucket || 0))}</p></div>
          <Button variant="outline" size="sm" aria-label={ui('Edit {0}',o.product_name)} onClick={()=>openProduct(items.find(p=>p.id===o.product_id))}>{ui('Edit')}</Button>
          <Button variant="ghost" size="sm" aria-label={ui('Remove {0}',o.product_name)} onClick={()=>removeProduct(o.product_id)}>{ui('Remove')}</Button>
        </div>)}</div>
        {projectionError&&<p role="status" className="mt-3 text-sm text-slate-700">{uiMessage(projectionError)}</p>}
        {missingMaterials&&<p role="status" className="mt-3 text-sm text-slate-700">{ui('Link the missing ingredients in product setup before saving.')}</p>}
        <details className="mt-3 border-t pt-3"><summary className="cursor-pointer text-sm font-medium">{ui('Material totals')}</summary>
          {required.filter(r=>r.stage!=='packaging').map((r,i)=><p key={i} className="mt-2 text-sm">{items.find(p=>p.id===r.material_id)?.name || ui('Select material')} · {r.quantity} {r.unit}{r.flavor?' · '+r.flavor:''}</p>)}
        </details>
      </section>}
      <label className="block text-sm font-medium">{ui('Recipe notes')}<textarea className="mt-1 w-full rounded-md border p-2" value={notes} onChange={e=>{setNotes(e.target.value);setDirty(true);}}/></label>
      <div className="flex flex-wrap gap-2 pb-6"><Button onClick={save} disabled={busy||!name.trim()||missingMaterials||config.product_bucket_recipe&&!!projectionError}>{ui(recipe&&recipe.status!=='draft'?'Save new draft version':'Save draft')}</Button>{recipe?.status==='draft'&&<Button variant="outline" onClick={approve} disabled={busy||dirty}>{ui('Approve recipe')}</Button>}{recipe?.status==='approved'&&!dirty&&<Button variant="outline" onClick={()=>navigate('/manufacturing/new?recipe='+recipe.id)}>{ui('Plan production')}</Button>}</div>
    </fieldset>}
    <Dialog open={!!editing} onOpenChange={open=>{if(!open)setEditing(null);}}>
      {editing&&<DialogContent onCloseAutoFocus={event=>{event.preventDefault();if(productTrigger.current?.isConnected)productTrigger.current.focus({preventScroll:true});}} className="flex max-h-[80dvh] w-[calc(100vw-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0" style={{width:'min(36rem, calc(100vw - 2rem))',maxHeight:'80dvh'}}>
        <DialogHeader className="shrink-0 border-b p-4 pr-10">
          <div className="flex items-center gap-3"><ProductPhoto product={items.find(p=>p.id===editing.output.product_id)} name={editing.output.product_name} className="h-16 w-16 shrink-0"/><div><DialogTitle>{ui(PRODUCT_FLAVOURS.find(f=>f.value===editing.output.flavor)?.label || 'Product setup')}{editing.output.size?' · '+editing.output.size:''}</DialogTitle><DialogDescription className="mt-1">{yogurtBase(config.family).label}</DialogDescription></div></div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4"><fieldset disabled={!canEdit||busy} className="min-w-0">
          {setupError&&<p role="alert" className="mb-3 text-sm text-red-700">{uiMessage(setupError)}</p>}
          <div className="grid grid-cols-2 gap-3">
            <NumberField label={ui('Product buckets')} value={editing.output.buckets} min={0.01} onChange={buckets=>setOutput({buckets})}/>
            <NumberField label={ui('Expected units per bucket')} value={editing.output.standard_units_per_bucket} min={1} step="1" onChange={standard_units_per_bucket=>setOutput({standard_units_per_bucket})}/>
          </div>
          <p className="my-3 rounded-md bg-emerald-50 p-3 text-sm">{ui('Expected output')}: <strong>{Number(editing.output.buckets)*Number(editing.output.standard_units_per_bucket) || 0} {ui(config.family==='brasse'?'cups':'bottles')}</strong></p>
          {editing.output.variant_override&&<div className="mb-3 grid grid-cols-2 gap-3"><NativeSelect label={ui('Flavour')} value={editing.output.flavor} onChange={flavor=>classifyOutput({flavor})}>{PRODUCT_FLAVOURS.map(f=><option key={f.value} value={f.value}>{ui(f.label)}</option>)}</NativeSelect><NativeSelect label={ui('Size')} value={editing.output.size} onChange={size=>classifyOutput({size})}>{PRODUCT_SIZES[config.family].map(size=><option key={size} value={size}>{size}</option>)}</NativeSelect></div>}
          {/ml$/i.test(editing.output.size)&&<div className="mb-3"><NumberField label={ui('Net grams per finished unit')} value={editing.output.net_weight_g ?? ''} min={0.001} onChange={net_weight_g=>setOutput({net_weight_g})}/></div>}
          <h3 className="mb-2 text-sm font-semibold">{ui('Base ingredients')}</h3>
          <p className="mb-2 text-xs text-slate-500">{ui('Milk and culture apply to every bucket in this batch.')}</p>
          <FormulaRows fixed={config.formula_version===2} roles disabled={!canEdit||busy} rows={editing.fermentation} items={raw} per={ui('Per 30 L bucket')} onChange={update=>setEditing(current=>({...current,fermentation:typeof update==='function'?update(current.fermentation):update}))}/>
          {editing.output.flavor&&<><h3 className="mb-2 mt-5 text-sm font-semibold">{ui('Added after fermentation')}</h3><p className="mb-2 text-xs text-slate-500">{ui('This formula applies to every size of this flavour. Enter your additive doses per bucket.')}</p>
            <FormulaRows protectedRoles={config.product_bucket_recipe?['sugar','flavour']:[]} fixed={config.formula_version===2} disabled={!canEdit||busy} rows={editing.blend.materials} items={raw} per={ui('Per allocated bucket')} onChange={update=>setEditing(current=>({...current,blend:{...current.blend,materials:typeof update==='function'?update(current.blend.materials):update}}))}/>
          </>}
        </fieldset></div>
        <div className="flex shrink-0 justify-end gap-2 border-t p-3"><Button variant="outline" onClick={()=>setEditing(null)}>{ui('Cancel')}</Button><Button disabled={!canEdit||busy} onClick={applyProduct}>{ui('Apply product')}</Button></div>
      </DialogContent>}
    </Dialog>
    <Dialog open={!!managingItem} onOpenChange={open=>{if(!open&&!managedItemBusy.current)setManagingItem(null);}}>
      {managingItem&&<DialogContent className="max-h-[85dvh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto" onEscapeKeyDown={event=>{if(managedItemBusy.current)event.preventDefault();}} onPointerDownOutside={event=>{if(managedItemBusy.current)event.preventDefault();}}>
        <DialogHeader><DialogTitle>{ui('Finish setup for {0}',managingItem.name)}</DialogTitle><DialogDescription>{ui('Your recipe stays here while you complete this inventory item.')}</DialogDescription></DialogHeader>
        <React.Suspense fallback={<p role="status">{ui('Loading item options...')}</p>}><ItemForm key={managingItem.id} embedded itemId={managingItem.id} onBusyChange={value=>{managedItemBusy.current=value;}} onCancel={()=>{if(!managedItemBusy.current)setManagingItem(null);}} onSaved={saved=>{setItems(current=>current.map(item=>item.id===saved.id?saved:item));setManagingItem(null);}}/></React.Suspense>
      </DialogContent>}
    </Dialog>
  </div>;
}

// Historical formulas retain their own stages and quantities. Opening one must
// not silently convert its sugar timing or rewrite an approved snapshot.
export default function YogurtRecipeEditor(props){
  const [upgradeRequested,setUpgradeRequested]=useState(false),{role}=useCurrentUser();
  if(!props.initialRecipe||props.initialRecipe.yogurt_config?.formula_version===3||upgradeRequested)return <PhasedYogurtRecipeEditor {...props} upgradeRequested={upgradeRequested}/>;
  return <><div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4 text-sm"><p>{ui('This recipe retains its saved production stages.')}</p>{['admin','production_manager'].includes(role)&&<Button variant="outline" onClick={()=>setUpgradeRequested(true)}>{ui('Create four-step draft')}</Button>}</div>{props.initialRecipe&&!props.initialRecipe.yogurt_config?.product_bucket_recipe
    ? <LegacyYogurtRecipeEditor {...props}/>
    : <VisualYogurtRecipeEditor {...props}/>}</>;
}
