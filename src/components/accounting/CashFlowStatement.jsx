'use client';

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {CalendarDays, CheckCircle2, ChevronDown, RefreshCw, TriangleAlert} from 'lucide-react';
import {erp} from '@/api/erpClient';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import ReportExport from '@/components/shared/ReportExport';
import {businessDate} from '@/lib/business-date';
import {cashFlowLabel, cashFlowRowLabel, cashFlowOfficialRows} from '@/lib/cash-flow-display';
import {getCashFlowPeriod} from '@/lib/cash-flow-period';
import {cashFlowExportDocument} from '@/lib/cash-flow-export';
import {unpackCashFlowReport} from '@/lib/cash-flow-wire';
import {formatAccountingXAF as money} from '@/lib/formatters';
import {uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import CashFlowTraceDialog from './CashFlowTraceDialog';

const presets = ['today', 'week', 'month', 'previousMonth', 'quarter', 'year', 'previousYear', 'custom'];
const flowKeys = ['operating','investing','equity','debt'];
const cards = ['opening','operating','investing','financing','closing'];
const cardCodes = {opening:'ZA',operating:'ZB',investing:'ZC',financing:'ZF',closing:'ZH'};
const selectClass = 'h-10 w-full rounded-md border border-input bg-white px-3 text-sm';
const sectionOf = (period, key) => period.direct.sections.find(section => section.key === key);
const categoryTraces = rows => rows.flatMap(row => row.traces || []);
const tracesOf = (period, key) => {
  const direct = period.direct;
  if (key === 'opening') return direct.openingTraces;
  if (key === 'closing') return direct.closingTraces;
  if (key === 'calculatedClosing') return [...direct.openingTraces, ...tracesOf(period,'net')];
  const included = key === 'net' ? flowKeys : key === 'financing' ? ['equity','debt'] : [key];
  return direct.sections.filter(section => included.includes(section.key)).flatMap(section => categoryTraces(section.rows));
};
const languageText = language => (en, fr) => language === 'fr' ? fr : en;

// Subtract signed contributions per journal. Matching history cancels out so
// an accountant can open exactly the journals causing a closing difference.
function discrepancyTraces(ledger, calculated) {
  const byJournal = new Map();
  for (const [rows,sign] of [[ledger,1],[calculated,-1]]) for (const row of rows) {
    const previous = byJournal.get(row.journalId), delta = sign*Math.round(row.amount*100);
    if (previous) previous.cents += delta;
    else byJournal.set(row.journalId,{row,cents:delta});
  }
  return [...byJournal.values()].filter(entry=>entry.cents).map(({row,cents})=>({...row,amount:cents/100}));
}

function Amount({title, value, onOpen, className = '', language}) {
  const label = language === 'fr' ? 'Voir les écritures pour ' : 'View journal entries for ';
  const activate = event => { event?.preventDefault?.(); event?.stopPropagation?.(); onOpen(); };
  return <button type="button" aria-haspopup="dialog" aria-label={label + title} data-cashflow-amount={title}
    className={'min-h-9 max-w-full rounded px-1 text-right font-semibold tabular-nums underline decoration-dotted decoration-current/30 underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary ' + className}
    onClick={activate} onDoubleClick={activate}>{money(value)}</button>;
}

function ModeSwitch({view, setView, language}) {
  return <div role="group" aria-label={languageText(language)('Report view', 'Vue du tableau')} className="inline-flex rounded-xl border bg-slate-50 p-1">
    {['management','official'].map(key => <button type="button" key={key} aria-pressed={view === key}
      className={'min-h-10 rounded-lg px-4 text-sm font-medium ' + (view === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}
      onClick={() => setView(key)}>{cashFlowLabel(key,language)}</button>)}
  </div>;
}

function PeriodIndicators({current, comparison, view, language, open}) {
  const pick = (period, key) => {
    const line = view === 'official' ? period.official.lines.find(row => row.code === cardCodes[key]) : null;
    return line ? {value:line.amount, traces:line.traces} : {value:period.direct[key], traces:tracesOf(period,key)};
  };
  return <div data-cashflow-summary className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
    {cards.map(key => {
      const title = cashFlowLabel(key,language), item = pick(current,key), previous = comparison && pick(comparison,key);
      return <article key={key} className={'min-w-0 rounded-xl border p-3 sm:p-4 ' +
        (key === 'closing' ? 'col-span-2 border-emerald-200 bg-emerald-50 sm:col-span-1' : 'bg-white')}>
        <p className="text-xs font-medium leading-snug text-slate-600">{title}</p>
        <Amount title={title} value={item.value} onOpen={() => open(current,title,item.value,item.traces)} language={language} className="mt-1 !px-0 text-left text-base sm:text-lg"/>
        {previous && <div className="flex flex-wrap items-center gap-x-1 text-xs text-slate-600"><span>N−1</span>
          <Amount title={'N−1 · '+title} value={previous.value} language={language}
            onOpen={() => open(comparison,'N−1 · '+title,previous.value,previous.traces)}/></div>}
      </article>;
    })}
  </div>;
}

function StatementTotal({id, letter, current, comparison, language, open}) {
  const title = cashFlowLabel(id,language);
  const value = period => <Amount title={title} value={period.direct[id]} language={language}
    onOpen={() => open(period,title,period.direct[id],tracesOf(period,id))}/>;
  return <div className={'flex flex-wrap items-center justify-between gap-x-3 rounded-xl border p-3 sm:px-4 ' +
    (id === 'closing' ? 'border-emerald-200 bg-emerald-50' : 'bg-white')}>
    <h3 className="text-sm font-semibold"><span className="mr-2 text-slate-500">{letter}.</span>{title}</h3>
    <div className="text-right">{value(current)}
      {comparison && <p className="text-xs text-slate-600">N−1 {value(comparison)}</p>}</div>
  </div>;
}

function FlowBreakdown({scope, period, language, open, showAll = false}) {
  const t = languageText(language);
  const groups = scope === 'financing' ? period.direct.sections.filter(row=>['equity','debt'].includes(row.key)) : [sectionOf(period,scope)].filter(Boolean);
  const rows = groups.flatMap(group=>group.rows);
  const title = cashFlowLabel(scope,language);
  const byKind = (item, name, kind, traces) => {
    const value = item[kind], label = name + ' · ' + cashFlowLabel(kind === 'net' ? 'movement' : kind,language);
    return <Amount title={kind === 'net' ? name : label} value={value} language={language}
      onOpen={() => open(period,label,value,kind === 'inflow' ? traces.filter(row=>row.amount>0) : kind === 'outflow' ? traces.filter(row=>row.amount<0) : traces)} />;
  };
  const sums = (key) => groups.reduce((total,group) => total + Math.round(group[key]*100),0)/100;
  return <>
    <dl className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-3 min-[390px]:grid-cols-3">
      {['inflow','outflow','net'].map(kind => <div key={kind} className="min-w-0">
        <dt className="text-xs text-slate-600">{cashFlowLabel(kind==='net'?'movement':kind,language)}</dt>
        <dd className="text-sm">{byKind({[kind]:sums(kind)},title,kind,categoryTraces(rows))}</dd>
      </div>)}
    </dl>
    {showAll && groups.map(group => <div key={group.key} className="mt-2">
      {scope === 'financing' && <div className="flex items-center justify-between gap-3 border-b py-1 text-sm font-semibold">
        <h4>{cashFlowLabel(group.key,language)}</h4>{byKind(group,cashFlowLabel(group.key,language),'net',categoryTraces(group.rows))}
      </div>}
      {group.rows.length ? group.rows.map(row => <div key={row.key} className="flex flex-wrap items-center justify-between gap-x-3 border-b border-slate-100 py-1.5 text-sm">
        <span>{cashFlowRowLabel(row,language)}</span>
        <div className="flex flex-wrap items-center gap-x-2">
          {row.inflow > 0 && row.outflow < 0 && ['inflow','outflow'].map(kind=><span key={kind} className="text-xs text-slate-600">{cashFlowLabel(kind,language)} {byKind(row,cashFlowRowLabel(row,language),kind,row.traces)}</span>)}
          {byKind(row,cashFlowRowLabel(row,language),'net',row.traces)}
        </div>
      </div>) : <p className="p-2 text-sm text-slate-500">{t('No cash movements.', 'Aucun mouvement de trésorerie.')}</p>}
    </div>)}
  </>;
}

function ManagementView({current, comparison, language, open}) {
  const common = {current,comparison,language,open};
  return <section aria-label={cashFlowLabel('management',language)} className="space-y-2">
    <StatementTotal id="opening" letter="A" {...common}/>
    {[['B','operating'],['C','investing'],['D','financing']].map(([letter,key])=><details key={key} data-cashflow-section={key} className="group rounded-xl border bg-white">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-1 sm:px-4">
        <ChevronDown size={16} aria-hidden className="shrink-0 text-slate-500 transition-transform group-open:rotate-180"/>
        <span className="flex-1 text-sm font-semibold"><span className="mr-2 text-slate-500">{letter}.</span>{cashFlowLabel(key,language)}</span>
        <Amount title={cashFlowLabel(key,language)} value={current.direct[key]} language={language}
          onOpen={()=>open(current,cashFlowLabel(key,language),current.direct[key],tracesOf(current,key))}/>
      </summary>
      <div className="border-t p-3 sm:p-4">
        {comparison && <p className="mb-2 text-xs font-semibold">N · {current.from} – {current.to}</p>}
        <FlowBreakdown scope={key} period={current} language={language} open={open} showAll/>
        {comparison && <div className="mt-3 border-t pt-3"><p className="mb-2 text-xs font-semibold">N−1 · {comparison.from} – {comparison.to}</p>
          <FlowBreakdown scope={key} period={comparison} language={language} open={open} showAll/></div>}
      </div>
    </details>)}
    <StatementTotal id="net" letter="E" {...common}/>
    <StatementTotal id="closing" letter="F" {...common}/>
  </section>;
}

function OfficialView({current, comparison, language, open}) {
  const t = languageText(language), lines = cashFlowOfficialRows(current.official.lines);
  const previous = new Map((comparison ? cashFlowOfficialRows(comparison.official.lines) : []).map(row=>[row.key,row]));
  const cell = (period,row) => {
    const title = [row.code,cashFlowRowLabel(row,language)].filter(Boolean).join(' · ');
    return <Amount title={title} value={row.amount} language={language} onOpen={()=>open(period,title,row.amount,row.traces)}/>;
  };
  return <section data-cashflow-official className="rounded-xl border bg-white">
    <div className="border-b p-4"><h3 className="font-semibold">{t('SYSCOHADA statement of cash flows','Tableau des flux de trésorerie SYSCOHADA')}</h3>
      <p className="mt-1 text-xs text-slate-600">{t('Indirect method · operating capacity and changes in working capital','Méthode indirecte · capacité d’autofinancement et variations du besoin de financement')}</p>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="bg-slate-50 text-xs text-slate-600"><tr><th scope="col" className="p-2 text-left sm:pl-4">{t('Code','Réf.')}</th>
        <th scope="col" className="min-w-32 p-2 text-left">{t('Line','Libellé')}</th><th scope="col" className="p-1 text-center">{t('Note','Note')}</th>
        {[['N',current],...(comparison?[['N−1',comparison]]:[])].map(([label,period])=><th scope="col" key={label} className="p-2 text-right">{label}<span className="block whitespace-nowrap text-[10px] font-normal">{period.from}<br/>{period.to}</span></th>)}</tr></thead>
      <tbody>{lines.map(row=><tr key={row.key} data-cashflow-line={row.key}
        className={'border-t '+(row.code === 'ZH' ? 'bg-emerald-50 font-bold' : row.code.startsWith('Z') ? 'bg-slate-50 font-semibold':'')}>
        <td className="p-2 font-mono text-xs sm:pl-4">{row.code}</td><th scope="row" className="p-2 text-left font-[inherit]">{cashFlowRowLabel(row,language)}</th>
        <td className="p-1 text-center font-mono text-xs">{row.note}</td>
        <td className="p-1 text-right">{cell(current,row)}</td>{comparison && <td className="p-1 text-right">{previous.has(row.key)?cell(comparison,previous.get(row.key)):'—'}</td>}
      </tr>)}</tbody>
    </table></div>
  </section>;
}

function Controls({period, language, open}) {
  const t = languageText(language), direct = period.direct, issues = period.issues || [];
  const costs = (name, value, traces) => <Amount title={name} value={value} language={language} onOpen={()=>open(period,name,value,traces)}/>;
  const line = code => period.official.lines.find(row=>row.code === code);
  const closing = line('ZH');
  const differences = [
    [cashFlowLabel('management',language), direct.difference, ()=>tracesOf(period,'calculatedClosing')],
    ['SYSCOHADA', period.official.difference, ()=>closing.traces],
  ];
  return <div className="space-y-3">
    <div className="grid gap-2 sm:grid-cols-3">
      {[[cashFlowLabel('calculatedClosing',language),direct.calculatedClosing,tracesOf(period,'calculatedClosing')],
        [t('Ledger closing treasury','Trésorerie de clôture au grand livre'),direct.closing,direct.closingTraces],
        [t('Indirect-method closing cash','Clôture selon la méthode indirecte'),closing?.amount,closing?.traces]]
        .map(([name,value,traces])=><div key={name} className="rounded-lg bg-slate-50 p-2"><p className="text-xs text-slate-600">{name}</p>
          {value != null ? costs(name,value,traces) : '—'}</div>)}
    </div>
    <div className="text-sm"><p>{t('Ledger balance less calculated closing cash','Clôture du grand livre moins la clôture calculée')}:
      {differences.map(([name,value,rows])=>{
        const title=t('Difference','Écart')+' · '+name;
        return <span key={name} className="ml-2 whitespace-nowrap">{name} <Amount title={title} value={value}
          language={language} onOpen={()=>open(period,title,value,discrepancyTraces(direct.closingTraces,rows()))}/></span>;
      })}</p></div>
    {issues.length > 0 && <ul className="divide-y rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm">
      {issues.map((issue,i)=>{
        const title = language === 'fr' ? issue.messageFr || uiMessage(issue.message) : issue.message;
        return <li key={i} className="py-2"><span>{title}</span>
          {issue.amount != null && <span className="ml-1 tabular-nums">({money(issue.amount)})</span>}
          {!!issue.traces?.length && <button type="button" aria-haspopup="dialog" className="ml-2 min-h-9 text-primary underline"
            onClick={()=>open(period,title,issue.amount,issue.traces)}>{t('Review entries','Vérifier les écritures')}</button>}</li>;
      })}
    </ul>}
    <h4 className="text-sm font-semibold">{t('Cash account reconciliation','Rapprochement des comptes de trésorerie')}</h4>
    <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs">
      <tr><th className="p-2">{t('Treasury account','Compte de trésorerie')}</th><th className="p-2 text-right">{t('Opening','Ouverture')}</th><th className="p-2 text-right">{t('Closing','Clôture')}</th></tr></thead>
      <tbody>{direct.components.map(account=><tr key={account.accountId} className="border-t">
        <th scope="row" className="p-2 font-normal">{account.number} · {account.name}</th>
        <td className="p-1 text-right">{costs(account.name+' · '+cashFlowLabel('opening',language),account.opening,account.openingTraces)}</td>
        <td className="p-1 text-right">{costs(account.name+' · '+cashFlowLabel('closing',language),account.closing,account.closingTraces)}</td></tr>)}</tbody>
    </table></div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>{t('Internal transfers excluded from flows','Virements internes exclus des flux')}</span>
      {costs(t('Internal transfers','Virements internes'),direct.internalTransfers,direct.transferTraces)}
    </div>
    <button type="button" className="min-h-10 text-sm font-medium text-primary underline underline-offset-2"
      onClick={()=>open(period,t('Period treasury entries','Écritures de trésorerie de la période'),
        (Math.round(direct.closing*100)-Math.round(direct.opening*100))/100,
        direct.closingTraces.filter(row=>row.date>=period.from && row.date<=period.to))}>
      {t('Browse treasury entries for this period','Parcourir les écritures de trésorerie de la période')}
    </button>
  </div>;
}

function Reconciliation({current, comparison, language, open}) {
  const t = languageText(language), reconciled = current.reconciled && (!comparison || comparison.reconciled);
  return <details id="cashflow-reconciliation" data-cashflow-reconciliation key={current.from+current.to+String(reconciled)} open={reconciled ? undefined : true}
    className={'rounded-xl border '+(reconciled ? 'bg-white' : 'border-amber-300 bg-amber-50/40')}>
    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold sm:px-4">
      {reconciled ? <CheckCircle2 size={17} aria-hidden className="text-emerald-700"/> : <TriangleAlert size={17} aria-hidden className="text-amber-700"/>}
      {reconciled ? t('Treasury reconciled','Trésorerie rapprochée') : t('Reconciliation requires review','Rapprochement à vérifier')}
      <ChevronDown size={16} aria-hidden className="ml-auto"/>
    </summary>
    <div className="space-y-4 border-t p-3 sm:p-4">{[current,comparison].filter(Boolean).map((period,i)=><div key={i}>
      {comparison && <h3 className="mb-2 text-sm font-semibold">{i?'N−1':'N'} · {period.from} – {period.to}</h3>}
      <Controls period={period} language={language} open={open}/>
    </div>)}</div>
  </details>;
}

export default function CashFlowStatement() {
  const language = useLocaleRender() || 'en', t = languageText(language);
  const initial = useMemo(() => getCashFlowPeriod('month',businessDate()), []);
  const [preset,setPreset] = useState('month'), [range,setRange] = useState(initial), [compare,setCompare] = useState(false);
  const [view,setView] = useState('management'), [report,setReport] = useState(null), [error,setError] = useState(''), [loading,setLoading] = useState(true);
  const [detail,setDetail] = useState(null);
  const request = useRef(0);
  const run = useCallback(async (dates, comparePeriods) => {
    const generation = ++request.current;
    setDetail(null); setLoading(true); setError('');
    try {
      const response = await erp.functions.invoke('fieldOps',{action:'cashFlowReport',from:dates.from,to:dates.to,compare:comparePeriods,compactTraces:true});
      if(generation !== request.current) return;
      const data = unpackCashFlowReport(response.data);
      if (!data?.current?.direct || !Array.isArray(data.current.official?.lines) ||
          data.current.from !== dates.from || data.current.to !== dates.to ||
          Boolean(data.comparison) !== comparePeriods) throw new Error('Cash flow could not be loaded');
      setReport(data);
    } catch (cause) {
      if(generation === request.current) {setReport(null);setError(cause?.message || 'Cash flow could not be loaded');}
    } finally {if(generation === request.current) setLoading(false);}
  },[]);
  useEffect(()=>{run(initial,false);return()=>{request.current++;};},[initial,run]);
  const current = report?.current, comparison = report?.comparison;
  const changed = current && (range.from !== current.from || range.to !== current.to || compare !== Boolean(comparison));
  const invalid = !range.from || !range.to || range.from > range.to;
  const open = (period,title,value,traces) => setDetail({from:period.from,to:period.to,title,amount:value,traces:traces || []});
  const common = {current, comparison, language, open};
  function choosePreset(key) {
    setPreset(key);
    if(key !== 'custom') {
      const next = getCashFlowPeriod(key,businessDate());
      setRange(next); run(next,compare);
    }
  }
  function toggleCompare(next) {
    setCompare(next);
    const dates = preset === 'custom' && changed && current ? current : range;
    if(dates.from && dates.to && dates.from <= dates.to) run(dates,next);
  }
  return <div className="space-y-4">
    <form data-statement-export onSubmit={event=>{event.preventDefault();if(!invalid) run(range,compare);}}
      className="space-y-3 rounded-xl border bg-white p-3 sm:p-4 print:hidden">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-44 flex-1 sm:max-w-64">
          <Label htmlFor="cashflow-preset">{t('Reporting period','Période du rapport')}</Label>
          <select id="cashflow-preset" className={selectClass} value={preset} onChange={e=>choosePreset(e.target.value)}>
            {presets.map(key=><option key={key} value={key}>{cashFlowLabel(key,language)}</option>)}
          </select>
        </div>
        {preset === 'custom' && <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:w-auto">
          <div className="min-w-0"><Label htmlFor="cashflow-from">{t('From','Du')}</Label>
            <Input id="cashflow-from" type="date" required value={range.from} max={range.to || undefined}
              onChange={event=>setRange({...range,from:event.target.value})}/></div>
          <div className="min-w-0"><Label htmlFor="cashflow-to">{t('To','Au')}</Label>
            <Input id="cashflow-to" type="date" required value={range.to} min={range.from || undefined}
              onChange={event=>setRange({...range,to:event.target.value})}/></div>
        </div>}
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm" htmlFor="cashflow-compare">
          <input id="cashflow-compare" type="checkbox" checked={compare} onChange={event=>toggleCompare(event.target.checked)}/>
          {t('Compare with prior year','Comparer avec l’année précédente')}
        </label>
        <Button type="submit" variant="outline" disabled={loading || invalid}>
          <RefreshCw size={15} aria-hidden className={'mr-2 '+(loading?'animate-spin':'')}/>{t('Run cash flow','Actualiser les flux')}
        </Button>
      </div>
      {invalid && <p role="alert" className="text-sm text-amber-800">{t('Choose a valid date range.','Choisissez une période valide.')}</p>}
      {changed && !loading && <p className="text-sm text-amber-800">{t('Dates changed. Run cash flow to apply the new period.','Période modifiée. Actualisez les flux pour appliquer les nouvelles dates.')}</p>}
    </form>
    <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
      <ModeSwitch view={view} setView={setView} language={language}/>
      <ReportExport disabled={!current || loading || Boolean(error) || Boolean(changed)}
        getReport={()=>cashFlowExportDocument(report,{view,language})}/>
    </div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{uiMessage(error)}</p>}
    {loading && <p role="status" className="rounded-xl border bg-white p-4 text-sm text-slate-600">{t('Reading posted journals…','Lecture des écritures comptabilisées…')}</p>}
    {current && !loading && !error && <>
      <header>
        <h2 className="text-xl font-semibold">{view === 'official' ? t('SYSCOHADA cash flow statement','Tableau des flux de trésorerie SYSCOHADA') : t('Cash flow statement','Tableau des flux de trésorerie')}</h2>
        <p className="mt-1 flex items-center gap-2 text-sm text-slate-600"><CalendarDays size={15} aria-hidden/>
          <span>{current.from} – {current.to} · FCFA (XAF)</span></p>
        {comparison && <p className="mt-1 text-xs text-slate-600">N−1 · {comparison.from} – {comparison.to}</p>}
      </header>
      {(!current.reconciled || (comparison && !comparison.reconciled)) && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <a className="underline underline-offset-2" href="#cashflow-reconciliation">{t('Review the reconciliation before using this statement.','Vérifiez le rapprochement avant d’utiliser ce tableau.')}</a>
      </p>}
      <PeriodIndicators view={view} {...common}/>
      {view === 'official' ? <OfficialView {...common}/> : <ManagementView {...common}/>}
      <Reconciliation {...common}/>
    </>}
    {detail && <CashFlowTraceDialog detail={detail} language={language} onClose={()=>setDetail(null)}/>}
  </div>;
}
