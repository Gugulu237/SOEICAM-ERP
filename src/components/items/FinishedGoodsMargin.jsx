import React from 'react';
import {ui} from '@/lib/i18n';
import {formatNumber,formatXAF} from '@/lib/formatters';

export default function FinishedGoodsMargin({value,compact=false}){
 if(!value)return null;
 const available=value.status==='available',percentage=available?formatNumber(value.gross_margin_percent,1)+'%':ui('Not available');
 const tone=available?(value.gross_margin_percent<0?'text-red-700':'text-green-800'):'text-slate-500';
 if(compact)return <span data-finished-goods-margin className={'mt-1 block text-[11px] font-semibold leading-4 tabular-nums '+tone}>{ui('Gross margin')}: {percentage}</span>;
 const entries=[['Sales price',value.selling_price>0?formatXAF(value.selling_price):ui('Not available')],['Production cost / unit',value.production_unit_cost>0?formatXAF(value.production_unit_cost):ui('Not available')],['Gross profit / unit',available?formatXAF(value.gross_profit_per_unit):ui('Not available')],['Gross margin',percentage]];
 return <section data-finished-goods-margin className="space-y-2 rounded-xl border bg-white p-3"><h3 className="text-sm font-semibold">{ui('Finished product margin')}</h3><dl className="space-y-2 text-xs">{entries.map(([label,text])=><div key={label} className="flex items-start justify-between gap-3"><dt className="text-slate-500">{ui(label)}</dt><dd className={'break-words text-right font-semibold tabular-nums '+(label==='Gross margin'?tone:'')}>{text}</dd></div>)}</dl>{value.production_unit_cost>0&&<p className="text-[11px] text-slate-500">{ui(value.cost_basis==='company_stock'?'Cost basis: average carrying cost of company stock.':'Cost basis: registered unit cost; no valued company stock is on hand.')}</p>}<p className="text-[11px] leading-4 text-slate-500">{ui('Based on the current catalogue price and production cost, before operating expenses. Actual sales margins may differ with discounts and the batches sold.')}</p>{!available&&<p className="text-[11px] text-amber-800">{ui(value.status==='invalid_stock'?'Review the stock quantities and carrying values to calculate a reliable margin.':value.status==='missing_price'?'Record a selling price to calculate this margin.':'Record a production cost to calculate this margin.')}</p>}</section>;
}
