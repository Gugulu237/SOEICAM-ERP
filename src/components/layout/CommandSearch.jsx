import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  Search, UserCheck, Package, Boxes, Receipt, Factory, Truck, Users, ShoppingCart, Plus,
} from "lucide-react";

const COMMANDS = [
  { label: "New Sales Order", path: "/sales/new" },
  { label: "New Purchase Order", path: "/purchases/new" },
  { label: "New Production Order", path: "/manufacturing/new" },
  { label: "Record Payment", path: "/accounting/payments/new" },
  { label: "New Customer", path: "/customers/new" },
];

// Global command search — Ctrl/⌘+K anywhere. Searches customers, products,
// batches, orders, vehicles, suppliers, plus quick commands.
export default function CommandSearch() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    if (!open || data) return;
    Promise.all([
      base44.entities.Customer.list("-updated_date", 200),
      base44.entities.Product.filter({ is_active: true }, "-updated_date", 200),
      base44.entities.StockBalance.filter({}, "-updated_date", 300),
      base44.entities.SalesOrder.list("-updated_date", 100),
      base44.entities.ProductionOrder.list("-updated_date", 100),
      base44.entities.Vehicle.list("-updated_date", 50),
      base44.entities.Supplier.list("-updated_date", 100),
      base44.entities.PurchaseOrder.list("-updated_date", 100),
      base44.entities.Invoice.list("-updated_date", 100),
    ]).then(([customers, products, balances, salesOrders, prodOrders, vehicles, suppliers, pos, invoices]) => {
      const batches = [...new Map(
        balances.filter(b => b.lot_number).map(b => [b.lot_number, b])
      ).values()];
      setData({ customers, products, batches, salesOrders, prodOrders, vehicles, suppliers, pos, invoices });
    });
  }, [open, data]);

  function go(path) {
    setOpen(false);
    navigate(path);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full sm:w-64 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-400 hover:border-slate-300 hover:bg-white transition-colors"
      >
        <Search size={15} />
        <span className="flex-1 text-left truncate">Search or type a command…</span>
        <kbd className="hidden sm:inline text-[10px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-400">⌘K</kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search customers, batches, products, orders…" />
        <CommandList className="max-h-[420px]">
          <CommandEmpty>{data ? "No results found." : "Loading…"}</CommandEmpty>

          <CommandGroup heading="Quick Actions">
            {COMMANDS.map(c => (
              <CommandItem key={c.path} value={`command ${c.label}`} onSelect={() => go(c.path)}>
                <Plus className="text-slate-400" /> {c.label}
              </CommandItem>
            ))}
          </CommandGroup>

          {data && (
            <>
              <CommandGroup heading="Batches">
                {data.batches.map(b => (
                  <CommandItem key={b.lot_number} value={`batch ${b.lot_number} ${b.product_name}`} onSelect={() => go("/traceability")}>
                    <Boxes className="text-indigo-500" />
                    <span>{b.lot_number}</span>
                    <span className="text-xs text-slate-400 truncate">{b.product_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Customers">
                {data.customers.map(c => (
                  <CommandItem key={c.id} value={`customer ${c.business_name} ${c.customer_number || ""}`} onSelect={() => go(`/customers/${c.id}`)}>
                    <UserCheck className="text-teal-500" /> {c.business_name}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Products">
                {data.products.map(p => (
                  <CommandItem key={p.id} value={`product ${p.name} ${p.sku}`} onSelect={() => go(`/inventory/products/${p.id}`)}>
                    <Package className="text-sky-500" />
                    <span>{p.name}</span>
                    <span className="text-xs text-slate-400">{p.sku}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Sales Orders">
                {data.salesOrders.map(o => (
                  <CommandItem key={o.id} value={`sales order ${o.order_number || ""} ${o.customer_name || ""}`} onSelect={() => go(`/sales/${o.id}`)}>
                    <Receipt className="text-green-500" />
                    <span>{o.order_number || "Order"}</span>
                    <span className="text-xs text-slate-400 truncate">{o.customer_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Production Orders">
                {data.prodOrders.map(o => (
                  <CommandItem key={o.id} value={`production ${o.order_number || ""} ${o.product_name || ""} ${o.lot_number || ""}`} onSelect={() => go(`/manufacturing/${o.id}`)}>
                    <Factory className="text-purple-500" />
                    <span>{o.order_number || "Production"}</span>
                    <span className="text-xs text-slate-400 truncate">{o.product_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Purchase Orders">
                {data.pos.map(o => (
                  <CommandItem key={o.id} value={`purchase ${o.po_number || ""} ${o.supplier_name || ""}`} onSelect={() => go(`/purchases/${o.id}`)}>
                    <ShoppingCart className="text-orange-500" />
                    <span>{o.po_number || "PO"}</span>
                    <span className="text-xs text-slate-400 truncate">{o.supplier_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Invoices">
                {data.invoices.map(i => (
                  <CommandItem key={i.id} value={`invoice ${i.invoice_number || ""} ${i.customer_name || ""}`} onSelect={() => go("/accounting/receivables")}>
                    <Receipt className="text-amber-500" />
                    <span>{i.invoice_number || "Invoice"}</span>
                    <span className="text-xs text-slate-400 truncate">{i.customer_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Vehicles">
                {data.vehicles.map(v => (
                  <CommandItem key={v.id} value={`vehicle truck ${v.name || v.plate_number || ""}`} onSelect={() => go("/distribution")}>
                    <Truck className="text-blue-500" /> {v.name || v.plate_number}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Suppliers">
                {data.suppliers.map(s => (
                  <CommandItem key={s.id} value={`supplier ${s.name}`} onSelect={() => go("/suppliers")}>
                    <Users className="text-slate-500" /> {s.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}