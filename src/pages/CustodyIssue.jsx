import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/shared/PageHeader";
import { invokeFieldOps, errorMessage } from "@/lib/field-ops";
import { formatXAF } from "@/lib/formatters";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";

const STORE_TYPES = ["raw_material", "packaging", "wip", "finished_goods", "cold_room", "quarantine", "damaged", "vehicle", "general"];

export default function CustodyIssue() {
  const { toast } = useToast();
  const [staff, setStaff] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [custody, setCustody] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState({ commercialId: "", sourceWarehouseId: "", date: new Date().toISOString().slice(0, 10), reference: "", notes: "", lines: [] });
  const [give, setGive] = useState({ commercialId: "", toWarehouseId: "", date: new Date().toISOString().slice(0, 10), reason: "", lines: [] });

  useEffect(() => {
    const load = async () => {
      const [emps, whs, prods] = await Promise.all([
        base44.entities.Employee.list("-created_date", 300),
        base44.entities.Warehouse.list("-created_date", 100),
        base44.entities.Product.filter({ is_active: true }, { sort: "name", limit: 400 }),
      ]);
      setStaff(emps);
      setWarehouses(whs);
      setProducts(prods.items);
      setLoading(false);
    };
    load();
  }, []);

  const loadCustody = async (commercialId) => {
    if (!commercialId) { setCustody([]); return; }
    const whs = await base44.entities.Warehouse.filter({ warehouse_type: "commercial_custody", custodian_employee_id: commercialId });
    if (!whs.length) { setCustody([]); return; }
    const res = await base44.entities.StockBalance.filter({ warehouse_id: whs[0].id }, { limit: 200 });
    setCustody(res.items.filter((b) => (b.quantity || 0) > 0));
  };

  const run = async (action, payload, onDone) => {
    setBusy(true);
    try {
      const res = await invokeFieldOps({ action, ...payload });
      toast({
        title: action === "issueCustody" ? `Issued to custody (${res.data.issueRef})` : `Return recorded (${res.data.returnRef})`,
        description: `${res.data.moved.length} product line(s) moved.`,
      });
      onDone();
    } catch (e) {
      toast({ title: "Not recorded", description: errorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;

  const stores = warehouses.filter((w) => STORE_TYPES.includes(w.warehouse_type));

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <PageHeader title="Commercial Custody" subtitle="Goods issued to a Commercial stay company stock until they are sold — this is never a sale." />

      <Tabs defaultValue="issue">
        <TabsList className="mb-4">
          <TabsTrigger value="issue">Issue goods</TabsTrigger>
          <TabsTrigger value="return">Record a return</TabsTrigger>
        </TabsList>

        <TabsContent value="issue">
          <Card><CardHeader className="pb-2"><CardTitle className="text-base">Issue stock to a Commercial</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Commercial *</Label>
                  <Select value={issue.commercialId} onValueChange={(v) => setIssue({ ...issue, commercialId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select staff member" /></SelectTrigger>
                    <SelectContent>
                      {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}{s.role ? ` — ${s.role}` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Source warehouse *</Label>
                  <Select value={issue.sourceWarehouseId} onValueChange={(v) => setIssue({ ...issue, sourceWarehouseId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                    <SelectContent>
                      {stores.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={issue.date} onChange={(e) => setIssue({ ...issue, date: e.target.value })} />
                </div>
                <div>
                  <Label>Reference</Label>
                  <Input value={issue.reference} onChange={(e) => setIssue({ ...issue, reference: e.target.value })} placeholder="Optional" />
                </div>
              </div>

              <LinesEditor
                lines={issue.lines}
                onChange={(lines) => setIssue({ ...issue, lines })}
                products={products}
                showCost
              />

              <div>
                <Label>Notes</Label>
                <Textarea rows={2} value={issue.notes} onChange={(e) => setIssue({ ...issue, notes: e.target.value })} />
              </div>

              <Button
                disabled={busy || !issue.commercialId || !issue.sourceWarehouseId || !issue.lines.length}
                onClick={() => run("issueCustody", issue, () => { setIssue({ ...issue, lines: [], reference: "" }); loadCustody(issue.commercialId); })}
              >
                {busy ? "Issuing…" : "Issue into custody"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="return">
          <Card><CardHeader className="pb-2"><CardTitle className="text-base">Record goods coming back</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Commercial *</Label>
                  <Select value={give.commercialId} onValueChange={(v) => { setGive({ ...give, commercialId: v, lines: [] }); loadCustody(v); }}>
                    <SelectTrigger><SelectValue placeholder="Select staff member" /></SelectTrigger>
                    <SelectContent>
                      {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Warehouse receiving *</Label>
                  <Select value={give.toWarehouseId} onValueChange={(v) => setGive({ ...give, toWarehouseId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                    <SelectContent>
                      {stores.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {give.commercialId && (
                <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {!custody.length && <p className="p-3 text-sm text-slate-500">This Commercial holds no stock in custody.</p>}
                  {custody.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className="w-full text-left flex items-center justify-between px-3 py-2 hover:bg-slate-50"
                      onClick={() => setGive({
                        ...give,
                        lines: [...give.lines, { product_id: b.product_id, quantity: b.quantity }],
                      })}
                    >
                      <span className="text-sm">{b.product_name}{b.lot_number ? ` · lot ${b.lot_number}` : ""}</span>
                      <span className="text-sm tabular-nums">{b.quantity} held · add</span>
                    </button>
                  ))}
                </div>
              )}

              <LinesEditor lines={give.lines} onChange={(lines) => setGive({ ...give, lines })} products={products} />

              <div>
                <Label>Reason</Label>
                <Textarea rows={2} value={give.reason} onChange={(e) => setGive({ ...give, reason: e.target.value })} placeholder="e.g. unsold stock returned at the end of the day" />
              </div>

              <Button
                disabled={busy || !give.commercialId || !give.toWarehouseId || !give.lines.length}
                onClick={() => run("returnCustody", give, () => { setGive({ ...give, lines: [] }); loadCustody(give.commercialId); })}
              >
                {busy ? "Recording…" : "Record the return"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LinesEditor({ lines, onChange, products }) {
  const setLine = (i, patch) => onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Products</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, { product_id: "", quantity: 1 }])}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Add
        </Button>
      </div>
      {lines.map((line, i) => (
        <div key={i} className="flex gap-2">
          <Select value={line.product_id} onValueChange={(v) => setLine(i, { product_id: v })}>
            <SelectTrigger className="flex-1"><SelectValue placeholder="Select product" /></SelectTrigger>
            <SelectContent>
              {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            type="number"
            step="0.001"
            className="w-24"
            value={line.quantity}
            onChange={(e) => setLine(i, { quantity: e.target.value })}
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(lines.filter((_, idx) => idx !== i))}>
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
      ))}
    </div>
  );
}