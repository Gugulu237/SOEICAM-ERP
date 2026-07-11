import React from "react";
import { Outlet, NavLink } from "react-router-dom";
import { LayoutDashboard, BookOpen, FileText, ScrollText, Scale, Banknote, Receipt } from "lucide-react";

const subNav = [
  { to: "/accounting", label: "Command Centre", icon: LayoutDashboard, end: true },
  { to: "/accounting/chart-of-accounts", label: "Chart of Accounts", icon: BookOpen },
  { to: "/accounting/journals", label: "Journal Entries", icon: FileText },
  { to: "/accounting/general-ledger", label: "General Ledger", icon: ScrollText },
  { to: "/accounting/trial-balance", label: "Trial Balance", icon: Scale },
  { to: "/accounting/expenses/new", label: "Record Expense", icon: Receipt },
  { to: "/accounting/payments/new", label: "Record Payment", icon: Banknote },
];

export default function AccountingLayout() {
  return (
    <div>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 mb-6 -mt-2 pb-px">
        {subNav.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                isActive
                  ? "border-amber-500 text-amber-700"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
              }`
            }
          >
            <item.icon size={15} />
            {item.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}