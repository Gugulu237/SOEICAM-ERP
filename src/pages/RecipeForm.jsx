import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Save, ArrowLeft, Plus, Trash2, CheckCircle } from "lucide-react";

export default function RecipeForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isEdit = !!id;

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
    Promise.all([
      base44.entities.Product.filter({ is_active: true }),
    ]).then(([p]) => {
      setProducts(p.filter(x => x.inventory_type === "finished_product"));
      setMaterials(p.filter(x => ["raw_material", "packaging", "consumable"].includes(x.inventory_type)));
    });
    if (isEdit) loadRecipe();
  }, [id]);

  async function loadRecipe() {
    const r = await base44.entities.Recipe.get(id);
    setRecipe(r);
    setForm({
      product_id: r.product_id, recipe_name: r.recipe_name, version: r.version,
      batch_output: r.batch_output, output_unit: r.output_unit || "units",
      expected_yield_pct: r.expected_yield_pct || 98, wastage_limit_pct: r.wastage_limit_pct || 2,
      notes: r.notes || ""
    });
    const ls = await base44.entities.RecipeLine.filter({ recipe_id: id });
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

  async function handleSave() {
    if (!form.product_id || !form.recipe_name || lines.length === 0) {
      toast({ title: "Error", description: "Fill required fields and add materials", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const prod = products.find(p => p.id === form.product_id);
      const data = { ...form, product_name: prod?.name || "", effective_date: new Date().toISOString().split("T")[0] };

      let recipeId = id;
      if (isEdit) {
        await base44.entities.Recipe.update(id, data);
        const existing = await base44.entities.RecipeLine.filter({ recipe_id: id });
        for (const e of existing) await base44.entities.RecipeLine.delete(e.id);
      } else {
        const created = await base44.entities.Recipe.create(data);
        recipeId = created.id;
      }

      for (const l of lines) {
        await base44.entities.RecipeLine.create({
          recipe_id: recipeId, material_id: l.material_id, material_name: l.material_name || "",
          material_type: l.material_type, quantity: Number(l.quantity), unit: l.unit,
          expected_wastage_pct: Number(l.expected_wastage_pct) || 0, sequence: l.sequence || 0
        });
      }

      toast({ title: "Saved" });
      navigate("/manufacturing");
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function handleApprove() {
    try {
      await base44.entities.Recipe.update(id, { status: "approved", approved_at: new Date().toISOString() });
      await base44.entities.AuditLog.create({ action: "approve_recipe", module: "manufacturing", entity_type: "Recipe", entity_id: id, description: `Approved recipe ${recipe.recipe_name} v${recipe.version}` });
      toast({ title: "Recipe approved" });
      loadRecipe();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? `Recipe: ${recipe?.recipe_name || ""}` : "New Recipe / BOM"}
        actions={
          <div className="flex gap-2">
            {isEdit && recipe?.status === "draft" && <Button variant="outline" onClick={handleApprove}><CheckCircle size={16} className="mr-1" /> Approve</Button>}
            <Button variant="outline" onClick={() => navigate("/manufacturing")}><ArrowLeft size={16} className="mr-1" /> Back</Button>
          </div>
        }
      />
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div>
            <Label>Finished Product *</Label>
            <Select value={form.product_id} onValueChange={v => setForm(f => ({ ...f, product_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Recipe Name *</Label>
            <Input value={form.recipe_name} onChange={e => setForm(f => ({ ...f, recipe_name: e.target.value }))} />
          </div>
          <div>
            <Label>Version</Label>
            <Input type="number" value={form.version} onChange={e => setForm(f => ({ ...f, version: Number(e.target.value) }))} />
          </div>
          <div>
            <Label>Batch Output (units)</Label>
            <Input type="number" value={form.batch_output} onChange={e => setForm(f => ({ ...f, batch_output: Number(e.target.value) }))} />
          </div>
          <div>
            <Label>Expected Yield %</Label>
            <Input type="number" value={form.expected_yield_pct} onChange={e => setForm(f => ({ ...f, expected_yield_pct: Number(e.target.value) }))} />
          </div>
          <div>
            <Label>Wastage Limit %</Label>
            <Input type="number" value={form.wastage_limit_pct} onChange={e => setForm(f => ({ ...f, wastage_limit_pct: Number(e.target.value) }))} />
          </div>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">Bill of Materials</h3>
            <Button variant="outline" size="sm" onClick={addLine}><Plus size={14} className="mr-1" /> Add Material</Button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-600">
                <th className="pb-2">Material</th>
                <th className="pb-2 w-28">Type</th>
                <th className="pb-2 w-24">Quantity</th>
                <th className="pb-2 w-20">Unit</th>
                <th className="pb-2 w-20">Wastage %</th>
                <th className="pb-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 pr-2">
                    <Select value={l.material_id} onValueChange={v => updateLine(i, "material_id", v)}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select material" /></SelectTrigger>
                      <SelectContent>{materials.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="py-2 pr-2">
                    <Select value={l.material_type} onValueChange={v => updateLine(i, "material_type", v)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ingredient">Ingredient</SelectItem>
                        <SelectItem value="primary_packaging">Primary Packaging</SelectItem>
                        <SelectItem value="secondary_packaging">Secondary Packaging</SelectItem>
                        <SelectItem value="consumable">Consumable</SelectItem>
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
          <Label>Notes</Label>
          <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        {(!isEdit || recipe?.status === "draft") && (
          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Saving..." : "Save Recipe"}</Button>
          </div>
        )}
      </div>
    </div>
  );
}