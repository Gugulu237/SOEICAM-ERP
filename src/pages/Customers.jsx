import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import ViewToggle from "@/components/shared/ViewToggle";
import PartnerTree from "@/components/customers/PartnerTree";
import PartnerDetail from "@/components/customers/PartnerDetail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Building2, Network, Table2 } from "lucide-react";

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("visual");
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const [cs, ls] = await Promise.all([
      base44.entities.Customer.filter({}),
      base44.entities.CustomerLocation.filter({ is_active: true }),
    ]);
    setCustomers(cs);
    setLocations(ls);
    setSelected(sel => sel ? cs.find(c => c.id === sel.id) || null : null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const locationsByCustomer = locations.reduce((acc, l) => {
    (acc[l.customer_id] = acc[l.customer_id] || []).push(l);
    return acc;
  }, {});

  const cols = [
    { key: "customer_number", label: "#" },
    { key: "business_name", label: "Business Name" },
    { key: "id", label: "Locations", render: (v) => (locationsByCustomer[v] || []).length },
    { key: "contact_person", label: "Contact" },
    { key: "phone", label: "Phone" },
    { key: "category", label: "Category", render: v => <StatusBadge status={v} /> },
    { key: "balance", label: "Balance", render: v => formatXAF(v), className: "text-right" },
    { key: "credit_status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Business Partners"
        subtitle={`${customers.length} partners · ${locations.length} delivery locations · ${formatXAF(customers.reduce((s, c) => s + (c.balance || 0), 0))} total receivables`}
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle
              value={view}
              onChange={setView}
              options={[
                { value: "visual", label: "Explorer", icon: Network },
                { value: "table", label: "Table", icon: Table2 },
              ]}
            />
            <Button onClick={() => navigate("/customers/new")}><Plus size={16} className="mr-1" /> New Partner</Button>
          </div>
        }
      />

      {view === "table" ? (
        <DataTable columns={cols} data={customers} searchFields={["business_name", "contact_person", "phone", "customer_number"]} onRowClick={row => { setSelected(row); setView("visual"); }} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-3 h-fit lg:sticky lg:top-4">
            <Input
              placeholder="Search partners or branches…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="mb-3"
            />
            <div className="max-h-[70vh] overflow-y-auto">
              <PartnerTree
                partners={customers}
                locationsByCustomer={locationsByCustomer}
                selectedId={selected?.id}
                onSelect={setSelected}
                search={search}
              />
            </div>
          </div>
          <div>
            {selected ? (
              <PartnerDetail partner={selected} onChanged={load} />
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-24 text-slate-400 bg-slate-50 rounded-xl">
                <Building2 size={36} className="mb-3" />
                <p className="font-medium text-slate-500">Select a business partner</p>
                <p className="text-sm">See its locations, deliveries and spoilage at a glance.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}