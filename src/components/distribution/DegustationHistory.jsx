import React from 'react';
import { ui } from '@/lib/i18n';
import { formatDate, formatQuantity, formatXAF } from '@/lib/formatters';
export default function DegustationHistory({ records = [], costs = false }) {
  return <section className="space-y-3"><h3 className="font-semibold">{ui('Dégustation history')}</h3>{!records.length && <p className="text-sm text-slate-500">{ui('No Dégustation recorded for this period.')}</p>}
    {records.map(record => <article key={record.id} className="rounded-xl border bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{record.customer_name || ui('Giveaways issued')}</strong><span className="text-xs text-slate-500">{formatDate(record.date)} · {record.reference}</span></div>
      <p className="mt-1 text-xs text-slate-500">{record.employee_name}</p><ul className="mt-2 space-y-1 text-sm">{record.lines.map(line => <li key={line.product_id}>{line.product_name} · {formatQuantity(line.quantity)}</li>)}</ul>
      {record.source==='previously_expensed'&&<p className="mt-2 text-xs text-amber-800">{ui('Previously expensed promotional stock — no new expense.')}</p>}
      {record.notes && <p className="mt-2 text-xs text-slate-600">{record.notes}</p>}
      {costs && record.source!=='previously_expensed' && <p className="mt-2 text-sm font-medium">{ui('Marketing expense')}: {formatXAF(record.cost)}{record.journal_number ? ' · ' + record.journal_number : ''}</p>}
    </article>)}
  </section>;
}
