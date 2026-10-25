import React, { createContext, useContext } from 'react';
import { ui } from '@/lib/i18n';

const Identity = createContext(null);
export const DashboardIdentity = Identity.Provider;

export function useDashboardIdentity() {
  return useContext(Identity) || {};
}

export function MobileDashboardIdentity({ force = false }) {
  const { roleName, employeeName, centralHero } = useDashboardIdentity();
  if (centralHero && !force) return null;
  return <div className="min-w-0 sm:hidden"><p className="text-xs font-semibold uppercase tracking-wide text-primary">{ui(roleName || 'Employee')}</p><h1 className="mt-1 break-words text-2xl font-bold leading-tight text-slate-900">{employeeName || ui('Employee dashboard')}</h1></div>;
}
