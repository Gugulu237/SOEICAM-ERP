
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { useNavigate } from "@/lib/router";
import { erp } from "@/api/erpClient";
import { qualityPath } from '@/lib/quality-workspace';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { moduleForPath } from '@/server/domain/role-catalogue';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  Search, UserCheck, Package, Boxes, Receipt, Factory, Truck, Users, ShoppingCart, Plus,
} from "lucide-react";

const COMMANDS = [
  { get label(){return ui("New Sales Order");}, path: "/sales/new" },
  { get label(){return ui("New Purchase Order");}, path: "/purchases/new" },
  { get label(){return ui("New Production Order");}, path: "/manufacturing/new" },
  { get label(){return ui("Record Payment");}, path: "/accounting/payments/new" },
  { get label(){return ui("New Customer");}, path: "/customers/new" },
];

// Global command search — Ctrl/⌘+K anywhere. Searches customers, products,
// batches, orders, vehicles, suppliers, plus quick commands.
export default function CommandSearch() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const navigate = useNavigate();
  const { role, allowedModules } = useCurrentUser();
  const permits = path => role === 'admin' || !allowedModules || allowedModules.includes(moduleForPath(path));

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
    if (!open) { setData(null); return; }
    let active = true;
    Promise.all([
      permits('/customers') ? erp.entities.Customer.list("-updated_date", 200) : [],
      permits('/inventory') ? erp.entities.Product.filter({ is_active: true }, "-updated_date", 200) : [],
      permits('/quality') ? erp.entities.StockBalance.filter({}, "-updated_date", 300) : [],
      permits('/sales') ? erp.entities.SalesOrder.list("-updated_date", 100) : [],
      permits('/manufacturing') ? erp.entities.ProductionOrder.list("-updated_date", 100) : [],
      permits('/distribution') ? erp.entities.Vehicle.list("-updated_date", 50) : [],
      permits('/purchases') ? erp.entities.Supplier.list("-updated_date", 100) : [],
      permits('/purchases') ? erp.entities.PurchaseOrder.list("-updated_date", 100) : [],
      permits('/accounting') ? erp.entities.Invoice.list("-updated_date", 100) : [],
    ].map(promise => Promise.resolve(promise).catch(() => []))).then(([customers, products, balances, salesOrders, prodOrders, vehicles, suppliers, pos, invoices]) => {
      if (!active) return;
      const batches = [...new Map(
        balances.filter(b => b.lot_number).map(b => [b.product_id+':'+b.lot_number, b])
      ).values()];
      setData({ customers: customers.filter(customer => !customer.customer_removed_at), products, batches, salesOrders, prodOrders, vehicles, suppliers, pos, invoices });
    });
    return () => { active = false; };
  }, [open, role, allowedModules]);

  function go(path) {
    setOpen(false);
    navigate(path);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={ui('Search or type a command…')} className="flex h-11 w-11 shrink-0 items-center justify-center sm:h-10 sm:w-full sm:min-w-0 sm:justify-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:bg-white sm:px-3"
      >
        <Search size={15} />
        <span className="hidden flex-1 truncate text-left sm:block">{ui("Search")}</span>
        <kbd className="hidden sm:inline text-[10px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-400">{ui("⌘K")}</kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={ui("Search customers, batches, products, orders…")} />
        <CommandList className="max-h-[min(420px,calc(100dvh_-_80px))]">
          <CommandEmpty>{data ? ui("No results found.") : ui("Loading…")}</CommandEmpty>

          <CommandGroup heading={ui("Quick Actions")}>
            {COMMANDS.filter(c => permits(c.path)).map(c => (
              <CommandItem key={c.path} value={`command ${c.label}`} onSelect={() => go(c.path)}>
                <Plus className="text-slate-400" /> {c.label}
              </CommandItem>
            ))}
          </CommandGroup>

          {data && (
            <>
              <CommandGroup heading={ui("Batches")}>
                {data.batches.map(b => (
                  <CommandItem key={b.product_id+':'+b.lot_number} value={`batch ${b.lot_number} ${b.product_name}`} onSelect={() => go(qualityPath('traceability',{batch:b.lot_number,product:b.product_id}))}>
                    <Boxes className="text-indigo-500" />
                    <span>{b.lot_number}</span>
                    <span className="text-xs text-slate-400 truncate">{b.product_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={ui("Customers")}>
                {data.customers.map(c => (
                  <CommandItem key={c.id} value={`customer ${c.business_name} ${c.customer_number || ""}`} onSelect={() => go(`/customers/${c.id}`)}>
                    <UserCheck className="text-teal-500" /> {c.business_name}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={ui("Products")}>
                {data.products.map(p => (
                  <CommandItem key={p.id} value={`product ${p.name} ${p.sku}`} onSelect={() => go(`/inventory/products/${p.id}`)}>
                    <Package className="text-sky-500" />
                    <span>{p.name}</span>
                    <span className="text-xs text-slate-400">{p.sku}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={ui("Sales Orders")}>
                {data.salesOrders.map(o => (
                  <CommandItem key={o.id} value={`sales order ${o.order_number || ""} ${o.customer_name || ""}`} onSelect={() => go(`/sales/${o.id}`)}>
                    <Receipt className="text-green-500" />
                    <span>{o.order_number || ui("Order")}</span>
                    <span className="text-xs text-slate-400 truncate">{o.customer_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={ui("Production Orders")}>
                {data.prodOrders.map(o => (
                  <CommandItem key={o.id} value={`production ${o.order_number || ""} ${o.product_name || ""} ${o.lot_number || ""}`} onSelect={() => go(`/manufacturing/${o.id}`)}>
                    <Factory className="text-blue-500" />
                    <span>{o.order_number || ui("Production")}</span>
                    <span className="text-xs text-slate-400 truncate">{o.product_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={ui("Purchase Orders")}>
                {data.pos.map(o => (
                  <CommandItem key={o.id} value={`purchase ${o.po_number || ""} ${o.supplier_name || ""}`} onSelect={() => go(`/purchases/${o.id}`)}>
                    <ShoppingCart className="text-sky-500" />
                    <span>{o.po_number || ui("PO")}</span>
                    <span className="text-xs text-slate-400 truncate">{o.supplier_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={ui("Invoices")}>
                {data.invoices.map(i => (
                  <CommandItem key={i.id} value={`invoice ${i.invoice_number || ""} ${i.customer_name || ""}`} onSelect={() => go("/accounting/receivables")}>
                    <Receipt className="text-cyan-600" />
                    <span>{i.invoice_number || ui("Invoice")}</span>
                    <span className="text-xs text-slate-400 truncate">{i.customer_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={ui("Vehicles")}>
                {data.vehicles.map(v => (
                  <CommandItem key={v.id} value={`vehicle truck ${v.name || v.plate_number || ""}`} onSelect={() => go("/distribution")}>
                    <Truck className="text-blue-500" /> {v.name || v.plate_number}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={ui("Suppliers")}>
                {data.suppliers.map(s => (
                  <CommandItem key={s.id} value={`supplier ${s.name}`} onSelect={() => go('/purchases?section=suppliers&supplier='+encodeURIComponent(s.id))}>
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
