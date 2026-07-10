import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF } from "@/lib/formatters";
import { Save, ArrowLeft } from "lucide-react";

export default function GoodsReceiptForm() {
  const { id: poId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [po, setPo] = useState(null);
  const [poLines, setPoLines] = useState([]);
  const [receiptLines, setReceiptLines] = useState([]);
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().split("T")[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadPO(); }, [poId]);

  async function loadPO() {
    const order = await base44.entities.PurchaseOrder.get(poId);
    setPo(order);
    const lines = await base44.entities.PurchaseOrderLine.filter({ po_id: poId });
    setPoLines(lines);
    setReceiptLines(lines.map(l => ({
      po_line_id: l.id, product_id: l.product_id, product_name: l.product_name,
      ordered_quantity: l.quantity, received_quantity: l.quantity - (l.received_quantity || 0),
      rejected_quantity: 0, damaged_quantity: 0, unit_cost: l.unit_price,
      lot_number: "", expiry_date: ""
    })));
  }

  function updateRL(i, field, value) {
    setReceiptLines(prev => {
      const arr = [...prev];
      arr[i] = { ...arr[i], [field]: value };
      return arr;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const receipt = await base44.entities.GoodsReceipt.create({
        receipt_number: `GR-${Date.now()}`, po_id: poId, supplier_id: po.supplier_id,
        supplier_name: po.supplier_name, warehouse_id: po.warehouse_id,
        receipt_date: receiptDate, status: "confirmed"
      });

      for (const rl of receiptLines) {
        const qty = Number(rl.received_quantity) || 0;
        if (qty <= 0) continue;

        await base44.entities.GoodsReceiptLine.create({
          receipt_id: receipt.id, po_line_id: rl.po_line_id, product_id: rl.product_id,
          product_name: rl.product_name, ordered_quantity: rl.ordered_quantity,
          received_quantity: qty, rejected_quantity: Number(rl.rejected_quantity) || 0,
          damaged_quantity: Number(rl.damaged_quantity) || 0, unit_cost: Number(rl.unit_cost),
          lot_number: rl.lot_number, expiry_date: rl.expiry_date || undefined
        });

        // Create stock movement (immutable ledger entry)
        const totalValue = Math.round(qty * Number(rl.unit_cost));
        await base44.entities.StockMovement.create({
          product_id: rl.product_id, product_name: rl.product_name, quantity: qty,
          movement_type: "purchase_receipt", destination_warehouse_id: po.warehouse_id,
          lot_number: rl.lot_number, expiry_date: rl.expiry_date || undefined,
          unit_cost: Number(rl.unit_cost), total_value: totalValue,
          document_type: "GoodsReceipt", document_id: receipt.id,
          movement_date: receiptDate
        });

        // Update or create stock balance
        const existing = await base44.entities.StockBalance.filter({
          product_id: rl.product_id, warehouse_id: po.warehouse_id, lot_number: rl.lot_number || ""
        });
        if (existing.length > 0) {
          const bal = existing[0];
          const newQty = (bal.quantity || 0) + qty;
          const newVal = (bal.total_value || 0) + totalValue;
          await base44.entities.StockBalance.update(bal.id, {
            quantity: newQty, total_value: newVal,
            unit_cost: newQty > 0 ? Math.round(newVal / newQty) : 0
          });
        } else {
          const product = await base44.entities.Product.get(rl.product_id);
          const wh = await base44.entities.Warehouse.get(po.warehouse_id);
          await base44.entities.StockBalance.create({
            product_id: rl.product_id, product_name: rl.product_name,
            warehouse_id: po.warehouse_id, warehouse_name: wh?.name || "",
            lot_number: rl.lot_number || "", expiry_date: rl.expiry_date || undefined,
            quantity: qty, unit_cost: Number(rl.unit_cost), total_value: totalValue
          });
        }

        // Update product average cost
        const allBalances = await base44.entities.StockBalance.filter({ product_id: rl.product_id });
        const totalQty = allBalances.reduce((s, b) => s + (b.quantity || 0), 0);
        const totalVal = allBalances.reduce((s, b) => s + (b.total_value || 0), 0);
        await base44.entities.Product.update(rl.product_id, {
          current_cost: totalQty > 0 ? Math.round(totalVal / totalQty) : Number(rl.unit_cost)
        });

        // Update PO line received quantity
        const poLine = poLines.find(l => l.id === rl.po_line_id);
        if (poLine) {
          await base44.entities.PurchaseOrderLine.update(poLine.id, {
            received_quantity: (poLine.received_quantity || 0) + qty
          });
        }
      }

      // Create accounting journal: Debit Inventory, Credit Supplier Payable
      const totalReceived = receiptLines.reduce((s, rl) => s + Math.round((Number(rl.received_quantity) || 0) * Number(rl.unit_cost)), 0);
      if (totalReceived > 0) {
        const accounts = await base44.entities.Account.filter({});
        const invAccount = accounts.find(a => a.account_number === "1310");
        const payableAccount = accounts.find(a => a.account_number === "4010");

        if (invAccount && payableAccount) {
          const settings = (await base44.entities.CompanySettings.filter({}))[0];
          const jNum = settings?.next_journal_number || 1;
          const journal = await base44.entities.JournalEntry.create({
            journal_number: `JE-${String(jNum).padStart(5, "0")}`,
            entry_date: receiptDate, description: `Goods receipt for ${po.po_number}`,
            source_module: "procurement", source_document_type: "GoodsReceipt",
            source_document_id: receipt.id, status: "posted",
            total_debit: totalReceived, total_credit: totalReceived, is_immutable: true,
            posted_at: new Date().toISOString()
          });
          if (settings) await base44.entities.CompanySettings.update(settings.id, { next_journal_number: jNum + 1 });

          await base44.entities.JournalLine.create({
            journal_id: journal.id, account_id: invAccount.id,
            account_number: invAccount.account_number, account_name: invAccount.name,
            debit: totalReceived, credit: 0, description: "Inventory received"
          });
          await base44.entities.JournalLine.create({
            journal_id: journal.id, account_id: payableAccount.id,
            account_number: payableAccount.account_number, account_name: payableAccount.name,
            debit: 0, credit: totalReceived, description: `Payable to ${po.supplier_name}`,
            party_type: "supplier", party_id: po.supplier_id
          });

          // Update account balances
          await base44.entities.Account.update(invAccount.id, { balance: (invAccount.balance || 0) + totalReceived });
          await base44.entities.Account.update(payableAccount.id, { balance: (payableAccount.balance || 0) + totalReceived });
        }

        // Update supplier balance
        const supplier = await base44.entities.Supplier.get(po.supplier_id);
        if (supplier) await base44.entities.Supplier.update(supplier.id, { balance: (supplier.balance || 0) + totalReceived });
      }

      // Update PO status
      const allReceived = receiptLines.every(rl => (Number(rl.received_quantity) || 0) >= rl.ordered_quantity);
      await base44.entities.PurchaseOrder.update(poId, { status: allReceived ? "received" : "partially_received" });

      await base44.entities.AuditLog.create({
        action: "goods_receipt", module: "procurement", entity_type: "GoodsReceipt",
        entity_id: receipt.id, description: `Received goods for ${po.po_number}. Total: ${formatXAF(totalReceived)}`
      });

      toast({ title: "Received", description: "Goods receipt confirmed. Inventory and accounting updated." });
      navigate("/purchases");
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  if (!po) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title={`Receive Goods — ${po.po_number}`}
        subtitle={`Supplier: ${po.supplier_name}`}
        actions={<Button variant="outline" onClick={() => navigate(`/purchases/${poId}`)}><ArrowLeft size={16} className="mr-1" /> Back to PO</Button>}
      />
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl">
        <div className="mb-4">
          <Label>Receipt Date</Label>
          <Input type="date" className="max-w-xs" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
        </div>
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b text-left text-slate-600">
              <th className="pb-2">Product</th>
              <th className="pb-2 w-20">Ordered</th>
              <th className="pb-2 w-24">Receiving</th>
              <th className="pb-2 w-20">Rejected</th>
              <th className="pb-2 w-28">Unit Cost</th>
              <th className="pb-2 w-32">Lot #</th>
              <th className="pb-2 w-32">Expiry</th>
            </tr>
          </thead>
          <tbody>
            {receiptLines.map((rl, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2 font-medium">{rl.product_name}</td>
                <td className="py-2">{rl.ordered_quantity}</td>
                <td className="py-2"><Input type="number" className="h-9" value={rl.received_quantity} onChange={e => updateRL(i, "received_quantity", e.target.value)} /></td>
                <td className="py-2"><Input type="number" className="h-9" value={rl.rejected_quantity} onChange={e => updateRL(i, "rejected_quantity", e.target.value)} /></td>
                <td className="py-2"><Input type="number" className="h-9" value={rl.unit_cost} onChange={e => updateRL(i, "unit_cost", e.target.value)} /></td>
                <td className="py-2"><Input className="h-9" value={rl.lot_number} onChange={e => updateRL(i, "lot_number", e.target.value)} placeholder="LOT-XXX" /></td>
                <td className="py-2"><Input type="date" className="h-9" value={rl.expiry_date} onChange={e => updateRL(i, "expiry_date", e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Processing..." : "Confirm Receipt"}</Button>
          <Button variant="outline" onClick={() => navigate(`/purchases/${poId}`)}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}