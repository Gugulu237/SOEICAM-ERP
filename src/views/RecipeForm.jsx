
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { useBack, useNavigate, useParams, useSearchParams } from "@/lib/router";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Save, ArrowLeft, Plus, Trash2, CheckCircle } from "lucide-react";
import { assemblyRecipeDraft } from '@/lib/assembly-recipe';
import { readAll } from '@/lib/field-pos';
import { isAssemblyInventoryType } from "@/lib/item-types";
import { isYogurt } from '@/lib/yogurt-production';
import YogurtRecipeEditor from '@/components/manufacturing/YogurtRecipeEditor';

export default function RecipeForm() {
  const {id}=useParams(),[params]=useSearchParams();
  const [loaded,setLoaded]=useState(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;setLoaded(null);setError('');if(id)erp.entities.Recipe.get(id).then(row=>{if(active){if(!row)throw Error('Recipe not found.');setLoaded(row);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id]);
  if(error)return <p role="alert">{error}</p>;
  if(id&&loaded?.id!==id)return <p role="status">{ui('Loading recipe…')}</p>;
  if(id&&isYogurt(loaded) || !id&&!params.get('product')&&params.get('mode')!=='assembly')return <YogurtRecipeEditor key={id || 'new'} initialRecipe={id?loaded:null}/>;
  return <LegacyRecipeForm/>;
}

function LegacyRecipeForm() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { id } = useParams();
  const navigate = useNavigate(), goBack = useBack('/manufacturing');
  const { toast } = useToast();
  const isEdit = !!id;
  const [params]=useSearchParams();
  const selectedProduct=params.get("product");
  const [loadError,setLoadError]=useState("");
  const [excludedCount,setExcludedCount]=useState(0);

  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [form, setForm] = useState({
    product_id: "", recipe_name: "", version: 1, batch_output: 100, output_unit: "units",
    expected_yield_pct: 98, wastage_limit_pct: 2, notes: ""
  });
  const [lines, setLines] = useState([]);
  const [recipe, setRecipe] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active=true;
    readAll(erp.entities.Product,{is_active:true}).then(p=>{
      if(!active)return;
      setProducts(p.filter(x=>isAssemblyInventoryType(x.inventory_type) && x.configuration_status!=='draft'));
      setMaterials(p.filter(x=>x.inventory_type!=='service' && x.configuration_status!=='draft'));
      const selected=!isEdit && p.find(x=>x.id===selectedProduct && isAssemblyInventoryType(x.inventory_type));
      if(selected){const draft=assemblyRecipeDraft(selected,p);setForm(f=>({...f,...draft.form}));setLines(draft.lines);setExcludedCount(draft.excluded.length);}
    }).catch(e=>{if(active)setLoadError(e.message);});
    if(isEdit)loadRecipe().catch(e=>setLoadError(e.message));
    return ()=>{active=false;};
  }, [id,selectedProduct]);

  async function loadRecipe() {
    const r = await erp.entities.Recipe.get(id);
    setRecipe(r);
    setForm({
      product_id: r.product_id, recipe_name: r.recipe_name, version: r.version,
      batch_output: r.batch_output, output_unit: r.output_unit || "units",
      expected_yield_pct: r.expected_yield_pct || 98, wastage_limit_pct: r.wastage_limit_pct || 2,
      notes: r.notes || ""
    });
    const ls = await erp.entities.RecipeLine.filter({ recipe_id: id });
    setLines(ls);
  }

  function addLine() {
    setLines(l => [...l, { material_id: "", material_type: "ingredient", quantity: 0, unit: "kg", expected_wastage_pct: 0, sequence: lines.length + 1 }]);
  }

  function updateLine(i, field, value) {
    setLines(prev => {
      const arr = [...prev];
      arr[i] = { ...arr[i], [field]: value };
      if (field === "material_id") {
        const mat = materials.find(m => m.id === value);
        if (mat) {
          arr[i].material_name = mat.name;
          arr[i].unit = mat.production_unit || mat.storage_unit || "kg";
          arr[i].material_type = mat.inventory_type === "packaging" ? "primary_packaging" : "ingredient";
        }
      }
      return arr;
    });
  }

  async function handleSave(createNewVersion = false, navigateAfter = true) {
    if (!form.product_id || !form.recipe_name || lines.length === 0) {
      toast({ title: ui("Error"), description: ui("Fill required fields and add materials"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const prod = products.find(p => p.id === form.product_id);
      const data = { ...form, ...(!isEdit?{status:"draft"}:{}), product_name: prod?.name || "", effective_date: new Date().toISOString().split("T")[0], expected_component_count:lines.length, components_save_complete:false };

      // The approved version remains available while its replacement is a draft.
      // The server supersedes it atomically only when the replacement is approved.
      const isApprovedEdit = isEdit && (recipe?.status === "approved" || recipe?.approved_at || recipe?.approved_by || createNewVersion);
      let recipeId = id;

      if (isApprovedEdit) {
        // Create new version with incremented version number
        data.version = (recipe?.version || 1) + 1;
        data.status = "draft";
        const created = await erp.entities.Recipe.create(data);
        recipeId = created.id;
      } else if (isEdit) {
        await erp.entities.Recipe.update(id, data);
        const existing = await erp.entities.RecipeLine.filter({ recipe_id: id });
        for (const e of existing) await erp.entities.RecipeLine.delete(e.id);
      } else {
        const created = await erp.entities.Recipe.create(data);
        recipeId = created.id;
      }

      for (const l of lines) {
        await erp.entities.RecipeLine.create({
          recipe_id: recipeId, material_id: l.material_id, material_name: l.material_name || "",
          material_type: l.material_type, quantity: Number(l.quantity), unit: l.unit,
          expected_wastage_pct: Number(l.expected_wastage_pct) || 0, sequence: l.sequence || 0
        });
      }
      await erp.entities.Recipe.update(recipeId,{components_save_complete:true});

      toast({ title: ui("Saved"), description: isApprovedEdit ? ui("Draft version v{0} saved; the current approved recipe remains active.", data.version) : ui("Recipe saved") });
      if (navigateAfter) {
        navigate("/manufacturing");
      } else {
        // Reset form for a new recipe
        setForm({ product_id: "", recipe_name: "", version: 1, batch_output: 100, output_unit: "units", expected_yield_pct: 98, wastage_limit_pct: 2, notes: "" });
        setLines([]);
        setRecipe(null);
        navigate("/manufacturing/recipes/new");
      }
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function handleApprove() {
    try {
      await erp.entities.Recipe.update(id, { status: "approved", approved_at: new Date().toISOString() });
      await erp.entities.AuditLog.create({ action: "approve_recipe", module: "manufacturing", entity_type: "Recipe", entity_id: id, description: ui("Approved recipe {0} v{1}", recipe.recipe_name, recipe.version) });
      toast({ title: ui("Recipe approved") });
      loadRecipe();
    } catch (e) { toast({ title: ui("Error"), description: e.message, variant: "destructive" }); }
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? `Recipe: ${recipe?.recipe_name || ""}` : ui("New Recipe / BOM")}
        actions={
          <div className="flex gap-2">
            {isEdit && <Button variant="outline" onClick={() => navigate("/manufacturing/recipes/new")}><Plus size={16} className="mr-1" />{ui(" New Recipe")}</Button>}
            {isEdit && recipe?.status === "draft" && <Button variant="outline" onClick={handleApprove}><CheckCircle size={16} className="mr-1" />{ui(" Approve")}</Button>}
            <Button variant="outline" onClick={goBack}><ArrowLeft size={16} className="mr-1" />{ui(" Back")}</Button>
          </div>
        }
      />
      {loadError && <p role="alert" className="mb-4 text-red-700">{loadError}</p>}
      {isEdit && recipe?.status==='approved' && <p className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm">{ui("Changes are saved as a draft version. The current approved recipe remains active until the new version is approved.")}</p>}
      {!isEdit && selectedProduct && <p className="mb-4 rounded-xl border bg-sky-50 p-4 text-sm">{ui('Stock components were copied per one output unit. Review quantities, units and recipe approval before production.')}{excludedCount>0 && <span className="block mt-1">{ui('Labour, assets, overhead and unavailable components are excluded from warehouse issues. Review their costing separately.')}</span>}</p>}
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div>
            <Label>{ui("Finished Product *")}</Label>
            <Select value={form.product_id} onValueChange={v => setForm(f => ({ ...f, product_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Select product")} /></SelectTrigger>
              <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{ui("Recipe Name *")}</Label>
            <Input value={form.recipe_name} onChange={e => setForm(f => ({ ...f, recipe_name: e.target.value }))} />
          </div>
          <div>
            <Label>{ui("Version")}</Label>
            <Input type="number" value={form.version} onChange={e => setForm(f => ({ ...f, version: Number(e.target.value) }))} />
          </div>
          <div>
            <Label>{ui("Batch Output (units)")}</Label>
            <Input type="number" value={form.batch_output} onChange={e => setForm(f => ({ ...f, batch_output: Number(e.target.value) }))} />
          </div>
          <div>
            <Label>{ui("Expected Yield %")}</Label>
            <Input type="number" value={form.expected_yield_pct} onChange={e => setForm(f => ({ ...f, expected_yield_pct: Number(e.target.value) }))} />
          </div>
          <div>
            <Label>{ui("Wastage Limit %")}</Label>
            <Input type="number" value={form.wastage_limit_pct} onChange={e => setForm(f => ({ ...f, wastage_limit_pct: Number(e.target.value) }))} />
          </div>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">{ui("Bill of Materials")}</h3>
            <Button variant="outline" size="sm" onClick={addLine}><Plus size={14} className="mr-1" />{ui(" Add Material")}</Button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-600">
                <th className="pb-2">{ui("Material")}</th>
                <th className="pb-2 w-28">{ui("Type")}</th>
                <th className="pb-2 w-24">{ui("Quantity")}</th>
                <th className="pb-2 w-20">{ui("Unit")}</th>
                <th className="pb-2 w-20">{ui("Wastage %")}</th>
                <th className="pb-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 pr-2">
                    <Select value={l.material_id} onValueChange={v => updateLine(i, "material_id", v)}>
                      <SelectTrigger className="h-9"><SelectValue placeholder={ui("Select material")} /></SelectTrigger>
                      <SelectContent>{materials.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="py-2 pr-2">
                    <Select value={l.material_type} onValueChange={v => updateLine(i, "material_type", v)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ingredient">{ui("Ingredient")}</SelectItem>
                        <SelectItem value="primary_packaging">{ui("Primary Packaging")}</SelectItem>
                        <SelectItem value="secondary_packaging">{ui("Secondary Packaging")}</SelectItem>
                        <SelectItem value="consumable">{ui("Consumable")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-2 pr-2"><Input type="number" className="h-9" value={l.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} /></td>
                  <td className="py-2 pr-2"><Input className="h-9" value={l.unit} onChange={e => updateLine(i, "unit", e.target.value)} /></td>
                  <td className="py-2 pr-2"><Input type="number" className="h-9" value={l.expected_wastage_pct} onChange={e => updateLine(i, "expected_wastage_pct", e.target.value)} /></td>
                  <td className="py-2"><button onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <Label>{ui("Notes")}</Label>
          <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        {(!isEdit || recipe?.status === "draft" || recipe?.status === "approved") && (
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => handleSave(false, true)} disabled={saving}><Save size={16} className="mr-1" /> {saving ? ui("Saving...") : isEdit && recipe?.status === "approved" ? ui("Save as New Version") : ui("Save Recipe")}</Button>
            <Button variant="outline" onClick={() => handleSave(false, false)} disabled={saving}><Save size={16} className="mr-1" />{ui(" Save & New")}</Button>
          </div>
        )}
        {isEdit && recipe?.status === "superseded" && (
          <div className="text-sm text-slate-500 italic">{ui("This recipe version is superseded and cannot be edited.")}</div>
        )}
      </div>
    </div>
  );
}
