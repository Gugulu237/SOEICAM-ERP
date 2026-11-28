import React, {useState} from 'react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Link} from '@/lib/router';
import {formatAccountingXAF} from '@/lib/formatters';
import {translate} from '@/lib/i18n';

const sourceText = (row, language) => [row.source, row.documentType]
  .filter(Boolean).map(value => translate(String(value).replaceAll('_', ' '), language)).join(' · ');
const pageSize = 50;

// The rows and total are from the exact report clicked, including comparative periods.
// No read or accounting action is needed to open the underlying evidence.
export default function CashFlowTraceDialog({detail, language, onClose}) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const t = (en, fr) => language === 'fr' ? fr : en;
  const query = search.trim().toLocaleLowerCase();
  const filtered = detail.traces.filter(row => !query || [row.date, row.journalNumber, row.reference,
    row.accountName, row.description, row.party, row.source, row.documentType, ...(row.treasuryAccounts || [])]
    .filter(Boolean).join(' ').toLocaleLowerCase().includes(query));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const activePage = Math.min(page, pages);
  const rows = filtered.slice((activePage - 1) * pageSize, activePage * pageSize);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>{detail.title}</DialogTitle>
        <DialogDescription>{detail.from} – {detail.to} · FCFA (XAF)</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm">
        <div>{detail.amount != null && <><p className="text-xs text-slate-600">{t('Statement amount', 'Montant du tableau')}</p>
          <p className="font-semibold tabular-nums">{formatAccountingXAF(detail.amount)}</p></>}
          {detail.traces.some(row=>row.date && row.date<detail.from) && <p className="mt-1 text-xs text-muted-foreground">{t('Includes ledger history before the period.', 'Inclut les écritures antérieures à la période.')}</p>}</div>
        <Input type="search" aria-label={t('Search journal entries', 'Rechercher des écritures')}
          placeholder={t('Search journal, reference or name', 'Rechercher un journal, une référence ou un nom')}
          value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="max-w-sm bg-white"/>
      </div>
      <ol className="divide-y">
        {rows.map((row, index) => <li key={index} className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-x-2 text-sm">
              <time className="text-slate-600">{row.date}</time>
              {row.journalId ? <Link replaceOverlay className="break-all font-semibold text-primary underline underline-offset-2"
                to={'/accounting/journals/' + encodeURIComponent(row.journalId)}>{row.journalNumber || row.journalId}</Link> : null}
              {row.reference && row.reference !== row.journalNumber && <span className="break-all">{row.reference}</span>}
            </div>
            {row.description && <p className="mt-1 break-words text-sm">{row.description}</p>}
            {row.party && <p className="mt-1 break-words text-sm font-medium">{row.party}</p>}
            {[sourceText(row, language), row.accountName, (row.treasuryAccounts || []).join(' · ')].filter(Boolean).map((text,i) =>
              <p key={i} className="mt-1 break-words text-xs text-slate-600">{text}</p>)}
          </div>
          <div className="text-sm font-semibold tabular-nums sm:text-right">{formatAccountingXAF(row.amount)}</div>
        </li>)}
      </ol>
      {!rows.length && <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
        {query ? t('No matching entries.', 'Aucune écriture correspondante.') :
          t('No entries contributed to this amount.', 'Aucune écriture ne contribue à ce montant.')}
      </p>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>{filtered.length} {t('entries', 'écritures')} · {t('Page', 'Page')} {activePage} / {pages}</span>
        {pages > 1 && <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={activePage <= 1} onClick={() => setPage(activePage-1)}>{t('Previous','Précédent')}</Button>
          <Button variant="outline" size="sm" disabled={activePage >= pages} onClick={() => setPage(activePage+1)}>{t('Next','Suivant')}</Button>
        </div>}
      </div>
    </DialogContent>
  </Dialog>;
}
