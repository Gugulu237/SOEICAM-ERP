import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Save } from "lucide-react";

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", contact_person: "", phone: "", email: "", address: "", city: "", category: "", payment_terms_days: 30 });
  const { toast } = useToast();

  useEffect(() => { loadData(); }, []);
  async function loadData() { base44.entities.Supplier.filter({}).then(setSuppliers).finally(() => setLoading(false)); }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.name) return;
    const count = suppliers.length;
    await base44.entities.Supplier.create({ ...form, supplier_number: `S-${String(count + 1).padStart(4, "0")}` });
    toast({ title: "Supplier created" });
    setShowForm(false);
    setForm({ name: "", contact_person: "", phone: "", email: "", address: "", city: "", category: "", payment_terms_days: 30 });
    loadData();
  }

  const cols = [
    { key: "supplier_number", label: "#" },
    { key: "name", label: "Name" },
    { key: "contact_person", label: "Contact" },
    { key: "phone", label: "Phone" },
    { key: "category", label: "Category" },
    { key: "balance", label: "Payable", render: v => formatXAF(v), className: "text-right" },
    { key: "is_active", label: "Status", render: v => <StatusBadge status={v ? "active" : "inactive"} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="Suppliers" subtitle={`${suppliers.length} suppliers · ${formatXAF(suppliers.reduce((s, x) => s + (x.balance || 0), 0))} total payables`} actions={<Button onClick={() => setShowForm(true)}><Plus size={16} className="mr-1" /> New Supplier</Button>} />
      <DataTable columns={cols} data={suppliers} searchFields={["name", "contact_person", "phone"]} />
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Supplier</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Name *</Label><Input value={form.name} onChange={e => set("name", e.target.value)} /></div>
            <div><Label>Contact</Label><Input value={form.contact_person} onChange={e => set("contact_person", e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={e => set("phone", e.target.value)} /></div>
            <div><Label>Email</Label><Input value={form.email} onChange={e => set("email", e.target.value)} /></div>
            <div><Label>Category</Label><Input value={form.category} onChange={e => set("category", e.target.value)} placeholder="e.g. Dairy, Packaging" /></div>
            <div><Label>City</Label><Input value={form.city} onChange={e => set("city", e.target.value)} /></div>
            <div><Label>Payment Terms (days)</Label><Input type="number" value={form.payment_terms_days} onChange={e => set("payment_terms_days", Number(e.target.value))} /></div>
          </div>
          <Button className="mt-4" onClick={handleSave}><Save size={16} className="mr-1" /> Save Supplier</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}