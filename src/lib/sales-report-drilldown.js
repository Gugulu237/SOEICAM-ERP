export const discountBasisLabel=value=>({including_tax:'Includes tax',excluding_tax:'Excludes tax',mixed:'Mixed saved bases'})[value]||'Not recorded';
const money=label=>({label,type:'money'});
const cents=value=>{const number=Number(value||0),result=Math.round(number*100);if(!Number.isFinite(number)||!Number.isSafeInteger(result))throw Error('The sales report contains an unsupported amount.');return BigInt(result);};
const amount=value=>{if(value>BigInt(Number.MAX_SAFE_INTEGER)||value< -BigInt(Number.MAX_SAFE_INTEGER))throw Error('The sales report total exceeds the supported precision.');return Number(value)/100||0;};
const metricCents=(row,metric)=>metric==='credit'?cents(row.total)-cents(row.collected):cents(row[metric]);
export const salesMetric=(row,metric='total')=>amount(metricCents(row,metric));
export const salesMetricTotal=(rows,metric='total')=>amount(rows.reduce((sum,row)=>sum+metricCents(row,metric),0n));
export function salesReportGroups(rows,kind){
 const groups=new Map();
 for(const row of rows){const key=kind==='daily'?row.date:kind==='customers'?row.customer_id||'name:'+row.customer_name:row.commercial_id||'name:'+(row.commercial_name||'Factory / company'),label=kind==='daily'?row.date:kind==='customers'?row.customer_name||'Not recorded':row.commercial_name||'Factory / company';
  const group=groups.get(key)||{id:String(key),label,kind,count:0,sales_count:0,reversal_count:0,subtotal:0n,tax:0n,total:0n,collected:0n,credit:0n};group.count++;group.sales_count+=row.is_reversal?0:1;group.reversal_count+=row.is_reversal?1:0;for(const metric of ['subtotal','tax','total','collected','credit'])group[metric]+=metricCents(row,metric);groups.set(key,group);
 }
 return [...groups.values()].map(group=>({...group,...Object.fromEntries(['subtotal','tax','total','collected','credit'].map(metric=>[metric,amount(group[metric])]))})).sort((a,b)=>kind==='daily'?String(a.label).localeCompare(String(b.label)):b.total-a.total||String(a.label).localeCompare(String(b.label)));
}
export function salesDrillRows(data,selection,today){
 const rows=data?.rows||[];
 if(!selection)return [];
 if(selection.kind==='products')return (data?.product_report?.transactions||[]).filter(row=>row.group_key===selection.key);
 if(selection.kind==='balances'||selection.kind==='overdue')return (data?.overview?.pending||[]).filter(row=>selection.kind==='balances'||row.due_date&&row.due_date<today);
 if(selection.kind==='sales')return rows.filter(row=>!row.is_reversal);
 if(selection.kind==='daily')return rows.filter(row=>row.date===selection.key);
 if(selection.kind==='customers')return rows.filter(row=>(row.customer_id||'name:'+row.customer_name)===selection.key);
 if(selection.kind==='commercials')return rows.filter(row=>(row.commercial_id||'name:'+(row.commercial_name||'Factory / company'))===selection.key);
 if(selection.kind==='transaction')return rows.filter(row=>row.id===selection.key);
 if(['collected','credit','tax','subtotal'].includes(selection.kind))return rows.filter(row=>salesMetric(row,selection.kind)!==0);
 return rows;
}
export function salesSourcePath(row,access={}){
 if(row.invoice_id&&access.open_invoices)return '/sales/invoices/'+encodeURIComponent(row.invoice_id)+'?from=sales';
 if((row.source==='Invoice'||row.source==='Supply invoice')&&access.open_invoices)return '/sales/invoices/'+encodeURIComponent(row.document_id||row.invoice_id||row.id)+'?from=sales';
 if((row.source==='Commercial supply'||row.source==='Uninvoiced supply')&&access.open_field_sales)return '/field-review/'+encodeURIComponent(row.document_id||row.field_sale_id);
 if(row.sales_order_id&&access.open_orders)return '/sales/'+encodeURIComponent(row.sales_order_id);
 return '';
}
export function salesTransactionsDocument(rows,period,{title='Sales transactions',metric='total',product=false,currentBalances=false}={}){
 const vatColumn=rows.some(row=>row.vat_correction_journal_number)?[{key:'vat_correction_journal_number',label:'VAT correction journal'}]:[];
 const columns=[{key:'date',label:'Date'},{key:'document_number',label:'Source document'},{key:'customer_name',label:'Customer'},{key:'commercial_name',label:'Salesperson'},{key:'journal_number',label:'Posted journal'},...vatColumn,...(product?[{key:'product_name',label:'Product'},{key:'unit',label:'Saved unit'},{key:'quantity',label:'Net sold quantity'},{key:'discount',label:'Recorded discount',exportType:'money'},{key:'discount_basis',label:'Discount basis'}]:[]),...(!currentBalances?[{key:'subtotal',label:'Revenue excluding tax',exportType:'money'},{key:'tax',label:'Tax',exportType:'money'},{key:'total',label:'Revenue including tax',exportType:'money'}]:[]),{key:'contribution',label:currentBalances?'Current amount due':metric==='collected'?'Cash at sale':metric==='credit'?'Credit at sale':metric==='tax'?'Tax':metric==='subtotal'?'Revenue excluding tax':'Revenue including tax',exportType:'money'},{key:'status',label:'Type'}];
 const data=rows.map(row=>({...row,contribution:salesMetric(row,metric),status:row.is_reversal?'Reversal':'Sale'}));
 return {title,metadata:currentBalances?[['Basis','Current unpaid balances · all dates']]:[['From',period.from],['To',period.to]],notes:['Only matching posted source journals are included. Later cash collections are not new sales.','Financial reversals reduce quantities and revenue on their recorded correction date. Free replacements, tasting and stock-only returns are not sales.','Product quantities stay separate by their exact saved unit. Recorded discount is informational and is already reflected in revenue. Missing historical discount is blank.'],sections:[{title,columns:columns.map(column=>({label:column.label,type:column.exportType})),rows:data.map(row=>columns.map(column=>column.key==='discount_basis'?discountBasisLabel(row.discount_basis):row[column.key]??''))},{title:'Selected total',columns:['Measure',money('Amount')],rows:[[currentBalances?'Current amount due':columns.find(column=>column.key==='contribution').label,salesMetricTotal(rows,metric)]]}]};
}
export function productSalesDocument(report,period,unit=''){
 const rows=(report?.products||[]).filter(row=>!unit||row.unit===unit);
 const warnings=report?.unverified_vat_corrections?[`Original amounts are shown for ${report.unverified_vat_corrections} VAT corrections that need review.`]:[];
 return {title:'Product sales and demand',metadata:[['From',period.from],['To',period.to],['Quantity basis','Net posted quantity, ranked separately per saved unit'],['Saved unit',unit||'All units · separate ranks']],notes:[...warnings,'Revenue is after recorded discounts. Financial reversals reduce demand and revenue; free replacements, tasting and stock-only returns are excluded.','Do not add quantities across different saved units. Unknown historical product identities or units are not ranked.','Recorded discount can include or exclude tax according to its saved basis; it is not subtracted from revenue again.',...(report?.issues||[]).map(issue=>issue.document_number+': '+issue.reason)],sections:[{title:'Products ranked by net sold quantity within each unit',columns:['Rank','Product','Saved unit','Sold quantity','Reversed quantity','Net sold quantity',money('Recorded discount'),'Discount basis',money('Revenue excluding tax'),money('Tax'),money('Revenue including tax'),'Sale rows','Reversal rows'],rows:rows.map(row=>[row.rank??'',row.product_name,row.unit||'',row.sold_quantity,row.reversed_quantity,row.net_quantity,row.discount??'',discountBasisLabel(row.discount_basis),row.net_revenue,row.tax,row.total_revenue,row.sale_count,row.reversal_count])}]};
}
