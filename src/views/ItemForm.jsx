import AssemblyYieldFields from '@/components/items/AssemblyYieldFields';
import { validateAssemblyYieldChanges } from '@/lib/assembly-yield';

/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';

import React, { useState, useEffect, useMemo, useRef } from "react";
import { erp } from "@/api/erpClient";
import { useBack, useNavigate, useParams, useSearchParams } from "@/lib/router";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import ProductPhotoPicker from "@/components/items/ProductPhotoPicker";
import ItemTypeChooser from "@/components/items/ItemTypeChooser";
import InventoryFields from "@/components/items/InventoryFields";
import ServiceFields from "@/components/items/ServiceFields";
import AssemblyFields from "@/components/items/AssemblyFields";
import UnitOfMeasureSelect from "@/components/items/UnitOfMeasureSelect";
import { Save, ArrowLeft, ChevronDown } from "lucide-react";
import { assemblyCost, componentType, validateComponentNumbers, priceComponent } from "@/lib/assembly-components";
import { itemFormType, isAssemblyInventoryType } from "@/lib/item-types";
import { PRODUCT_FAMILIES, MATERIAL_GROUPS, inventoryGroup, inventoryGroups } from "@/lib/inventory-groups";
import { stockUnit, DEFAULT_ITEM_UNITS, itemUnits } from "@/lib/item-units";
import { ITEM_ACCOUNT_FIELDS, availableItemAccount } from "@/lib/item-accounts";
import { getItemCatalog } from "@/lib/item-lookup-cache";
import UnitChangeDialog from '@/components/items/UnitChangeDialog';
import { finishedItemSetupIssues,itemAvailabilityLabel } from '@/lib/item-readiness';
import { itemFormChanges } from '@/lib/item-form-save';
import ProductVariantFields from '@/components/items/ProductVariantFields';
import { validateFinishedVariantChanges } from '@/lib/product-variants';
import ItemAttributesEditor from '@/components/items/ItemAttributesEditor';
import { itemAttributes, attributeFacets, validateItemMetadata } from '@/lib/item-attributes';

const SUB_TYPES = [["additive", "Additive"], ["raw_material", "Raw material / Ingredient"], ["packaging", "Packaging"], ["finished_product", "Finished Product / Assembly"], ["consumable", "Consumable"], ["cleaning", "Cleaning supply"], ["spare_part", "Spare part"], ["promotional", "Promotional"], ["wip", "Work in progress"]];
const SKU_PREFIX = { inventory_item: "ITM", service: "SRV", assembly: "ASM" };

