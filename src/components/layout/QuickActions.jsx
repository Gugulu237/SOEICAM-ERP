
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { useNavigate } from "@/lib/router";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { hasRoleAccess } from "@/lib/permissions";
import { moduleForPath } from '@/server/domain/role-catalogue';
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Receipt, PackageCheck, Factory, Banknote, UserPlus, Truck, ShoppingCart } from "lucide-react";

const ACTIONS = [
  { get label(){return ui("Field Sale");}, path: "/commercial?section=pos&new=1", icon: Receipt, roles: ["admin", "commercial"] },
  { get label(){return ui("New Sales Order");}, path: "/sales/new", icon: Receipt, roles: ["admin", "employee"] },
  { get label(){return ui("New Purchase Order");}, path: "/purchases/new", icon: ShoppingCart, roles: ["admin", "procurement", "production_manager", "warehouse_manager", "employee"] },
  { get label(){return ui("Receive Goods");}, path: "/purchases?section=receiving", icon: PackageCheck, roles: ["admin", "procurement", "warehouse_manager"] },
  { get label(){return ui("New Production Order");}, path: "/manufacturing/new", icon: Factory, roles: ["admin", "production_manager"] },
  { get label(){return ui("Record Payment");}, path: "/accounting/payments/new", icon: Banknote, roles: ["admin", "cashier"] },
  { get label(){return ui("New Customer");}, path: "/customers/new", icon: UserPlus, roles: ["admin", "employee", "commercial"] },
  { get label(){return ui("Stock Request");}, path: "/distribution/requests/new", icon: Truck, roles: ["admin", "employee", "warehouse_manager"] },
];

// Universal "+ New" menu — frequent actions from anywhere in the app.
export default function QuickActions() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const { role, allowedModules } = useCurrentUser();
  const actions = ACTIONS.filter(a => hasRoleAccess(role, a.roles) && (role === 'admin' || !allowedModules || allowedModules.includes(moduleForPath(a.path))));

  if (!actions.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="bg-[#347623] font-semibold text-white hover:bg-[#245719]">
          <Plus size={16} />{ui(" New")}</Button>
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
