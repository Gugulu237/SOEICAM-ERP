import {roundMoney} from './field-pos.js';
const money=label=>({label,type:'money'});
const n=value=>{if(value==null || value==='')return 0;const amount=Number(value);if(!Number.isFinite(amount))throw Error('The report contains an invalid amount.');return amount;};
const sum=(rows,key)=>roundMoney(rows.reduce((total,row)=>total+n(row[key]),0));

function salesGroups(rows,kind){
  const groups=new Map();
  for(const row of rows){
    const label=kind==='daily'?row.date:kind==='customers'?row.customer_name:row.commercial_name || 'Factory / company';
    const key=kind==='daily'?row.date:kind==='customers'?row.customer_id || label:row.commercial_id || label;
    const group=groups.get(key)||{label,count:0,net:0,tax:0,total:0,cash:0,credit:0};
    group.count++;group.net+=n(row.subtotal);group.tax+=n(row.tax);group.total+=n(row.total);
    group.cash+=n(row.collected);group.credit+=n(row.total)-n(row.collected);groups.set(key,group);
  }
  return [...groups.values()].sort((a,b)=>kind==='daily'?String(a.label).localeCompare(String(b.label)):b.total-a.total).map(g=>[g.label,g.count,...['net','tax','total','cash','credit'].map(key=>roundMoney(g[key]))]);
}

export function salesAnalysisDocument(data,period,kind='summary'){
  if(!['summary','daily','customers','commercials'].includes(kind))throw Error('Choose a sales report.');
  const title={summary:'Sales summary report',daily:'Daily sales report',customers:'Customer sales report',commercials:'Salesperson sales report'}[kind];
  const rows=data.rows||[],summary={title:'Sales summary',columns:['Measure',money('Amount')],rows:[['Net sales',sum(rows,'subtotal')],['Tax',sum(rows,'tax')],['Total sales including tax',sum(rows,'total')],['Cash at sale',sum(rows,'collected')],['Credit at sale',roundMoney(sum(rows,'total')-sum(rows,'collected'))]]};
  const kinds=kind==='summary'?['daily','customers','commercials']:[kind];
  return {title,metadata:[['From',period.from],['To',period.to],['Posted transactions',rows.length]],notes:[String(data.unverified_documents||0)+' unverified documents excluded.','Posted sales for the selected dates. Cash and credit refer to the original sale; subsequent collections do not create sales. Table search does not change this report.'],sections:[summary,...kinds.map(k=>({title:{daily:'Sales by day',customers:'Sales by customer',commercials:'Sales by salesperson'}[k],columns:[{daily:'Date',customers:'Customer',commercials:'Salesperson'}[k],'Sales count',money('Net sales'),money('Tax'),money('Total sales'),money('Cash at sale'),money('Credit at sale')],rows:salesGroups(rows,k),totals:[['Total',rows.length,sum(rows,'subtotal'),sum(rows,'tax'),sum(rows,'total'),sum(rows,'collected'),roundMoney(sum(rows,'total')-sum(rows,'collected'))]]}))]};
}

export function salesStatusDocument(kind,rows,period){
  if(!['field','invoices','orders'].includes(kind))throw Error('Choose a sales report.');
  const field=kind==='field',invoices=kind==='invoices';
  const title=field?'Field sales report':invoices?'Customer invoice report':'Sales order report';
  const groups=new Map();
  for(const row of rows){
    const verified=kind==='orders' || row.status!=='approved_posted' && field || row.accounting_verified!==false;
    const status=verified?row.status:'Accounting review',g=groups.get(status)||{count:0,value:0,balance:0};
    g.count++;g.value+=n(row.total);
    if(invoices && verified && !['draft','cancelled','credited'].includes(row.status))g.balance+=n(row.customer_balance);
    groups.set(status,g);
  }
  const sections=[{title:'Status summary',columns:['Status','Documents',money('Document value'),...(invoices?[money('Current amount due')]:[])],rows:[...groups].map(([status,g])=>[status,g.count,roundMoney(g.value),...(invoices?[roundMoney(g.balance)]:[])])}];
  if(field){
    const posted=rows.filter(r=>r.status==='approved_posted' && r.accounting_verified!==false).map(r=>({...r,date:r.transaction_date,subtotal:r.subtotal,tax:r.tax_total,collected:r.amount_collected}));
    sections.push({title:'Posted sales by commercial',columns:['Commercial','Sales count',money('Net sales'),money('Tax'),money('Total sales'),money('Cash at sale'),money('Credit at sale')],rows:salesGroups(posted,'commercials')});
  }
  return {title,metadata:[...(period?[['From',period.from],['To',period.to]]:[]),['Documents',rows.length]],notes:[field?'Only approved and posted supplies appear in commercial sales totals. Other statuses are shown separately.':invoices?'Document values are grouped by status. Draft, cancelled and accounting-review documents are not recognized sales. Amounts due are current customer balances.':'Saved order values are grouped by status. Orders do not recognize revenue until invoicing.','This report summarizes the complete permitted set for this view; table pagination and search do not alter it.'],sections};
}
