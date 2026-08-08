import React, { useState, useMemo } from "react";
import DataTable from "@/components/shared/DataTable";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatXAF, formatNumber, formatDate } from "@/lib/formatters";

const TYPES = [
  "purchase_receipt", "supplier_return", "production_issue", "production_return",
  "production_consumption", "production_output", "warehouse_transfer", "vehicle_load",
  "customer_delivery", "customer_return", "damage", "expiry", "quality_quarantine",
  "quality_release", "stock_adjustment", "stock_count_variance", "promotional_issue", "sample_issue",
];

export default function MovementLedger({ movements, warehouses }) {
  const [type, setType] = useState("all");
  const [warehouse, setWarehouse] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const whName = (id) => warehouses.find(w => w.id === id)?.name || "";

  const rows = useMemo(() => movements.filter(m => {
    if (type !== "all" && m.movement_type !== type) return false;
    if (warehouse !== "all" && m.source_warehouse_id !== warehouse && m.destination_warehouse_id !== warehouse) return false;
    if (from && (m.movement_date || "") < from) return false;
    if (to && (m.movement_date || "") > to) return false;
    return true;
  }).map(m => ({ ...m, _from: whName(m.source_warehouse_id), _to: whName(m.destination_warehouse_id) })),
  [movements, type, warehouse, from, to, warehouses]);

  const columns = [
    { key: "movement_date", label: "Date", render: v => v ? formatDate(v) : "—" },
    { key: "product_name", label: "Product" },
    { key: "movement_type", label: "Type", render: v => <span className="capitalize">{v?.replace(/_/g, " ")}</span> },
    { key: "_from", label: "From", render: v => v || "—" },
    { key: "_to", label: "To", render: v => v || "—" },
    { key: "lot_number", label: "Lot", render: v => v || "—" },
    { key: "quantity", label: "Qty", render: v => formatNumber(v, 2), className: "text-right" },
    { key: "unit_cost", label: "Unit Cost", render: v => formatXAF(v), className: "text-right" },
    { key: "total_value", label: "Value", render: v => formatXAF(v), className: "text-right" },
    { key: "reason", label: "Reference", render: v => v || "—" },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div>
          <Label className="text-xs">Movement Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Warehouse</Label>
          <Select value={warehouse} onValueChange={setWarehouse}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All warehouses</SelectItem>
              {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        searchFields={["product_name", "lot_number", "reason"]}
        pageSize={25}
        emptyMessage="No stock movements match these filters."
      />
    </div>
  );
}