import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF, formatNumber } from "@/lib/formatters";
import { Save, ArrowLeft, CheckCircle, Play, PackageCheck } from "lucide-react";

export default function ProductionOrderForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isEdit = !!id;

  const [recipes, setRecipes] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [form, setForm] = useState({
    recipe_id: "", planned_output: 0, production_date: new Date().toISOString().split("T")[0], warehouse_id: "", notes: ""
  });
  const [materials, setMaterials] = useState([]);
  const [order, setOrder] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.Recipe.filter({ status: "approved" }),
      base44.entities.Warehouse.filter({ is_active: true }),
    ]).then(([r, w]) => { setRecipes(r); setWarehouses(w); });
    if (isEdit) loadOrder();
  }, [id]);

  async function loadOrder() {
    const o = await base44.entities.ProductionOrder.get(id);
    setOrder(o);
    setForm({ recipe_id: o.recipe_id, planned_output: o.planned_output, production_date: o.production_date, warehouse_id: o.warehouse_id || "", notes: o.notes || "" });
    const mats = await base44.entities.ProductionMaterial.filter({ production_order_id: id });
    setMaterials(mats);
  }

  async function calculateMaterials(recipeId, plannedOutput) {
    if (!recipeId || !plannedOutput) return;
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const recipeLines = await base44.entities.RecipeLine.filter({ recipe_id: recipeId });
    const scaleFactor = Number(plannedOutput) / recipe.batch_output;
    const calc = recipeLines.map(rl => ({
      material_id: rl.material_id, material_name: rl.material_name,
      standard_quantity: Math.round(rl.quantity * scaleFactor * 1000) / 1000,
      unit: rl.unit, unit_cost: 0
    }));
    // fetch current costs
    for (const m of calc) {
      const prod = await base44.entities.Product.get(m.material_id);
      m.unit_cost = prod?.current_cost || 0;
    }
    setMaterials(calc);
  }

  async function handleRecipeChange(recipeId) {
    setForm(f => ({ ...f, recipe_id: recipeId }));
    const recipe = recipes.find(r => r.id === recipeId);
    if (recipe) setForm(f => ({ ...f, product_id: recipe.product_id }));
    await calculateMaterials(recipeId, form.planned_output);
  }

  async function handleOutputChange(val) {
    const num = Number(val);
    setForm(f => ({ ...f, planned_output: num }));
    await calculateMaterials(form.recipe_id, num);
  }

  const standardCost = materials.reduce((s, m) => s + (m.standard_quantity || 0) * (m.unit_cost || 0), 0);
  const costPerUnit = form.planned_output > 0 ? standardCost / form.planned_output : 0;

  async function handleSave() {
    if (!form.recipe_id || form.planned_output <= 0) {
      toast({ title: "Error", description: "Select a recipe and enter planned output", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const recipe = recipes.find(r => r.id === form.recipe_id);
      const data = {
        ...form, product_id: recipe.product_id, product_name: recipe.product_name,
        standard_cost_per_unit: Math.round(costPerUnit),
        total_material_cost: Math.round(standardCost)
      };

      let orderId = id;
      if (isEdit) {
        await base44.entities.ProductionOrder.update(id, data);
      } else {
        const settings = (await base44.entities.CompanySettings.filter({}))[0];
        const num = settings?.next_production_number || 1;
        data.order_number = `PRD-${String(num).padStart(5, "0")}`;
        data.batch_number = `B-${String(num).padStart(5, "0")}`;
        if (settings) await base44.entities.CompanySettings.update(settings.id, { next_production_number: num + 1 });
        const created = await base44.entities.ProductionOrder.create(data);
        orderId = created.id;
      }

      // Save materials
      if (!isEdit) {
        for (const m of materials) {
          await base44.entities.ProductionMaterial.create({
            production_order_id: orderId, ...m, total_cost: Math.round(m.standard_quantity * m.unit_cost)
          });
        }
      }

      toast({ title: "Saved" });
      navigate("/manufacturing");
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function handleIssueMaterials() {
    try {
      const wipWh = warehouses.find(w => w.warehouse_type === "wip");
      for (const m of materials) {
        // Find stock using FEFO
        const balances = await base44.entities.StockBalance.filter({ product_id: m.material_id });
        const available = balances.filter(b => b.quantity > 0).sort((a, b) => (a.expiry_date || "9999") < (b.expiry_date || "9999") ? -1 : 1);
        let remaining = m.standard_quantity;
        for (const bal of available) {
          if (remaining <= 0) break;
          const issueQty = Math.min(remaining, bal.quantity);
          await base44.entities.StockMovement.create({
            product_id: m.material_id, product_name: m.material_name, quantity: issueQty,
            movement_type: "production_issue", source_warehouse_id: bal.warehouse_id,
            destination_warehouse_id: wipWh?.id || "", lot_number: bal.lot_number || "",
            expiry_date: bal.expiry_date, unit_cost: bal.unit_cost || m.unit_cost,
            total_value: Math.round(issueQty * (bal.unit_cost || m.unit_cost)),
            document_type: "ProductionOrder", document_id: id,
            movement_date: order.production_date
          });
          await base44.entities.StockBalance.update(bal.id, {
            quantity: bal.quantity - issueQty,
            total_value: (bal.total_value || 0) - Math.round(issueQty * (bal.unit_cost || 0))
          });
          remaining -= issueQty;
        }
        await base44.entities.ProductionMaterial.update(m.id, { issued_quantity: m.standard_quantity, consumed_quantity: m.standard_quantity });
      }
      await base44.entities.ProductionOrder.update(id, { status: "materials_issued" });
      await base44.entities.AuditLog.create({ action: "issue_materials", module: "manufacturing", entity_type: "ProductionOrder", entity_id: id, description: `Materials issued for ${order.order_number}` });
      toast({ title: "Materials issued" });
      loadOrder();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  async function handleComplete() {
    const actualOutput = prompt("Enter actual acceptable output quantity:");
    if (!actualOutput) return;
    const qty = Number(actualOutput);
    try {
      const fgWh = warehouses.find(w => w.warehouse_type === "finished_goods" || w.warehouse_type === "cold_room");
      const actualCost = materials.reduce((s, m) => s + ((m.consumed_quantity || m.standard_quantity) * (m.unit_cost || 0)), 0);
      const actualCPU = qty > 0 ? Math.round(actualCost / qty) : 0;

      // Create finished goods stock
      await base44.entities.StockMovement.create({
        product_id: order.product_id, product_name: order.product_name, quantity: qty,
        movement_type: "production_output", destination_warehouse_id: fgWh?.id || "",
        lot_number: order.batch_number, expiry_date: order.expiry_date,
        unit_cost: actualCPU, total_value: Math.round(qty * actualCPU),
        document_type: "ProductionOrder", document_id: id,
        movement_date: order.production_date
      });

      // Create/update stock balance for finished product
      const existing = await base44.entities.StockBalance.filter({
        product_id: order.product_id, warehouse_id: fgWh?.id || "", lot_number: order.batch_number || ""
      });
      if (existing.length > 0) {
        const bal = existing[0];
        await base44.entities.StockBalance.update(bal.id, {
          quantity: bal.quantity + qty, total_value: (bal.total_value || 0) + Math.round(qty * actualCPU),
          unit_cost: actualCPU
        });
      } else {
        await base44.entities.StockBalance.create({
          product_id: order.product_id, product_name: order.product_name,
          warehouse_id: fgWh?.id || "", warehouse_name: fgWh?.name || "Finished Goods",
          lot_number: order.batch_number || "", expiry_date: order.expiry_date,
          quantity: qty, unit_cost: actualCPU, total_value: Math.round(qty * actualCPU)
        });
      }

      // Update product cost
      await base44.entities.Product.update(order.product_id, { current_cost: actualCPU });

      // Create accounting journal: Debit FG Inventory, Credit WIP
      const accounts = await base44.entities.Account.filter({});
      const fgAccount = accounts.find(a => a.account_number === "1320");
      const wipAccount = accounts.find(a => a.account_number === "1315");
      const totalVal = Math.round(qty * actualCPU);

      if (fgAccount && wipAccount) {
        const settings = (await base44.entities.CompanySettings.filter({}))[0];
        const jNum = settings?.next_journal_number || 1;
        const journal = await base44.entities.JournalEntry.create({
          journal_number: `JE-${String(jNum).padStart(5, "0")}`,
          entry_date: order.production_date,
          description: `Production output ${order.order_number} - ${order.product_name}`,
          source_module: "manufacturing", source_document_type: "ProductionOrder",
          source_document_id: id, status: "posted",
          total_debit: totalVal, total_credit: totalVal, is_immutable: true,
          posted_at: new Date().toISOString()
        });
        if (settings) await base44.entities.CompanySettings.update(settings.id, { next_journal_number: jNum + 1 });

        await base44.entities.JournalLine.create({
          journal_id: journal.id, account_id: fgAccount.id,
          account_number: fgAccount.account_number, account_name: fgAccount.name,
          debit: totalVal, credit: 0, description: "Finished goods produced"
        });
        await base44.entities.JournalLine.create({
          journal_id: journal.id, account_id: wipAccount.id,
          account_number: wipAccount.account_number, account_name: wipAccount.name,
          debit: 0, credit: totalVal, description: "WIP consumed"
        });
      }

      await base44.entities.ProductionOrder.update(id, {
        status: "completed", actual_output: qty,
        actual_cost_per_unit: actualCPU, total_material_cost: Math.round(actualCost)
      });

      await base44.entities.AuditLog.create({
        action: "complete_production", module: "manufacturing", entity_type: "ProductionOrder", entity_id: id,
        description: `Completed ${order.order_number}: ${qty} units at ${formatXAF(actualCPU)}/unit`
      });

      toast({ title: "Production completed", description: `${qty} units produced at ${formatXAF(actualCPU)} per unit` });
      loadOrder();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? `Production Order ${order?.order_number || ""}` : "New Production Order"}
        subtitle={isEdit && order ? <StatusBadge status={order.status} /> : null}
        actions={
          <div className="flex gap-2">
            {isEdit && order?.status === "draft" && <Button variant="outline" onClick={() => base44.entities.ProductionOrder.update(id, { status: "approved" }).then(loadOrder)}><CheckCircle size={16} className="mr-1" /> Approve</Button>}
            {isEdit && order?.status === "approved" && <Button variant="outline" onClick={handleIssueMaterials}><Play size={16} className="mr-1" /> Issue Materials</Button>}
            {isEdit && order?.status === "materials_issued" && <Button onClick={handleComplete}><PackageCheck size={16} className="mr-1" /> Complete Production</Button>}
            <Button variant="outline" onClick={() => navigate("/manufacturing")}><ArrowLeft size={16} className="mr-1" /> Back</Button>
          </div>
        }
      />
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div>
            <Label>Recipe *</Label>
            <Select value={form.recipe_id} onValueChange={handleRecipeChange}>
              <SelectTrigger><SelectValue placeholder="Select approved recipe" /></SelectTrigger>
              <SelectContent>{recipes.map(r => <SelectItem key={r.id} value={r.id}>{r.recipe_name} (v{r.version})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Planned Output *</Label>
            <Input type="number" value={form.planned_output} onChange={e => handleOutputChange(e.target.value)} />
          </div>
          <div>
            <Label>Production Date</Label>
            <Input type="date" value={form.production_date} onChange={e => setForm(f => ({ ...f, production_date: e.target.value }))} />
          </div>
          <div>
            <Label>Warehouse</Label>
            <Select value={form.warehouse_id} onValueChange={v => setForm(f => ({ ...f, warehouse_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {materials.length > 0 && (
          <div className="mb-6">
            <h3 className="font-semibold text-slate-900 mb-3">Required Materials (auto-calculated)</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-600">
                  <th className="pb-2">Material</th>
                  <th className="pb-2 text-right">Required Qty</th>
                  <th className="pb-2">Unit</th>
                  <th className="pb-2 text-right">Unit Cost</th>
                  <th className="pb-2 text-right">Total Cost</th>
                  {isEdit && <th className="pb-2 text-right">Issued</th>}
                  {isEdit && <th className="pb-2 text-right">Consumed</th>}
                </tr>
              </thead>
              <tbody>
                {materials.map((m, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 font-medium">{m.material_name}</td>
                    <td className="py-2 text-right">{formatNumber(m.standard_quantity, 3)}</td>
                    <td className="py-2">{m.unit}</td>
                    <td className="py-2 text-right">{formatXAF(m.unit_cost)}</td>
                    <td className="py-2 text-right">{formatXAF(m.standard_quantity * m.unit_cost)}</td>
                    {isEdit && <td className="py-2 text-right">{formatNumber(m.issued_quantity || 0, 3)}</td>}
                    {isEdit && <td className="py-2 text-right">{formatNumber(m.consumed_quantity || 0, 3)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td colSpan={4} className="py-2">Total Standard Material Cost</td>
                  <td className="py-2 text-right">{formatXAF(standardCost)}</td>
                  {isEdit && <td colSpan={2}></td>}
                </tr>
                <tr>
                  <td colSpan={4} className="py-1 text-slate-600">Standard Cost per Unit</td>
                  <td className="py-1 text-right font-semibold text-blue-700">{formatXAF(costPerUnit)}</td>
                  {isEdit && <td colSpan={2}></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {isEdit && order?.actual_output > 0 && (
          <div className="bg-green-50 rounded-lg p-4 mb-4">
            <h4 className="font-semibold text-green-900 mb-2">Production Results</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div><span className="text-green-700">Actual Output:</span> <strong>{order.actual_output}</strong></div>
              <div><span className="text-green-700">Actual Cost/Unit:</span> <strong>{formatXAF(order.actual_cost_per_unit)}</strong></div>
              <div><span className="text-green-700">Total Cost:</span> <strong>{formatXAF(order.total_material_cost)}</strong></div>
              <div><span className="text-green-700">Yield:</span> <strong>{formatNumber(order.actual_output / order.planned_output * 100, 1)}%</strong></div>
            </div>
          </div>
        )}

        {!isEdit && (
          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Saving..." : "Create Order"}</Button>
          </div>
        )}
      </div>
    </div>
  );
}