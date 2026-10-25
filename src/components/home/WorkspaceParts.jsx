
/* localized-interface */
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { useNavigate } from '@/lib/router';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProductThumb from '@/components/shared/ProductThumb';
import MobileInfo from '@/components/shared/MobileInfo';
import { MobileDashboardIdentity, useDashboardIdentity } from './DashboardIdentity';
import { useWorkspaceAccess } from './WorkspaceAccess';

export function WorkspaceHero({ eyebrow, title, description, icon: Icon, children }) {
  const { centralHero } = useDashboardIdentity();
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <section className={(centralHero && !children ? "hidden sm:block " : "") + "relative overflow-hidden rounded-3xl border border-border bg-secondary/50 p-4 text-primary sm:p-8"}>
    <div className="relative z-10 max-w-2xl"><div className="pr-10 sm:pr-0"><MobileDashboardIdentity /></div><div className="hidden sm:block"><p className="text-xs font-semibold uppercase tracking-widest">{eyebrow}</p><h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">{description}</p></div>{!centralHero && <MobileInfo mobileOnly title={eyebrow || title} className="absolute right-0 top-0 sm:hidden"><p>{description}</p></MobileInfo>}{children && <div className={(centralHero ? "mt-0 " : "mt-3 ") + "flex flex-wrap gap-2 sm:mt-5 sm:gap-3"}>{children}</div>}</div>
    {Icon && <Icon className="absolute bottom-6 right-8 hidden h-32 w-32 opacity-10 xl:block" strokeWidth={1} aria-hidden="true" />}
  </section>;
}
export function WorkspaceButton({ path, preview, children, ...props }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const { canOpen } = useWorkspaceAccess();
  if (!canOpen(path)) return null;
  return <Button className="h-11" disabled={preview} onClick={() => { if (!preview) navigate(path); }} {...props}>{children}</Button>;
}
export function WorkspaceMetrics({ metrics, ready }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{metrics.map(({ label, value, note }) => <div key={label} className="rounded-2xl border bg-white p-4 sm:p-5"><p className="text-xs text-slate-500">{label}</p><p className="my-2 break-words text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{ready ? value : '—'}</p><p className="hidden text-[11px] leading-5 text-slate-500 sm:block">{note}</p></div>)}</div>;
}
export function WorkspaceActions({ actions, preview }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const { canOpen } = useWorkspaceAccess();
  actions = actions.filter(action => canOpen(action.path));
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{actions.map(({ title, detail, path, icon: Icon }) => <button key={title} disabled={preview} onClick={() => { if (!preview) navigate(path); }} className="flex items-start gap-3 rounded-2xl border bg-white p-4 text-left transition hover:border-primary/40 disabled:cursor-default disabled:opacity-70"><span className="rounded-xl bg-secondary p-3 text-primary"><Icon size={21} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="mt-1 hidden text-xs leading-5 text-slate-500 sm:block">{detail}</span></span></button>)}</div>;
}
export function WorkspacePanel({ title, subtitle, children, className = '' }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <section className={'rounded-2xl border bg-white p-5 ' + className}><h2 className="text-base font-semibold text-slate-900">{title}</h2>{subtitle && <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>}<div className="mt-4">{children}</div></section>;
}
export function WorkspaceQueue({ rows, empty, preview }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const { canOpen } = useWorkspaceAccess();
  rows = rows.filter(row => !row.path || canOpen(row.path));
  return <div className="divide-y divide-slate-100">{!rows.length && <p className="py-4 text-sm text-slate-500">{empty}</p>}{rows.map(row => <button key={row.id} disabled={preview || !row.path} onClick={() => { if (!preview && row.path) navigate(row.path); }} className="flex w-full items-center gap-3 py-3 text-left disabled:cursor-default"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-800">{row.title}</p>{row.detail && <p className="mt-1 text-xs text-slate-500">{row.detail}</p>}</div>{row.value != null && <span className="text-right text-sm font-semibold tabular-nums">{row.value}</span>}{row.path && <ArrowUpRight size={15} className="shrink-0 text-slate-400" />}</button>)}</div>;
}
export function ProductRange({ products = [] }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  if (!products.length) return null;
  return <div className="flex gap-3 overflow-x-auto pb-2">{products.slice(0, 6).map(product => <div key={product.id} className="flex w-44 shrink-0 items-center gap-3 rounded-xl border bg-slate-50/50 p-3"><ProductThumb product={product} size={52} /><span className="text-xs font-medium leading-5">{product.name}</span></div>)}</div>;
}
