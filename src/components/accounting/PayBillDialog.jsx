import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF } from "@/lib/formatters";
import { recordSupplierPayment } from "@/lib/ar-ap";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import AllocationEditor from "@/components/accounting/AllocationEditor";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

export default function PayBillDialog({ supplierId, onClose, onPaid }) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [supplier, setSupplier] = useState(null);
  const [openBills, setOpenBills] = useState([]);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [allocations, setAllocations] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.Supplier.get(supplierId),
      base44.entities.Bill.filter({ supplier_id: supplierId }),
    ]).then(([s, bills]) => {
      setSupplier(s);
      setOpenBills(bills.filter((b) => (b.balance || 0) > 0 && b.status !== "cancelled")
        .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || "")));
    });
  }, [supplierId]);

  async function handlePay() {
    setSaving(true);
    try {
      const payment = await recordSupplierPayment({
        supplier, amount: Number(amount), paymentDate, method, reference,
        allocations, openBills, userId: user?.id || "",
      });
      toast({ title: "Supplier paid", description: `${payment.payment_number} — ${formatXAF(Number(amount))} to ${supplier.name}` });
      onPaid();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Pay Supplier — {supplier?.name || "…"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Amount (XAF)</Label>
              <Input type="number" min="0" value={amount || ""} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
            <div>
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="mobile_money">Mobile Money</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer / cheque no." />
            </div>
          </div>
          <AllocationEditor
            docs={openBills.map((b) => ({ id: b.id, number: b.bill_number, date: b.bill_date, due_date: b.due_date, balance: b.balance }))}
            allocations={allocations} onChange={setAllocations} amount={amount}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !supplier || Number(amount) <= 0} onClick={handlePay}>Record Payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}