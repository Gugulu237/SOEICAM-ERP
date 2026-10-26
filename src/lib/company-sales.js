import {isOpeningRecord} from './opening-records.js';
import { roundMoney } from './field-pos.js';

export const postedInvoiceStatuses = ['posted', 'partially_paid', 'paid', 'overdue'];
const posted = row => typeof row.journal_id === 'string' && Boolean(row.journal_id.trim());

// One posted document is one sale. Loading, drafts, exchanges and cash handover
// are never sales; displaying a field supply does not create another invoice.
export function companySalesRegister({ invoices = [], fieldSales = [], from, to }) {
  const inPeriod = date => date && date >= from && date <= to;
  const fieldJournals = new Set(fieldSales.filter(row=>row.status==='approved_posted' && posted(row)).map(row=>row.journal_id));
  const rows = [
    ...invoices.filter(row => !isOpeningRecord(row) && !row.field_sale_id && !fieldJournals.has(row.journal_id) && postedInvoiceStatuses.includes(row.status) && posted(row) && inPeriod(row.invoice_date)).map(row => ({
      id: 'invoice:' + row.id, document_id: row.id, document_number: row.invoice_number || row.id, source: 'Invoice', date: row.invoice_date,
      customer_id:row.customer_id,customer_name: row.customer_name, commercial_id:row.salesperson_id || '',commercial_name: row.salesperson_name || '', payment_type: row.payment_type, status: row.status,
      subtotal: Number(row.subtotal) || 0, tax: Number(row.tax_total) || 0, total: Number(row.total) || 0,
      collected: row.payment_type==='cash'?Number(row.total) || 0:0, balance: row.payment_type==='cash'?0:Number(row.balance) || 0, sales_order_id: row.sales_order_id || '', receipt_count: 0,
    })),
    ...fieldSales.filter(row => row.status === 'approved_posted' && posted(row) && inPeriod(row.transaction_date)).map(row => ({
      id: 'field:' + row.id, document_id: row.id, document_number: row.sale_number || row.id, source: 'Commercial supply', date: row.transaction_date,
      customer_id:row.customer_id,customer_name: row.customer_name, commercial_id:row.commercial_id,commercial_name: row.commercial_name, payment_type: row.payment_type, status: row.status,
      subtotal: Number(row.subtotal) || 0, tax: Number(row.tax_total) || 0, total: Number(row.total) || 0,
      collected: Number(row.amount_collected) || 0, balance: Number(row.amount_due) || 0, receipt_count: row.receipt_file_uris?.length || 0, invoice_id:row.invoice_id || '',
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.document_number.localeCompare(a.document_number));
  const sum = key => roundMoney(rows.reduce((total, row) => total + row[key], 0));
  return { rows, totals: { count: rows.length, net: sum('subtotal'), tax: sum('tax'), sales: sum('total') } };
}

export function salesOverview({invoices=[],fieldSales=[],from,to,today}) {
  const register=companySalesRegister({invoices,fieldSales,from,to});
  const cash=roundMoney(register.rows.reduce((sum,row)=>sum+row.collected,0));
  const linked=new Map(invoices.filter(i=>i.field_sale_id && postedInvoiceStatuses.includes(i.status)).map(i=>[i.field_sale_id,i]));
  const fieldJournals=new Set(fieldSales.map(s=>s.journal_id).filter(Boolean));
  const pending=[...invoices.filter(i=>!i.field_sale_id && !fieldJournals.has(i.journal_id) && postedInvoiceStatuses.includes(i.status) && posted(i) && i.payment_type!=='cash' && Number(i.balance)>0).map(i=>({id:i.id,invoice_id:i.id,document_number:i.invoice_number,customer_name:i.customer_name,date:i.invoice_date,due_date:i.due_date,balance:roundMoney(i.balance),source:'Invoice'})),...fieldSales.filter(s=>s.status==='approved_posted' && posted(s) && Number(s.amount_due)>0).map(s=>({id:'field:'+s.id,invoice_id:linked.get(s.id)?.id || '',field_sale_id:s.id,document_number:linked.get(s.id)?.invoice_number || s.sale_number,customer_name:s.customer_name,date:s.transaction_date,due_date:s.due_date,balance:roundMoney(s.amount_due),source:linked.has(s.id)?'Supply invoice':'Uninvoiced supply'}))].sort((a,b)=>String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
  const daily=[];
  for(let time=Date.parse(from+'T00:00:00Z');time<=Date.parse(to+'T00:00:00Z');time+=86400000){const date=new Date(time).toISOString().slice(0,10);daily.push({date,cash:0,credit:0,total:0,count:0});}
  const byDate=new Map(daily.map(d=>[d.date,d]));
  for(const row of register.rows){const day=byDate.get(row.date);if(!day)continue;day.cash=roundMoney(day.cash+row.collected);day.credit=roundMoney(day.credit+row.total-row.collected);day.total=roundMoney(day.total+row.total);day.count++;}
  return {cash_sales:cash,credit_sales:roundMoney(register.totals.sales-cash),pending_amount:roundMoney(pending.reduce((sum,i)=>sum+i.balance,0)),pending_count:pending.length,overdue_amount:roundMoney(pending.filter(i=>i.due_date && i.due_date<today).reduce((sum,i)=>sum+i.balance,0)),pending,daily};
}

export function salesChartBuckets(daily,group='day') {
  const buckets=new Map();
  for(const row of daily){let key=row.date;if(group==='month')key=row.date.slice(0,7)+'-01';if(group==='week'){const d=new Date(row.date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));key=d.toISOString().slice(0,10);}const bucket=buckets.get(key) || {date:key,cash:0,credit:0,total:0,count:0};for(const field of ['cash','credit','total','count'])bucket[field]=roundMoney(bucket[field]+row[field]);buckets.set(key,bucket);}
  return [...buckets.values()];
}
