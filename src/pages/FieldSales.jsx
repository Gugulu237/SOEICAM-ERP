import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/shared/PageHeader";
import StatusPill from "@/components/field/StatusPill";
import HandoverSubmitDialog from "@/components/field/HandoverSubmitDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { SALE_STATUS, COLLECTION_STATUS } from "@/lib/field-ops";
import { formatXAF, formatDate } from "@/lib/formatters";
import { Plus, Loader2 } from "lucide-react";

export default function FieldSales() {
  const { user, employee, loading: authLoading } = useCurrentUser();
  const navigate = useNavigate();
  const [stock, setStock] = useState([]);
  const [sales, setSales] = useState([]);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [handoverOpen, setHandoverOpen] = useState(false);

  const load = async () => {
    if (!employee) { setLoading(false); return; }
    setLoading(true);
    const warehouses = await base44.entities.Warehouse.filter({
      warehouse_type: "commercial_custody",
      custodian_employee_id: employee.id,
    });
    const warehouse = warehouses[0];
    const [balances, mySales, myCash] = await Promise.all([
      warehouse
        ? base44.entities.StockBalance.filter({ warehouse_id: warehouse.id }, { sort: "-created_date", limit: 200 })
        : Promise.resolve({ items: [] }),
      base44.entities.FieldSale.filter({ commercial_id: employee.id }, { sort: "-created_date", limit: 50 }),
      base44.entities.CashCollection.filter(
        { commercial_id: employee.id, status: { $in: ["held_by_commercial", "partially_received"] } },
        { sort: "-collection_date", limit: 100 }
      ),
    ]);
    setStock(balances.items.filter((b) => (b.quantity || 0) > 0));
    setSales(mySales.items);
    setCollections(myCash.items);
    setLoading(false);
  };

  useEffect(() => { if (!authLoading) load(); }, [authLoading, employee?.id]);

  const cashHeld = collections.reduce((s, c) => s + (c.outstanding_amount || 0), 0);

  if (loading) {
    return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Field Sales"
        subtitle={employee ? `${employee.full_name} — your stock, deliveries and cash` : "Link your staff record to use this workspace"}
        actions={
          <Button onClick={() => navigate("/field-sales/new")} disabled={!stock.length}>
            <Plus className="w-4 h-4 mr-1.5" /> Record sale
          </Button>
        }
      />

      {!employee && (
        <Card><CardContent className="py-6 text-sm text-slate-600">
          Your login is not linked to a staff record. Ask an administrator to link your employee record before using field sales.
        </CardContent></Card>
      )}

      <Tabs defaultValue="stock">
        <TabsList className="mb-4">
          <TabsTrigger value="stock">My stock</TabsTrigger>
          <TabsTrigger value="sales">My sales</TabsTrigger>
          <TabsTrigger value="cash">My cash</TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <Card><CardContent className="p-0 divide-y divide-slate-100">
            {!stock.length && <p className="p-4 text-sm text-slate-500">No stock in custody.</p>}
            {stock.map((b) => (
              <div key={b.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-medium text-slate-800">{b.product_name}</div>
                  <div className="text-xs text-slate-500">
                    {b.lot_number ? `Lot ${b.lot_number} · ` : ""}{b.expiry_date ? `expires ${formatDate(b.expiry_date)}` : "no expiry"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{b.quantity}</div>
                  <div className="text-xs text-slate-500">{formatXAF(b.total_value)}</div>
                </div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="sales">
          <Card><CardContent className="p-0 divide-y divide-slate-100">
            {!sales.length && <p className="p-4 text-sm text-slate-500">No sales recorded yet.</p>}
            {sales.map((s) => (
              <button
                key={s.id}
                onClick={() => navigate(`/field-sales/${s.id}`)}
                className="w-full text-left flex items-center justify-between px-4 py-3 hover:bg-slate-50"
              >
                <div>
                  <div className="font-medium text-slate-800">{s.sale_number} — {s.customer_name}</div>
                  <div className="text-xs text-slate-500">{formatDate(s.transaction_date)} · {s.payment_type}</div>
                </div>
                <div className="text-right space-y-1">
                  <div className="font-semibold tabular-nums">{formatXAF(s.total)}</div>
                  <StatusPill map={SALE_STATUS} value={s.status} />
                </div>
              </button>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="cash">
          <Card className="mb-4"><CardContent className="flex items-center justify-between py-4">
            <div>
              <div className="text-sm text-slate-500">Cash held by you</div>
              <div className="text-2xl font-bold text-slate-900">{formatXAF(cashHeld)}</div>
            </div>
            <Button onClick={() => setHandoverOpen(true)} disabled={!collections.length}>Hand over cash</Button>
          </CardContent></Card>

          <Card><CardContent className="p-0 divide-y divide-slate-100">
            {!collections.length && <p className="p-4 text-sm text-slate-500">Nothing outstanding.</p>}
            {collections.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-medium text-slate-800">{c.collection_number} — {c.customer_name}</div>
                  <div className="text-xs text-slate-500">{c.sale_number} · {formatDate(c.collection_date)}</div>
                </div>
                <div className="text-right space-y-1">
                  <div className="font-semibold tabular-nums">{formatXAF(c.outstanding_amount)}</div>
                  <StatusPill map={COLLECTION_STATUS} value={c.status} />
                </div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <HandoverSubmitDialog
        open={handoverOpen}
        onClose={() => setHandoverOpen(false)}
        collections={collections}
        employee={employee}
        onDone={load}
      />
    </div>
  );
}