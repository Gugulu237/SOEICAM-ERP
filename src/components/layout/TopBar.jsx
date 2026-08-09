import React from "react";
import CommandSearch from "@/components/layout/CommandSearch";
import QuickActions from "@/components/layout/QuickActions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ROLE_LABELS } from "@/lib/permissions";

// App-wide top bar: global search, quick actions, current user.
export default function TopBar() {
  const { user, role } = useCurrentUser();
  const initials = (user?.full_name || user?.email || "?")
    .split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
      <div className="flex items-center gap-3 px-4 sm:px-6 lg:px-8 py-2.5 pl-14 lg:pl-8">
        <div className="flex-1 max-w-md">
          <CommandSearch />
        </div>
        <QuickActions />
        <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-slate-900 text-amber-400 flex items-center justify-center text-xs font-bold">
            {initials}
          </div>
          <div className="hidden md:block leading-tight">
            <p className="text-xs font-semibold text-slate-800">{user?.full_name || user?.email}</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">{ROLE_LABELS[role] || ""}</p>
          </div>
        </div>
      </div>
    </header>
  );
}