import React from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Receipt, PackageCheck, Factory, Banknote, UserPlus, Truck, ShoppingCart } from "lucide-react";

const ACTIONS = [
  { label: "New Sales Order", path: "/sales/new", icon: Receipt, roles: ["admin", "employee"] },
  { label: "New Purchase Order", path: "/purchases/new", icon: ShoppingCart, roles: ["admin", "procurement", "production_manager", "warehouse_manager", "employee"] },
  { label: "Receive Goods", path: "/purchases", icon: PackageCheck, roles: ["admin", "procurement", "warehouse_manager"] },
  { label: "New Production Order", path: "/manufacturing/new", icon: Factory, roles: ["admin", "production_manager"] },
  { label: "Record Payment", path: "/accounting/payments/new", icon: Banknote, roles: ["admin", "cashier"] },
  { label: "New Customer", path: "/customers/new", icon: UserPlus, roles: ["admin", "employee"] },
  { label: "Stock Request", path: "/distribution/requests/new", icon: Truck, roles: ["admin", "employee", "warehouse_manager"] },
];

// Universal "+ New" menu — frequent actions from anywhere in the app.
export default function QuickActions() {
  const navigate = useNavigate();
  const { role } = useCurrentUser();
  const actions = ACTIONS.filter(a => !role || role === "admin" || a.roles.includes(role));

  if (!actions.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold">
          <Plus size={16} /> New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {actions.map(a => (
          <DropdownMenuItem key={a.path + a.label} onClick={() => navigate(a.path)} className="cursor-pointer">
            <a.icon size={16} className="mr-2 text-slate-500" /> {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}