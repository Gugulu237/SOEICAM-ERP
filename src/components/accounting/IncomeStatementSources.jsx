import React, { useMemo } from 'react';
import { ui, uiMessage } from '@/lib/i18n';
import { formatDate, formatXAF } from '@/lib/formatters';
import { incomeStatementSources } from '@/lib/income-statement-sources';
import { Link } from '@/lib/router';

const modules = {
  sales: 'Sales', field_sales: 'Field sales', manufacturing: 'Manufacturing', inventory_adjustment: 'Inventory adjustments', inventory_audit: 'Inventory counts',
  opening_balances: 'Opening balances', accounting_corrections: 'Accounting corrections', manual: 'Manual journals', degustation: 'Degustations',
  assets: 'Assets', procurement: 'Purchases', payments: 'Payments', cashier: 'Cashier', payroll: 'Payroll', recurring_expenses: 'Recurring expenses',
};

export default function IncomeStatementSources(props) {
  const { accounts, activity, journalsById, lines, fromDate, toDate, canCorrectSetup = false } = props;
  const detail = useMemo(() => {
    try { return { rows: incomeStatementSources({ accounts, activity, journalsById, lines, fromDate, toDate }) }; }
    catch (error) { return { rows: [], error: error.message }; }
  }, [accounts, activity, journalsById, lines, fromDate, toDate]);
  return <details className="mt-6 border-t border-slate-200 pt-4 print:hidden">
    <summary className="cursor-pointer text-sm font-semibold text-green-800">{ui('Review income statement entries')}</summary>
    <p className="mt-2 text-xs text-slate-500">{ui('Review the journals behind each account total for the selected dates. Source labels describe the recorded entries and do not verify their accounting treatment.')}</p>
    {canCorrectSetup && <Link className="mt-3 inline-block text-xs font-semibold text-green-800 underline" to="/accounting?tab=journals#setup-stock-corrections">{ui('Correct setup inventory entries')}</Link>}
    {detail.error ? <p role="alert" className="mt-3 text-sm text-red-700">{uiMessage(detail.error)}</p> : !detail.rows.length ? <p className="mt-3 text-sm text-slate-500">{ui('No income statement entries in this period.')}</p> : <div className="mt-3 space-y-3">{detail.rows.map(account => <details key={account.account_id} className="min-w-0 rounded-lg border bg-white p-3">
      <summary className="cursor-pointer text-sm font-medium"><span>{account.account_number} · {account.name}</span><span className="ml-3 inline-block font-semibold tabular-nums">{formatXAF(account.amount)}</span></summary>
      <div className="mt-3 space-y-3">{account.sources.map(source => <details key={source.key} className="min-w-0 rounded-lg bg-slate-50 p-3">
        <summary className="cursor-pointer text-xs font-medium"><span>{ui(modules[source.source_module] || 'Other journal sources')}{source.source_document_type ? ' / ' + source.source_document_type : ''}</span><span className="ml-3 inline-block font-semibold tabular-nums">{formatXAF(source.amount)}</span></summary>
        <div className="mt-3 space-y-3">{source.journals.map(journal => <article key={journal.id} className="min-w-0 rounded-lg border bg-white p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2"><Link className="font-semibold text-green-800 underline" to={'/accounting/journals/' + encodeURIComponent(journal.id)}>{journal.journal_number || journal.id}</Link><span>{formatDate(journal.date)}</span></div>
          {journal.description && <p className="mt-2 break-words text-slate-700">{journal.description}</p>}
          {journal.source_document_id && <p className="mt-1 break-all text-slate-500">{ui('Source reference')}: {journal.source_document_id}</p>}
          {(journal.reversal_of || journal.reversed_by_journal || journal.status === 'reversed') && <p className="mt-2 font-medium text-amber-800">{ui(journal.reversal_of ? 'Reversal journal' : 'Original journal with reversal')}</p>}
          <dl className="mt-3 grid gap-2 tabular-nums sm:grid-cols-3"><div className="flex justify-between gap-2 sm:block"><dt className="text-slate-500">{ui('Debit')}</dt><dd className="sm:mt-1">{formatXAF(journal.debit)}</dd></div><div className="flex justify-between gap-2 sm:block"><dt className="text-slate-500">{ui('Credit')}</dt><dd className="sm:mt-1">{formatXAF(journal.credit)}</dd></div><div className="flex justify-between gap-2 sm:block"><dt className="text-slate-500">{ui('Report amount')}</dt><dd className="font-semibold sm:mt-1">{formatXAF(journal.amount)}</dd></div></dl>
        </article>)}</div>
      </details>)}</div>
    </details>)}</div>}
  </details>;
}