export default function ItemForm({ embedded = false, itemId, initialType = "inventory_item", initialInventoryType = "raw_material", excludedProductIds = [], onSaved, onCancel, onBusyChange, onCatalogItemCreated }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { id:routeId } = useParams(), navigate = useNavigate(), goBack = useBack("/inventory"), { toast } = useToast();
  const id = embedded ? itemId : routeId;
  const [params]=useSearchParams();
  const requestedType=!embedded && !id && ["inventory_item","service","assembly"].includes(params.get("type"))?params.get("type"):initialType;
  const isEdit = !!id;
  const [savedItem,setSavedItem] = useState(null), [pendingSave,setPendingSave] = useState(null), [saveError,setSaveError] = useState('');
  const originalForm = useRef(null);
  const savingRef = useRef(false);
  const [itemType, setItemType] = useState(requestedType);
  const [products, setProducts] = useState([]), [assets, setAssets] = useState([]), [accounts, setAccounts] = useState([]), [suppliers, setSuppliers] = useState([]), [units, setUnits] = useState(DEFAULT_ITEM_UNITS);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(""), [reload, setReload] = useState(0);
  const [components, setComponents] = useState([]), [quantityOnHand, setQuantityOnHand] = useState(0);
  const [stockLoading, setStockLoading] = useState(isEdit), [stockError, setStockError] = useState(""), [stockReload, setStockReload] = useState(0);
  const [legacyUnits, setLegacyUnits] = useState(null);
  const [saving, setSaving] = useState(false), [unitBusy, setUnitBusy] = useState(false);
  const [form, setForm] = useState({
    yogurt_units_per_bucket: '', yogurt_net_weight_g: '', attributes: [], product_family: "", material_group: "", image_url: "", size: "", flavor: "", sku: "", name: "", description: "", category: "",
    inventory_type: requestedType === "assembly" ? "assembly" : requestedType === "service" ? "service" : initialInventoryType,
    unit_of_measure: requestedType === "service" ? "hr" : requestedType === "inventory_item" && initialInventoryType === "raw_material" ? "kg" : "ea",
    costing_method: "average", purchase_price: 0, current_cost: 0, standard_cost: 0, selling_price: 0,
    cogs_account_id: "", revenue_account_id: "", inventory_account_id: "", preferred_supplier_id: "",
    reorder_level: 0, min_stock: 0, max_stock: 0, lot_tracking: false, expiry_tracking: false, shelf_life_days: 0, tax_rate: 0, is_active: true,
  });

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError("");
    Promise.all([
      getItemCatalog(),
      isEdit ? erp.entities.Product.get(id) : Promise.resolve(null),
    ]).then(([catalog, item]) => {
      if (!active) return;
      setProducts(catalog.products); setAssets(catalog.assets); setAccounts(catalog.accounts); setSuppliers(catalog.suppliers); setUnits(catalog.units);
      if (isEdit && !item) throw new Error(ui("Item not found"));
      if (item) {
        setSavedItem(item);
        const type = itemFormType(item.inventory_type);
        const catalogueDraft = item.configuration_status === "draft";
        const unit = catalogueDraft && !item.unit_of_measure ? "" : stockUnit(item);
        setItemType(type); setComponents(item.components || []);
        setLegacyUnits({ stock: unit, purchase: item.purchase_unit || unit });
        setForm(previous => { const loaded = { ...previous,
          ...Object.fromEntries(Object.keys(previous).filter(key => item[key] != null).map(key => [key, item[key]])),
          inventory_type: type === "assembly" ? "assembly" : item.inventory_type,
          attributes: itemAttributes(item), unit_of_measure: unit, purchase_price: item.purchase_price ?? Number(item.current_cost || 0) * Number(item.purchase_to_storage_factor || 1),
          ...(catalogueDraft ? { selling_price: item.selling_price ?? "" } : {}),
        }; originalForm.current = {...loaded,components:item.components || []}; return loaded; });
      }
    }).catch(error => { if (active) setLoadError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, embedded, reload]);

  // Stock is a current server total, not cached selection metadata. Let the
  // editor become usable while this independent, read-only value is loading.
  useEffect(() => {
    let active = true;
    setStockError(""); setStockLoading(isEdit); setQuantityOnHand(0);
    if (isEdit) erp.entities.StockBalance.aggregate({ query: { product_id: id }, sum: ['quantity'] })
      .then(total => { if (active) setQuantityOnHand(Math.round(Number(total.sum_quantity || 0) * 1000) / 1000); })
      .catch(error => { if (active) setStockError(error.message || ui("Stock quantity could not load")); })
      .finally(() => { if (active) setStockLoading(false); });
    return () => { active = false; };
  }, [id, embedded, reload, stockReload]);

  const set = (key, value) => {
    if (key === "inventory_type") {
      setItemType(itemFormType(value));
      setForm(previous => ({ ...previous, inventory_type: isAssemblyInventoryType(value) ? "assembly" : value }));
    } else setForm(previous => {const next={...previous,[key]:value};return {...next,...(['product_family','size','name','category'].includes(key)?validateAssemblyYieldChanges({[key]:value},previous):{})};});
  };
  const changeType = type => set("inventory_type", type === "inventory_item" ? itemFormType(form.inventory_type) === "inventory_item" ? form.inventory_type : initialInventoryType : type);
  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const pricedComponents = useMemo(() => components.map(row => {
    const product = productById.get(row.product_id);
    if (!product) return row;
    try { return priceComponent(row, product); } catch { return row; }
  }), [components, productById]);
  const attributeOptions = useMemo(() => attributeFacets(products), [products]);
  const estimatedCost = useMemo(() => assemblyCost(pricedComponents), [pricedComponents]);

  async function handleSave() {
    if (savingRef.current || unitBusy) return;
    setSaveError('');
    let payload, changes;
    try {
      if (!form.name.trim()) throw new Error(ui("Item name is required"));
      if (!form.unit_of_measure) throw new Error(ui("Choose a Unit of Measure"));
      payload = {
        ...form,name:form.name.trim(),
        sku:form.sku || (isEdit ? '' : SKU_PREFIX[itemType] + '-' + crypto.randomUUID().slice(0,8).toUpperCase()),
        inventory_type:itemType==='inventory_item' ? form.inventory_type : itemType,
        components:itemType==='assembly' ? isEdit && JSON.stringify(components)===JSON.stringify(originalForm.current?.components) ? components : pricedComponents : [],
      };
      if (itemType!=='assembly') {delete payload.selling_price;delete payload.revenue_account_id;delete payload.yogurt_units_per_bucket;delete payload.yogurt_net_weight_g;}
      changes = isEdit ? itemFormChanges(originalForm.current,payload) : payload;
      changes = {...changes,...validateItemMetadata(changes),...validateFinishedVariantChanges(changes,savedItem || {}),...validateAssemblyYieldChanges(changes,savedItem || {})};
      if(!isEdit)payload=changes;
      for (const { field, label, types } of ITEM_ACCOUNT_FIELDS) {
        if (itemType!=="assembly" && (field==="revenue_account_id" || itemType==="service")) continue;
        if (isEdit && !Object.hasOwn(changes,field) && !Object.hasOwn(changes,'inventory_type')) continue;
        if (!availableItemAccount(accounts.find(account => account.id === form[field]), types)) throw new Error("Choose a " + label);
      }
      if (itemType === "assembly" && (!isEdit || Object.hasOwn(changes,'components') || Object.hasOwn(changes,'inventory_type'))) {
        if (!pricedComponents.length) throw new Error(ui("Add at least one component"));
        for (const row of pricedComponents) {
          validateComponentNumbers(row);
          const type = componentType(row, products);
          if (!row.unit?.trim() || (type === "other" ? !row.product_name?.trim() : type === "fixed_asset" ? !row.asset_id : !row.product_id)) throw new Error(ui("Choose an item and unit for every component"));
        }
      }
    } catch (error) { setSaveError(error.message); toast({ title: ui("Check item details"), description: error.message, variant: "destructive" }); return; }
    if (isEdit) {
      if (!Object.keys(changes).length) { toast({title:ui('No changes to save')}); return; }
      const input = {id,changes,updatedDate:savedItem.updated_date};
      if (changes.unit_of_measure && changes.unit_of_measure!==stockUnit(savedItem)) input.unitChange={confirmed:true,mode:'correct_label',fromUnit:stockUnit(savedItem),toUnit:changes.unit_of_measure,updatedDate:savedItem.updated_date,requestKey:crypto.randomUUID()};
      setPendingSave(input);
      return;
    }
    await persist({changes:payload});
  }

  async function persist(input) {
    if (savingRef.current || !input) return;
    savingRef.current = true;
    setSaving(true); onBusyChange?.(true); setSaveError('');
    try {
      const saved = isEdit ? await erp.items.save(input) : await erp.entities.Product.create(input.changes);
      setPendingSave(null);
      toast({ title: ui("Saved"), description: form.name + " saved" });
      if (embedded) onSaved?.(saved); else navigate("/inventory");
    } catch (error) { setSaveError(error.message); toast({ title: ui("Error"), description: error.message, variant: "destructive" }); }
    finally { savingRef.current=false; setSaving(false); onBusyChange?.(false); }
  }

  if (loading) return <p role="status" className="p-6 text-sm text-slate-500">{ui("Loading item options...")}</p>;
  if (loadError) return <div className="space-y-3 rounded-xl border bg-white p-6"><p role="alert" className="text-sm text-red-700">{uiMessage(loadError)}</p><Button type="button" variant="outline" onClick={() => setReload(value => value + 1)}>{ui("Reload item form")}</Button></div>;
  const exclusions = [...new Set([...excludedProductIds, ...(isEdit ? [id] : [])])];
  const catalogChanged = (type, record) => { if (type === "fixed_asset") setAssets(rows => [...rows.filter(row => row.id !== record.id), record]); else { setProducts(rows => [...rows.filter(row => row.id !== record.id), record]); setUnits(previous => itemUnits(previous, [record])); } onCatalogItemCreated?.(type, record); };
  const cancel = () => { if (!savingRef.current && !unitBusy) { if (embedded) onCancel?.(); else goBack(); } };

  return <div>
    {!embedded && <PageHeader title={isEdit ? ui("Edit Item") : ui("New Item")} subtitle={ui("Set up the item, its accounts and its stock settings.")} actions={<Button variant="outline" disabled={saving || unitBusy} onClick={cancel}><ArrowLeft size={16} className="mr-1" />{ui("Back")}</Button>} />}
    <fieldset disabled={saving} className={embedded ? "space-y-5" : "max-w-5xl space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6"}>
      {savedItem&&(savedItem.configuration_status==='draft'||savedItem.is_active===false)&&<div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900"><strong>{ui(itemAvailabilityLabel(savedItem))}</strong><p className="mt-1">{ui('Complete the required details and turn on Active item before saving.')}</p>{finishedItemSetupIssues({...form,components}).length>0&&<p className="mt-1">{ui('Still needed')}: {finishedItemSetupIssues({...form,components}).map(label=>ui(label)).join(', ')}</p>}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3"><ItemTypeChooser value={itemType} onChange={changeType} /><label className="flex items-center gap-2 text-sm"><Switch aria-label={ui("Active item")} checked={form.is_active} onCheckedChange={value => set("is_active", value)} />{ui("Active item")}</label></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1.5fr]">
        <label className="space-y-1.5 text-sm font-medium">{ui("Item name *")}<Input value={form.name} onChange={event => set("name", event.target.value)} placeholder={ui("e.g. YOLA Natural Yogurt 500ml")} /></label>
        <label className="space-y-1.5 text-sm font-medium">{ui("Item code / SKU")}<Input value={form.sku} onChange={event => set("sku", event.target.value)} placeholder={ui("Auto-generated")} /></label>
        <UnitOfMeasureSelect value={form.unit_of_measure} onChange={value => set("unit_of_measure", value)} units={units} onUnitsChange={setUnits} onBusyChange={value => { setUnitBusy(value); onBusyChange?.(value); }} />
      </div>
      {itemType !== "service" && <label className="block max-w-sm space-y-1.5 text-sm font-medium">{ui("Inventory sub-type")}<select value={isAssemblyInventoryType(form.inventory_type) ? "finished_product" : form.inventory_type} onChange={event => set("inventory_type", event.target.value)} className="h-10 w-full rounded-md border bg-white px-3 text-sm">{!SUB_TYPES.some(([value]) => value === form.inventory_type) && itemType !== "assembly" && <option value={form.inventory_type}>{form.inventory_type}</option>}{SUB_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      {itemType!=='service' && <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1.5 text-sm font-medium">{itemType==='assembly'?ui('Product family'):ui('Material group')}<Input list="inventory-groups" value={(itemType==='assembly'?form.product_family:form.material_group) || inventoryGroup(form)} onChange={e=>set(itemType==='assembly'?'product_family':'material_group',e.target.value)} placeholder={ui('Choose or add a group')}/><datalist id="inventory-groups">{[...new Set([...(itemType==='assembly'?PRODUCT_FAMILIES:MATERIAL_GROUPS),...inventoryGroups(products,itemType==='assembly')])].map(value=><option key={value} value={value}/>)}</datalist><span className="block text-xs font-normal text-slate-500">{ui('Type a new name to add another group.')}</span></label>
        {itemType==='assembly' && <ProductVariantFields item={form} values={form} onChange={set} disabled={saving}/>}
      </div>}
      {itemType==='assembly' && <AssemblyYieldFields item={savedItem || {}} values={form} onChange={set} disabled={saving}/>}
      {itemType!=="service" && <div className="rounded-xl border border-slate-200 p-4"><ItemAttributesEditor value={form.attributes} onChange={value=>set("attributes",value)} disabled={saving} suggestions={attributeOptions}/></div>}
      {itemType === "service" ? <ServiceFields form={form} set={set} accounts={accounts} /> : <InventoryFields form={form} set={set} accounts={accounts} suppliers={suppliers} isAssembly={itemType === "assembly"} estimatedCost={Number.isFinite(estimatedCost) ? estimatedCost : 0} quantityOnHand={stockLoading ? "Loading…" : stockError ? "Unavailable" : quantityOnHand} purchaseUnit={legacyUnits?.stock === form.unit_of_measure ? legacyUnits.purchase : form.unit_of_measure} />}
      {itemType !== "service" && stockError && <p role="alert" className="text-xs text-slate-800">{stockError}.<button type="button" className="ml-2 underline" onClick={() => setStockReload(value => value + 1)}>{ui("Retry stock quantity")}</button></p>}
      {itemType === "assembly" && <AssemblyFields components={pricedComponents} setComponents={setComponents} products={products} assets={assets} units={units} excludedProductIds={exclusions} onCatalogChange={catalogChanged} disabled={saving} />}
      <details className="rounded-xl border border-slate-200"><summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-semibold">{ui("Photo and extra settings")}<ChevronDown size={16} /></summary><div className="space-y-4 border-t p-4">
        {itemType !== "service" && <ProductPhotoPicker product={form} onChange={value => set("image_url", value)} />}
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5 text-sm font-medium">{ui("Category")}<Input value={form.category} onChange={event => set("category", event.target.value)} /></label>{itemType!=='assembly' && <label className="space-y-1.5 text-sm font-medium">{itemType === "service" ? ui("Service cost (XAF / U/M)") : ui("Pack size")}<Input type={itemType === "service" ? "number" : "text"} value={itemType === "service" ? form.purchase_price : form.size} onChange={event => set(itemType === "service" ? "purchase_price" : "size", event.target.value)} /></label>}
          <label className="space-y-1.5 text-sm font-medium">{ui("Tax rate (%)")}<Input type="number" min="0" max="100" step="any" value={form.tax_rate} onChange={event => set("tax_rate", event.target.value)} /></label>
          {itemType !== "service" && <label className="space-y-1.5 text-sm font-medium">{ui("Costing method")}<select value={form.costing_method} onChange={event => set("costing_method", event.target.value)} className="h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="average">{ui("Average cost")}</option><option value="fifo">{ui("FIFO")}</option><option value="standard">{ui("Standard cost")}</option></select></label>}
        </div>
        {itemType !== "service" && <><div className="grid gap-4 sm:grid-cols-3"><label className="space-y-1.5 text-sm font-medium">{ui("Shelf life (days)")}<Input type="number" min="0" step="1" value={form.shelf_life_days} onChange={event => set("shelf_life_days", event.target.value)} /></label><label className="space-y-1.5 text-sm font-medium">{ui("Minimum stock")}<Input type="number" min="0" step="any" value={form.min_stock} onChange={event => set("min_stock", event.target.value)} /></label><label className="space-y-1.5 text-sm font-medium">{ui("Maximum stock")}<Input type="number" min="0" step="any" value={form.max_stock} onChange={event => set("max_stock", event.target.value)} /></label></div><div className="flex flex-wrap gap-6"><label className="flex items-center gap-2 text-sm"><Switch checked={form.lot_tracking} onCheckedChange={value => set("lot_tracking", value)} />{ui("Lot / batch tracking")}</label><label className="flex items-center gap-2 text-sm"><Switch checked={form.expiry_tracking} onCheckedChange={value => set("expiry_tracking", value)} />{ui("Expiry tracking")}</label></div></>}
        <label className="block space-y-1.5 text-sm font-medium">{ui("Description")}<Textarea rows={2} value={form.description} onChange={event => set("description", event.target.value)} /></label>
      </div></details>
      {saveError && !pendingSave && <p role="alert" className="text-sm text-red-700">{uiMessage(saveError)}</p>}
      <div className="flex gap-3 border-t pt-4"><Button type="button" onClick={handleSave} disabled={saving || unitBusy}><Save size={16} className="mr-1" />{saving ? ui("Saving...") : ui("Save Item")}</Button><Button type="button" variant="outline" onClick={cancel} disabled={saving || unitBusy}>{ui("Cancel")}</Button></div>
    </fieldset>
    <UnitChangeDialog open={!!pendingSave} itemName={form.name} fromUnit={savedItem && stockUnit(savedItem)} toUnit={pendingSave?.changes.unit_of_measure || savedItem && stockUnit(savedItem)} saving={saving} error={uiMessage(saveError)} onConfirm={()=>persist(pendingSave)} onCancel={()=>{if(!savingRef.current)setPendingSave(null);}} />
  </div>;
}
