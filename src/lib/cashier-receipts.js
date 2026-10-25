const money=value=>Math.round(Number(value||0)*100)/100;
export function receiptAllocations(invoices,amount){
 let left=money(amount);if(!Number.isFinite(left)||left<=0)throw Error('Enter an amount greater than zero');
 const rows=[];
 for(const invoice of invoices){const take=money(Math.min(left,Number(invoice.available_amount||0)));if(take>0){rows.push({invoice_id:invoice.id,amount:take});left=money(left-take);}}
 if(left>0)throw Error('The amount exceeds the available invoice balance');
 return rows;
}
export function cashDepositors(source){
 const items=[];
 for(const h of source.handovers||[]){const remaining=money(Number(h.expected_amount||0)-Number(h.received_amount||0));if(remaining>0&&['submitted','partially_received','disputed'].includes(h.status))items.push({id:'handover:'+h.id,name:h.commercial_name,group:'Commercial deposits',reference:h.handover_number,date:h.handover_date,amount:remaining,kind:'handover',document:h});}
 for(const day of source.depositDays||source.dailyCash||[]){if(day.requestable>0)items.push({id:'daily:'+day.id,name:day.commercial_name,group:'Commercial deposits',reference:day.collection_date,date:day.collection_date,amount:day.requestable,kind:'daily',blocked:!!day.disputed,document:{...day,expected_amount:day.requestable,received_amount:0}});}
 const customers=new Map();
 for(const i of source.invoices||[]){if(!(i.available_amount>0))continue;
  if(i.payment_type==='cash'){items.push({id:'invoice:'+i.id,name:i.stock_holder_name||i.salesperson_name||i.customer_name,group:'Recorded cash sales',reference:i.invoice_number+' · '+i.customer_name,date:i.invoice_date,amount:i.available_amount,kind:'receipt',document:i});continue;}
  if(!customers.has(i.customer_id))customers.set(i.customer_id,[]);customers.get(i.customer_id).push(i);
 }
 for(const [id,invoices] of customers){invoices.sort((a,b)=>String(a.due_date||a.invoice_date).localeCompare(String(b.due_date||b.invoice_date))||String(a.id).localeCompare(String(b.id)));const page=invoices.slice(0,50),amount=money(page.reduce((n,i)=>n+Number(i.available_amount),0));items.push({id:'customer:'+id,name:page[0].customer_name,group:'Customer payments',reference:page.map(i=>i.invoice_number).join(', '),amount,kind:'receipt',document:{customer_id:id,customer_name:page[0].customer_name,available_amount:amount,invoices:page,more_invoices:invoices.length>50}});}
 return items.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))||String(a.date||'').localeCompare(String(b.date||'')));
}
