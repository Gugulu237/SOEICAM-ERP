
/* localized-interface */
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import CommandSearch from "@/components/layout/CommandSearch";
import ProductionNotifications from "./ProductionNotifications";
import QuickActions from "@/components/layout/QuickActions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ROLE_LABELS } from "@/lib/permissions";
import { UserButton } from '@clerk/nextjs';
import { usesClerk } from '@/lib/auth-provider';
import NavigationHistory from './NavigationHistory';
import StaffRoleSwitcher from '@/components/employees/StaffRoleSwitcher';
import LanguageSelector from './LanguageSelector';
import { ui } from '@/lib/i18n';
import { Link } from '@/lib/router';
import { UserRound } from 'lucide-react';

// App-wide top bar: global search, quick actions, current user.
export default function TopBar() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { user, role, roleLabel } = useCurrentUser();
  const initials = (user?.full_name || user?.email || "?")
    .split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-green-100 bg-white/95 backdrop-blur">
      <div className="flex min-h-14 min-w-0 items-center gap-1 py-2 pl-14 pr-3 sm:gap-3 sm:pr-5 xl:px-8">
        <div className="min-w-0 flex-1 max-w-md">
          {!role ? <span className="text-sm text-slate-500">{ui("Loading workspace...")}</span> : ['commercial', 'driver', 'cashier', 'production_manager', 'hotesse'].includes(role) ? <span className="block truncate text-sm font-semibold text-slate-800">{({ commercial: ui("My commercial workspace"), driver: ui("My delivery workspace"), cashier: ui("Cashier workspace"), production_manager: ui("Operations / Production workspace"), hotesse: ui("My sales & stock") })[role]}</span> : <CommandSearch />}
        </div>
        <LanguageSelector />
        <ProductionNotifications />
        <QuickActions />
        <Link to="/profile" aria-label={ui('My profile')} title={ui('My profile')} className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-green-100 text-slate-600 hover:bg-green-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-700 md:flex"><UserRound size={18}/></Link>
        <div className={`${usesClerk() ? 'flex' : 'hidden sm:flex'} shrink-0 items-center gap-2 sm:border-l sm:border-green-100 sm:pl-2`}>
          {usesClerk() ? <UserButton /> : <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
            {initials}
          </div>}
          <div className="hidden md:block leading-tight">
            <p className="text-xs font-semibold text-slate-800">{user?.full_name || user?.email}</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">{ui(roleLabel || ROLE_LABELS[role] || "")}</p>
          </div>
        </div>
      </div>
      <StaffRoleSwitcher />
      <NavigationHistory />
    </header>
  );
}
