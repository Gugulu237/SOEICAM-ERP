
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React,{useMemo,useState} from 'react';
import { salesChartBuckets } from '@/lib/company-sales';
import { formatXAF } from '@/lib/formatters';

export default function SalesVolumeChart({daily=[]}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [metric,setMetric]=useState('value'),[group,setGroup]=useState('day'),[table,setTable]=useState(false);
  const rows=useMemo(()=>salesChartBuckets(daily,group),[daily, group]);
  const width=900,height=235,left=68,right=18,top=15,bottom=35,plotWidth=width-left-right,plotHeight=height-top-bottom;
  const max=Math.max(1,...rows.map(r=>metric==='value'?r.total:r.count)),value=r=>metric==='value'?r.total:r.count;
  const x=i=>left+(rows.length<=1?plotWidth/2:i*plotWidth/(rows.length-1)),y=n=>top+plotHeight-(n/max)*plotHeight;
  const points=rows.map((r,i)=>`${x(i)},${y(value(r))}`).join(' ');
  const short=n=>new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(n);
  return <section className="rounded-xl border bg-white p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{ui("Sales over time")}</h3><p className="mt-1 text-xs text-slate-500">{metric==='value'?ui("Posted sales value including tax, in XAF"):ui("Number of posted sales transactions")} · {group==='week'?ui("weeks begin Monday; boundary weeks may be partial"):group==='month'?ui("selected dates within each month"):ui("daily totals, including days without sales")}</p></div><div className="flex flex-wrap gap-2"><select aria-label={ui("Sales chart metric")} className="rounded-md border bg-white p-2 text-xs" value={metric} onChange={e=>setMetric(e.target.value)}><option value="value">{ui("Sales value (XAF)")}</option><option value="count">{ui("Transactions")}</option></select><select aria-label={ui("Sales chart grouping")} className="rounded-md border bg-white p-2 text-xs" value={group} onChange={e=>setGroup(e.target.value)}><option value="day">{ui("Daily")}</option><option value="week">{ui("Weekly")}</option><option value="month">{ui("Monthly")}</option></select><button className="rounded-md border px-3 text-xs" aria-expanded={table} onClick={()=>setTable(v=>!v)}>{table?ui("Hide values"):ui("View values")}</button></div></div>
    {!rows.length?<p className="py-10 text-center text-sm text-slate-500">{ui("Choose dates to view sales.")}</p>:<svg role="img" aria-label={metric==='value'?ui("Sales value in XAF over the selected period"):ui("Sales transaction count over the selected period")} viewBox={`0 0 ${width} ${height}`} className="w-full"><title>{ui("Sales over time")}</title><desc>{rows.length} {group}{ui(" periods, total ")}{metric==='value'?formatXAF(rows.reduce((s,r)=>s+r.total,0)):rows.reduce((s,r)=>s+r.count,0)+' transactions'}.</desc>{[0,.25,.5,.75,1].map(p=><g key={p}><line x1={left} y1={y(max*p)} x2={width-right} y2={y(max*p)} stroke="#e2e8f0"/><text x={left-10} y={y(max*p)+4} textAnchor="end" fontSize="11" fill="#64748b">{short(max*p)}</text></g>)}<polygon points={`${x(0)},${y(0)} ${points} ${x(rows.length-1)},${y(0)}`} fill="#fef3c7"/><polyline points={points} fill="none" stroke="#347623" strokeWidth="2.5"/>{rows.map((r,i)=><g key={r.date}><circle cx={x(i)} cy={y(value(r))} r={rows.length<40?3:1.5} fill="#347623"><title>{r.date}: {metric==='value'?formatXAF(r.total):r.count+' sales'}{ui(" · Cash ")}{formatXAF(r.cash)}{ui(" · Credit ")}{formatXAF(r.credit)}</title></circle>{(i===0 || i===rows.length-1 || i%Math.max(1,Math.ceil(rows.length/7))===0)&&<text x={x(i)} y={height-10} textAnchor="middle" fontSize="11" fill="#64748b">{r.date.slice(5)}</text>}</g>)}</svg>}
    {table&&<div className="mt-4 max-h-64 overflow-auto"><table className="w-full text-xs"><caption className="sr-only">{ui("Sales chart values")}</caption><thead><tr><th className="p-2 text-left">{ui("Period starting")}</th><th className="p-2 text-right">{ui("Cash at sale")}</th><th className="p-2 text-right">{ui("Credit at sale")}</th><th className="p-2 text-right">{ui("Total sales")}</th><th className="p-2 text-right">{ui("Transactions")}</th></tr></thead><tbody>{rows.map(r=><tr key={r.date} className="border-t"><td className="p-2">{r.date}</td>{[r.cash,r.credit,r.total].map((v,i)=><td key={i} className="p-2 text-right">{formatXAF(v)}</td>)}<td className="p-2 text-right">{r.count}</td></tr>)}</tbody></table></div>}
  </section>;
}
