
/* localized-interface */
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useRef } from "react";
import { erp } from "@/api/erpClient";
import { Navigate, useBack, useNavigate, useParams } from "@/lib/router";
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
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { readAll } from '@/lib/field-pos';
import DeliverySetupFields from '@/components/customers/DeliverySetupFields';

export default function CustomerForm() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { id } = useParams();
  const navigate = useNavigate(), goBack = useBack('/customers');
  const { toast } = useToast();
  const isEdit = !!id;
  const { isAdmin, role, loading: authLoading } = useCurrentUser();
  const requestKey = useRef(crypto.randomUUID()), submitting = useRef(false);
  const [agents, setAgents] = useState([]), [acquiredById, setAcquiredById] = useState(''), [acquisition, setAcquisition] = useState(null);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [saveError, setSaveError] = useState(''), [reload, setReload] = useState(0);

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
  const [locating,setLocating]=useState(false);

  useEffect(() => {
    if (authLoading || role==='commercial') return;
    let active = true;
    setLoading(true); setLoadError('');
    Promise.all([
      readAll(erp.entities.Customer, { $or: [{ parent_id: { $exists: false } }, { parent_id: "" }] }, 'business_name'),
      isEdit ? erp.entities.Customer.get(id) : null,
      isEdit ? readAll(erp.entities.Invoice, { customer_id: id }) : [],
      isEdit ? readAll(erp.entities.Payment, { party_id: id, payment_type: 'customer_payment' }) : [],
      !isEdit && isAdmin ? invokeFieldOps({ action: 'customerAcquisitionOptions' }).then(({ data }) => { if (data.error) throw Error(data.error); return data.employees; }) : [],
    ]).then(([parents, customer, invoiceRows, paymentRows, staff]) => {
      if (!active) return;
      setMainPartners(parents); setAgents(staff); setInvoices(invoiceRows); setPayments(paymentRows);
      if (isEdit) {
        if (!customer) throw Error(ui('Customer not found'));
        const c = customer;
        setForm({
          business_name: c.business_name || '', contact_person: c.contact_person || '', phone: c.phone || '', whatsapp: c.whatsapp || '', email: c.email || '',
          category: c.category || 'shop', financial_centralization_mode: c.financial_centralization_mode || 'centralized',
          address: c.address || '', town: c.town || '', neighbourhood: c.neighbourhood || '', credit_limit: c.credit_limit || 0,
          max_overdue_days: c.max_overdue_days ?? 30, payment_terms_days: c.payment_terms_days || 0,
          parent_id: c.parent_id || '', parent_name: c.parent_name || '', is_active: c.is_active !== false, notes: c.notes || '',
          delivery_zone_id: c.delivery_zone_id || '', delivery_days: c.delivery_days || '', delivery_instructions: c.delivery_instructions || '',
          gps_lat: c.gps_lat, gps_lng: c.gps_lng, gps_accuracy_m: c.gps_accuracy_m, gps_captured_at: c.gps_captured_at,
        });
        setPartnerType(c.parent_id ? 'branch' : 'main');
        setAcquisition({ name: c.acquired_by_name || '', status: c.acquisition_verified || 'pending', registrar: c.registered_by_name || '', date: c.acquisition_date || '' });
      } else {
        const parent = new URLSearchParams(window.location.search).get('parent');
        if (parent) { setForm(f => ({ ...f, parent_id: parent })); setPartnerType('branch'); }
      }
    }).catch(failure => { if (active) setLoadError(errorMessage(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, isEdit, isAdmin, authLoading, role, reload]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (locating || loading || loadError || submitting.current) return;
    if (!form.business_name) {
      toast({ title: ui("Error"), description: ui("Business name is required"), variant: "destructive" });
      return;
    }
    if (partnerType === "branch" && !form.parent_id) {
      toast({ title: ui("Error"), description: ui("Choose the main partner this branch belongs to"), variant: "destructive" });
      return;
    }
    submitting.current = true; setSaving(true); setSaveError('');
    try {
      const parentId = partnerType === "branch" ? form.parent_id : "";
      const payload = {
        ...form,
        parent_id: parentId,
        parent_name: parentId ? mainPartners.find(c => c.id === parentId)?.business_name || "" : "",
      };
      if (isEdit) {
        await erp.entities.Customer.update(id, payload);
      } else if (isAdmin) {
        const { parent_name: _parentName, ...customer } = payload; void _parentName;
        const { data } = await invokeFieldOps({ action: 'registerManagedCustomer', customer, acquiredById, requestKey: requestKey.current });
        if (data.error) throw Error(data.error);
      } else {
        const count = (await erp.entities.Customer.filter({})).length;
        await erp.entities.Customer.create({ ...payload, customer_number: `C-${String(count + 1).padStart(4, "0")}` });
      }
      toast({ title: ui("Saved") });
      navigate("/customers");
    } catch (e) {
      setSaveError(errorMessage(e));
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    submitting.current = false; setSaving(false);
  }

  const invCols = [
    { key: "invoice_number", label: ui("Invoice #") },
    { key: "invoice_date", label: ui("Date"), render: v => formatDate(v) },
    { key: "total", label: ui("Total"), render: v => formatXAF(v), className: "text-right" },
    { key: "balance", label: ui("Balance"), render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: ui("Status"), render: v => <StatusBadge status={v} /> },
  ];

  const pmtCols = [
    { key: "payment_number", label: ui("Payment #") },
    { key: "payment_date", label: ui("Date"), render: v => formatDate(v) },
    { key: "amount", label: ui("Amount"), render: v => formatXAF(v), className: "text-right" },
    { key: "payment_method", label: ui("Method") },
    { key: "status", label: ui("Status"), render: v => <StatusBadge status={v} /> },
  ];

  if(role==='commercial')return <Navigate to={'/customers?'+(isEdit?'customer='+encodeURIComponent(id):'new=1')} replace/>;
  return (
    <div>
      <PageHeader
        title={isEdit ? `Partner: ${form.business_name}` : ui("Add Partner")}
        actions={<Button variant="outline" disabled={saving} onClick={goBack}><ArrowLeft size={16} className="mr-1" />{ui(" Back")}</Button>}
      />
      {loading && <p role="status" className="mb-4 text-sm text-slate-500">{ui("Loading customer setup...")}</p>}
      {loadError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(loadError)} <button className="underline" onClick={() => setReload(value => value + 1)}>{ui("Retry")}</button></p>}
      <fieldset disabled={loading || saving || !!loadError}>
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">{ui("Details")}</TabsTrigger>
          {isEdit && <TabsTrigger value="invoices">{ui("Invoices (")}{invoices.length})</TabsTrigger>}
          {isEdit && <TabsTrigger value="payments">{ui("Payments (")}{payments.length})</TabsTrigger>}
        </TabsList>
        <TabsContent value="details" className="mt-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-3xl">
            {!isEdit && isAdmin && <section className="mb-5 space-y-2 rounded-xl border bg-slate-50 p-4"><label htmlFor="customer-acquired-by" className="block text-sm font-medium">{ui("Acquired by (employee)")}</label><select id="customer-acquired-by" value={acquiredById} onChange={event => setAcquiredById(event.target.value)} className="h-11 w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui("No employee acquisition credit")}</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select><p className="text-xs leading-5 text-slate-600">{ui("Select the Commercial employee who found this customer. Their acquisition and configured commission are tracked on their account after verification. Your administrator account remains the registrar.")}</p>{acquiredById && <p className="text-xs text-slate-800">{ui("The new acquisition will await GM verification before its customer bonus counts. This does not create a salary payment.")}</p>}</section>}
            {isEdit && acquisition?.name && <section className="mb-5 rounded-xl border bg-slate-50 p-4 text-sm"><p>{ui("Acquired by ")}<strong>{acquisition.name}</strong> / {acquisition.date}</p><p className="mt-1 text-xs text-slate-500">{ui("Acquisition: ")}{acquisition.status.replaceAll('_', ' ')}</p>{acquisition.registrar && <p className="mt-1 text-xs text-slate-500">{ui("Registered by ")}{acquisition.registrar}</p>}<p className="mt-2 text-xs text-slate-500">{ui("Acquisition history is preserved. Verify customer acquisitions in Customers, Acquisition review.")}</p></section>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>{ui("Business Name *")}</Label>
                <Input value={form.business_name} onChange={e => set("business_name", e.target.value)} />
              </div>
              <div>
                <Label>{ui("Contact Person")}</Label>
                <Input value={form.contact_person} onChange={e => set("contact_person", e.target.value)} />
              </div>
              <div>
                <Label>{ui("Phone")}</Label>
                <Input value={form.phone} onChange={e => set("phone", e.target.value)} />
              </div>
              <div>
                <Label>{ui("WhatsApp")}</Label>
                <Input value={form.whatsapp} onChange={e => set("whatsapp", e.target.value)} />
              </div>
              <div>
                <Label>{ui("Email")}</Label>
                <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} />
              </div>
              <div>
                <Label>{ui("Category")}</Label>
                <Select value={form.category} onValueChange={v => set("category", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["supermarket", "minimarket", "wholesaler", "shop", "cash_customer", "institutional"].map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>{ui("Payment Organization")}</Label>
                <Select value={form.financial_centralization_mode} onValueChange={v => set("financial_centralization_mode", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="centralized">{ui("Centralized — headquarters pays for all branches")}</SelectItem>
                    <SelectItem value="decentralized">{ui("Decentralized — each branch pays its own invoices")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{ui("Partner Type")}</Label>
                <Select value={partnerType} onValueChange={setPartnerType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">{ui("Main partner — brand or headquarters")}</SelectItem>
                    <SelectItem value="branch">{ui("Branch — sub-partner of a main partner")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {partnerType === "branch" ? (
                <div>
                  <Label>{ui("Main Partner *")}</Label>
                  <Select value={form.parent_id} onValueChange={v => set("parent_id", v)}>
                    <SelectTrigger><SelectValue placeholder={ui("Choose the main partner")} /></SelectTrigger>
                    <SelectContent>
                      {mainPartners.map(c => <SelectItem key={c.id} value={c.id}>{c.business_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="flex items-end pb-2">
                  <p className="text-xs text-slate-500">{ui("Main partners group branches under one name — add a branch with the same Add Partner button.")}</p>
                </div>
              )}
              <div className="sm:col-span-2">
                <Label>{ui("Address")}</Label>
                <Input value={form.address} onChange={e => set("address", e.target.value)} />
              </div>
              <div>
                <Label>{ui("Town")}</Label>
                <Input value={form.town} onChange={e => set("town", e.target.value)} />
              </div>
              <div>
                <Label>{ui("Neighbourhood")}</Label>
                <Input value={form.neighbourhood} onChange={e => set("neighbourhood", e.target.value)} />
              </div>
              <div>
                <Label>{ui("Credit Limit (XAF)")}</Label>
                <Input type="number" value={form.credit_limit} onChange={e => set("credit_limit", Number(e.target.value))} />
              </div>
              <div>
                <Label>{ui("Payment Terms (days)")}</Label>
                <Input type="number" value={form.payment_terms_days} onChange={e => set("payment_terms_days", Number(e.target.value))} />
              </div>
            </div>
            <div className="mt-5"><DeliverySetupFields value={form} onChange={changes=>setForm(f=>({...f,...changes}))} disabled={saving} onBusyChange={setLocating}/></div>
            {saveError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(saveError)}</p>}
            <div className="mt-6 flex gap-3">
              <Button onClick={handleSave} disabled={saving || locating || loading || !!loadError}><Save size={16} className="mr-1" /> {saving ? ui("Saving...") : ui("Save")}</Button>
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
      </fieldset>
    </div>
  );
}
