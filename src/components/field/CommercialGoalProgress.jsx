
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { commercialGoals } from '@/lib/commercial-daily';
import { formatXAF } from '@/lib/formatters';

export default function CommercialGoalProgress({ employee, verified, approvedTotal, commission }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const estimate = commission && <div className="rounded-xl border border-emerald-200 bg-white p-3"><h3 className="text-xs font-semibold text-emerald-950">{ui("Commission estimate this month")}</h3>{commission.configured ? <><p className="mt-2 text-xl font-bold text-emerald-900">{formatXAF(commission.estimate)}</p><p className="mt-2 text-xs leading-5 text-emerald-900">{commission.rate}{ui("% of ")}{formatXAF(commission.eligibleNet)}{ui(" net posted sales to acquired customers, plus ")}{formatXAF(commission.customerBonus)}{ui(" per verified new customer this month.")}</p><p className="mt-2 text-[11px] leading-5 text-slate-500">{ui("Cash and credit sales qualify. Tax and free replacements are excluded. Estimate uses the current rates; management must review and approve payment.")}</p></> : <p className="mt-2 text-xs leading-5 text-emerald-900">{ui("The General Manager can set commission rates in Employees. No rate has been configured.")}</p>}</div>;
  return <section className="space-y-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-5"><h2 className="font-semibold text-emerald-950">{ui("Monthly goals & bonus review")}</h2>{estimate}{commercialGoals(employee, verified, approvedTotal).map(goal => <div key={goal.label}><div className="flex flex-wrap justify-between gap-2 text-xs text-emerald-900"><span>{goal.label}</span><strong>{goal.money ? formatXAF(goal.actual) : goal.actual}{goal.target ? ' / ' + (goal.money ? formatXAF(goal.target) : goal.target) : ''}</strong></div>{goal.target ? <><progress className="mt-2 h-2 w-full accent-emerald-700" value={Math.min(goal.actual, goal.target)} max={goal.target} aria-label={goal.label} /><p className="mt-1 text-[11px] text-emerald-800">{goal.actual >= goal.target ? ui("Goal reached / ready for management review") : Math.round(goal.actual / goal.target * 100) + '% of goal'}</p></> : <p className="mt-1 text-[11px] text-emerald-800">{ui("Management has not set this target.")}</p>}</div>)}<p className="whitespace-pre-wrap text-xs leading-5 text-emerald-900">{employee?.bonus_plan || ui("Your verified customer acquisitions and approved supplies support bonus review.")}</p><p className="text-[11px] leading-5 text-emerald-800">{ui("Bonus eligibility and payments follow the agreed plan and management approval.")}</p></section>;
}
