import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF, formatDate } from "@/lib/formatters";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Save, ArrowLeft } from "lucide-react";

export default function CustomerForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isEdit = !!id;

  const [form, setForm] = useState({
    business_name: "", contact_person: "", phone: "", whatsapp: "", email: "",
    category: "shop", financial_centralization_mode: "centralized", address: "", town: "", neighbourhood: "",
    credit_limit: 0, max_overdue_days: 30, payment_terms_days: 0,
    parent_id: "", parent_name: "",
    is_active: true, notes: ""
  });
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [mainPartners, setMainPartners] = useState([]);
  const [partnerType, setPartnerType] = useState("main");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.Customer
      .filter({ $or: [{ parent_id: { $exists: false } }, { parent_id: "" }] }, { sort: "business_name", limit: 200 })
      .then(res => setMainPartners(res.items));
    if (isEdit) {
      base44.entities.Customer.get(id).then(c => {
        setForm({
          business_name: c.business_name || "", contact_person: c.contact_person || "",
          phone: c.phone || "", whatsapp: c.whatsapp || "", email: c.email || "",
          category: c.category || "shop", financial_centralization_mode: c.financial_centralization_mode || "centralized",
          address: c.address || "", town: c.town || "",
          neighbourhood: c.neighbourhood || "", credit_limit: c.credit_limit || 0,
          max_overdue_days: c.max_overdue_days || 30, payment_terms_days: c.payment_terms_days || 0,
          parent_id: c.parent_id || "", parent_name: c.parent_name || "",
          is_active: c.is_active !== false, notes: c.notes || ""
        });
        setPartnerType(c.parent_id ? "branch" : "main");
      });
      base44.entities.Invoice.filter({ customer_id: id }).then(setInvoices);
      base44.entities.Payment.filter({ party_id: id, payment_type: "customer_payment" }).then(setPayments);
    } else {
      const parent = new URLSearchParams(window.location.search).get("parent");
      if (parent) {
        setForm(f => ({ ...f, parent_id: parent }));
        setPartnerType("branch");
      }
    }
  }, [id, isEdit]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.business_name) {
      toast({ title: "Error", description: "Business name is required", variant: "destructive" });
      return;
    }
    if (partnerType === "branch" && !form.parent_id) {
      toast({ title: "Error", description: "Choose the main partner this branch belongs to", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const parentId = partnerType === "branch" ? form.parent_id : "";
      const payload = {
        ...form,
        parent_id: parentId,
        parent_name: parentId ? mainPartners.find(c => c.id === parentId)?.business_name || "" : "",
      };
      if (isEdit) {
        await base44.entities.Customer.update(id, payload);
      } else {
        const count = (await base44.entities.Customer.filter({})).length;
        await base44.entities.Customer.create({ ...payload, customer_number: `C-${String(count + 1).padStart(4, "0")}` });
      }
      toast({ title: "Saved" });
      navigate("/customers");
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  const invCols = [
    { key: "invoice_number", label: "Invoice #" },
    { key: "invoice_date", label: "Date", render: v => formatDate(v) },
    { key: "total", label: "Total", render: v => formatXAF(v), className: "text-right" },
    { key: "balance", label: "Balance", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  const pmtCols = [
    { key: "payment_number", label: "Payment #" },
    { key: "payment_date", label: "Date", render: v => formatDate(v) },
    { key: "amount", label: "Amount", render: v => formatXAF(v), className: "text-right" },
    { key: "payment_method", label: "Method" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  return (
    <div>
      <PageHeader
        title={isEdit ? `Partner: ${form.business_name}` : "Add Partner"}
        actions={<Button variant="outline" onClick={() => navigate("/customers")}><ArrowLeft size={16} className="mr-1" /> Back</Button>}
      />
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          {isEdit && <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>}
          {isEdit && <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>}
        </TabsList>
        <TabsContent value="details" className="mt-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-3xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Business Name *</Label>
                <Input value={form.business_name} onChange={e => set("business_name", e.target.value)} />
              </div>
              <div>
                <Label>Contact Person</Label>
                <Input value={form.contact_person} onChange={e => set("contact_person", e.target.value)} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => set("phone", e.target.value)} />
              </div>
              <div>
                <Label>WhatsApp</Label>
                <Input value={form.whatsapp} onChange={e => set("whatsapp", e.target.value)} />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} />
              </div>
              <div>
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => set("category", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["supermarket", "minimarket", "wholesaler", "shop", "cash_customer", "institutional"].map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>Payment Organization</Label>
                <Select value={form.financial_centralization_mode} onValueChange={v => set("financial_centralization_mode", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="centralized">Centralized — headquarters pays for all branches</SelectItem>
                    <SelectItem value="decentralized">Decentralized — each branch pays its own invoices</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Partner Type</Label>
                <Select value={partnerType} onValueChange={setPartnerType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">Main partner — brand or headquarters</SelectItem>
                    <SelectItem value="branch">Branch — sub-partner of a main partner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {partnerType === "branch" ? (
                <div>
                  <Label>Main Partner *</Label>
                  <Select value={form.parent_id} onValueChange={v => set("parent_id", v)}>
                    <SelectTrigger><SelectValue placeholder="Choose the main partner" /></SelectTrigger>
                    <SelectContent>
                      {mainPartners.map(c => <SelectItem key={c.id} value={c.id}>{c.business_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="flex items-end pb-2">
                  <p className="text-xs text-slate-500">Main partners group branches under one name — add a branch with the same Add Partner button.</p>
                </div>
              )}
              <div className="sm:col-span-2">
                <Label>Address</Label>
                <Input value={form.address} onChange={e => set("address", e.target.value)} />
              </div>
              <div>
                <Label>Town</Label>
                <Input value={form.town} onChange={e => set("town", e.target.value)} />
              </div>
              <div>
                <Label>Neighbourhood</Label>
                <Input value={form.neighbourhood} onChange={e => set("neighbourhood", e.target.value)} />
              </div>
              <div>
                <Label>Credit Limit (XAF)</Label>
                <Input type="number" value={form.credit_limit} onChange={e => set("credit_limit", Number(e.target.value))} />
              </div>
              <div>
                <Label>Payment Terms (days)</Label>
                <Input type="number" value={form.payment_terms_days} onChange={e => set("payment_terms_days", Number(e.target.value))} />
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <Button onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Saving..." : "Save"}</Button>
            </div>
          </div>
        </TabsContent>
        {isEdit && (
          <TabsContent value="invoices" className="mt-4">
            <DataTable columns={invCols} data={invoices} searchFields={["invoice_number"]} />
          </TabsContent>
        )}
        {isEdit && (
          <TabsContent value="payments" className="mt-4">
            <DataTable columns={pmtCols} data={payments} searchFields={["payment_number"]} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}