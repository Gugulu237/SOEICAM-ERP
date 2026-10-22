import React from 'react';
import { Factory, Truck, Banknote, Store, Boxes, ShoppingCart, BriefcaseBusiness, Users, PackageCheck, ClipboardCheck, MapPin, Settings2, ChartNoAxesCombined, Receipt, Package, UserRoundCheck } from 'lucide-react';
import { Link } from '@/lib/router';

const visuals = {
  admin: [BriefcaseBusiness, ChartNoAxesCombined, Users],
  production_manager: [Factory, Settings2, ClipboardCheck],
  supply_chain_manager: [Boxes, Truck, PackageCheck],
  warehouse_manager: [Package, Boxes, PackageCheck],
  procurement: [ShoppingCart, Receipt, PackageCheck],
  commercial: [Users, Receipt, MapPin],
  driver: [Truck, MapPin, Package],
  cashier: [Banknote, Receipt, ClipboardCheck],
  hotesse: [Store, Package, ChartNoAxesCombined],
  employee: [UserRoundCheck, ClipboardCheck, BriefcaseBusiness],
};

// Lightweight vector scenes: decorative, with the role name as the link's label.
export function RoleIllustration({ role, template }) {
  const [Main, Left, Right] = visuals[role] || visuals[template] || visuals.employee;
  return <div aria-hidden="true" className="relative mx-auto flex h-36 w-56 items-center justify-center">
    <div className="absolute h-28 w-40 rounded-[50%] bg-green-100/70 transition-transform duration-200 group-hover:scale-105" />
    <svg viewBox="0 0 224 144" className="absolute inset-0 h-full w-full fill-none text-green-300"><path d="M42 81H182M112 28V116" stroke="currentColor" strokeWidth="2" strokeDasharray="4 5" /><circle cx="112" cy="28" r="4" fill="currentColor" /><circle cx="112" cy="116" r="4" fill="currentColor" /></svg>
    <span className="absolute left-2 top-14 -rotate-6 rounded-2xl border border-green-100 bg-white p-3 text-green-600 shadow-sm"><Left size={24} strokeWidth={1.6} /></span>
    <span className="relative rounded-3xl border border-green-200 bg-white p-5 text-[#347623] shadow-sm"><Main size={48} strokeWidth={1.5} /></span>
    <span className="absolute right-2 top-14 rotate-6 rounded-2xl border border-green-100 bg-white p-3 text-green-600 shadow-sm"><Right size={24} strokeWidth={1.6} /></span>
  </div>;
}

export default function RoleCards({ roles }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{roles.map(option => <Link key={option.key} to={'/team-workspaces?role=' + encodeURIComponent(option.key)} className="group flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 pb-6 pt-3 text-center transition hover:border-green-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2">
    <RoleIllustration role={option.key} template={option.template_role} />
    <h2 className="max-w-xs text-base font-semibold leading-6 text-slate-800 group-hover:text-green-800">{option.label}</h2>
  </Link>)}</div>;
}
