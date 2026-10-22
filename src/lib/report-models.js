// Small data-only builders: exporters never scrape formatted DOM text or change records.
export const money = label => ({label,type:'money'});
export function tableReport(title,columns,rows,metadata=[],notes=[]) {
  const selected=columns.filter(c=>c.export!==false&&typeof c.label==='string'&&c.label.trim()&&!['actions','action'].includes(c.key));
  return {title,metadata,notes,sections:[{title,columns:selected.map(c=>({label:c.label,type:c.exportType})),rows:rows.map(row=>selected.map(c=>c.exportValue?c.exportValue(row):row[c.key]??''))}]};
}
export function cashFlowDocument(r) {
  return {title:'Cash flow statement',generatedAt:r.generated_at,metadata:[['From',r.from],['To',r.to],['Basis','Posted journals']],notes:[...(r.issues||[]).map(issue=>typeof issue==='string'?issue:issue.message||JSON.stringify(issue)),'The statement and complete history cover the report period. On-screen history search filters do not alter this document. Internal transfers are excluded from operating cash flows.'],sections:[
    {title:'Cash flow summary',columns:['Measure',money('Amount')],rows:[['Opening cash',r.opening],['Inflows',r.inflow],['Outflows',r.outflow],['Net cash flow',r.net],['Internal transfers (excluded)',r.internal_transfers??0],['Closing cash',r.closing],['Reconciliation difference',r.reconciliation_difference]]},
    {title:'Activities',columns:['Activity','Description','Account','Account name',money('Inflow'),money('Outflow'),money('Net')],rows:(r.activities||[]).flatMap(a=>[...(a.rows||[]).map(row=>[a.label,row.label,row.account_number,row.account_name,row.inflow,row.outflow,row.net]),[a.label,'Total','','',a.inflow,a.outflow,a.net]])},
    {title:'Cash accounts',columns:['Account','Name',money('Opening'),money('Inflow'),money('Outflow'),money('Closing')],rows:(r.components||[]).map(c=>[c.number,c.name,c.opening,c.inflow,c.outflow,c.closing])},
    {title:'Complete cash history',columns:['Date','Journal','Description','Reference','Source','Cash accounts','Counterpart accounts',money('Inflow'),money('Outflow'),money('Internal transfer'),'Review'],rows:(r.history||[]).map(h=>[h.date,h.journal_number,h.description,h.reference,h.source,(h.cash_accounts||[]).join(', '),(h.counterpart_accounts||[]).join(', '),h.inflow,h.outflow,h.internal_transfer??0,typeof h.review==='string'?h.review:JSON.stringify(h.review??'')])},
  ]};
}
export function auditDocument(a,history=[],stale=[]) {
  return {title:`Inventory count ${a.title||a.id}`,metadata:[['Warehouse',a.warehouse_name],['Counter',a.counter_name],['Snapshot',a.snapshot_at],['Status',a.status],['Revision',a.revision],['Evidence',a.evidence_reference],['Journal',a.journal_number||a.journal_id||'Not posted'],['Reviewed by',a.approved_by_name||a.approved_by||''],['Approved at',a.approved_at||''],['Posted by',a.posted_by||''],['Posted at',a.posted_at||''],['Review note',a.review_note||'']],notes:['Saved count snapshot. Uncounted quantities are blank. Approval and posting status are shown above.',...stale.map(s=>typeof s==='string'?s:s.message||JSON.stringify(s))],sections:[
    {title:'Saved count sheet',columns:['Item','SKU','Lot','Expiry','Quality','Unit','Book quantity','Counted quantity','Difference',money('Value difference'),'Reason'],rows:(a.rows||[]).map(r=>[r.product_name,r.sku,r.lot_number,r.expiry_date,r.qc_status,r.unit,r.book_quantity,r.counted_quantity??'',r.difference??'',r.value_difference??'',r.reason])},
    {title:'Audit history',columns:['Date','Action','Employee','Reason','Status','Revision'],rows:history.map(h=>[h.created_date,h.action,h.user_name,h.reason,h.status,h.revision])},
  ]};
}
export function companySalesDocument(data,period) {
  return {title:'Company sales report',metadata:[['From',period.from],['To',period.to],['Sales basis','Documents with matching posted journals'],['Posted transactions',data.totals.count]],notes:[`${data.unverified_documents||0} documents without matching posted journals are excluded.`, 'Sales and cash/credit at sale cover the selected dates. Customer balances are current outstanding amounts across all dates. Later collections are not new sales.'],sections:[
    {title:'Sales summary',columns:['Measure',money('Amount')],rows:[['Total sales including tax',data.totals.sales],['Net sales',data.totals.net],['Tax',data.totals.tax],['Cash at sale',data.overview?.cash_sales],['Credit at sale',data.overview?.credit_sales],['Current unpaid balances - all dates',data.overview?.pending_amount],['Current overdue balances - all dates',data.overview?.overdue_amount]]},
    {title:'Posted sales',columns:['Sale','Source','Customer','Commercial','Date','Terms',money('Total'),'Status'],rows:data.rows.map(r=>[r.document_number,r.source,r.customer_name,r.commercial_name,r.date,r.payment_type,r.total,'posted'])},
    {title:'Current unpaid documents',columns:['Document','Customer','Source','Due date',money('Amount due')],rows:(data.overview?.pending||[]).map(r=>[r.document_number,r.customer_name,r.source,r.due_date,r.balance])},
  ]};
}
export function stockDocument(rows,warehouse,search) {
  return {title:'Inventory stock audit',metadata:[['Warehouse',warehouse||'All permitted warehouses'],['Search',search||'All items'],['Lots',rows.length]],notes:['Current book stock snapshot. This is not a completed physical count. Held and expired stock remains identified in this report.'],sections:[{title:'Stock lots',columns:['Item','SKU','Warehouse','Lot','Batch','Expiry','Quality','Unit','Book quantity',money('Book value'),'Review'],rows:rows.map(r=>[r.product_name,r.sku,r.warehouse_name,r.lot_number,r.batch_number,r.expiry_date,r.qc_status,r.unit,r.book_quantity,r.book_value,r.issue]),totals:[['Total','','','','','','','','',rows.reduce((n,r)=>n+Number(r.book_value||0),0),'']]}]};
}
export function warehouseAdjustmentDocument(result,{warehouse,reason,account}={}) {
  return {title:'Posted inventory adjustment',metadata:[['Reference',result.reference],['Date',result.date],['Warehouse',warehouse||result.warehouse_id],['Adjustment ID',result.id],['Status','Posted'],['Journal',result.journal_number||'No monetary journal - quantity only'],['Expense account',account],['Reason',reason]],sections:[{title:'Posted stock changes',columns:['Item','Lot','Expiry','Quality','Unit','Book quantity','Physical quantity','Quantity change',money('Book value'),money('Value after'),money('Value change')],rows:result.rows.map(r=>[r.product_name,r.lot_number,r.expiry_date,r.qc_status,r.unit,r.book_quantity,r.counted_quantity,r.difference,r.book_value,r.value_after,r.value_difference]),totals:[['Net change','','','','','','','','','',result.value_difference]]}]};
}
export function salesInvoiceDocument({invoice:i,lines,company,options:o}) {
  return {title:`Invoice ${i.invoice_number}`,company:company.company_name,metadata:[['Invoice date',i.invoice_date],['Due date',i.due_date],['Bill to',o.bill_to_name],['Address',o.bill_to_address],['Customer tax ID',o.bill_to_tax_id],['Reference',o.reference],['Source',i.source_number],['Company tax ID',company.tax_id],['Registration number',company.registration_number],['Status',i.status]],notes:[o.terms,o.payment_instructions,o.notes,o.footer].filter(Boolean),sections:[
    {title:'Invoice lines',columns:['Item','Quantity','Unit',money('Unit price'),money('Discount'),money('Tax'),money('Total')],rows:lines.map(l=>[l.product_name,l.quantity,l.unit,l.unit_price,l.discount_amount,l.tax_amount,l.total])},
    {title:'Invoice totals',columns:['Measure',money('Amount')],rows:[['Net sales',i.subtotal],['Tax',i.tax_total],['Invoice total',i.total],['Paid / collected',i.customer_paid??i.amount_paid],['Amount due',i.customer_balance??i.balance]]},
  ]};
}
export function commercialPerformanceDocument(data) {
  return {title:'Commercial performance report',metadata:[['From',data.from],['To',data.to]],notes:['Approved and posted supplies use their sale date. Registrations use their acquisition date. Quantities remain separate by product and unit. Bonus plans are estimates subject to management approval. This document does not authorize a payment.','Includes the full selected period and permitted agent scope; on-screen name search only filters the displayed lists.'],sections:[
    {title:'Agents',columns:['Agent','Registered','Verified unique','Pending verification','Customers supplied','Approved deliveries',money('Net supply'),money('Supply including tax'),'Bonus plan'],rows:data.agents.map(a=>[a.full_name,a.registered,a.verified,a.pending,a.customers_supplied,a.deliveries,a.net,a.total,a.bonus_plan])},
    {title:'Product supply',columns:['Agent','Customer','Product','Unit','Approved quantity'],rows:data.supplies.flatMap(s=>s.products.map(p=>[s.commercial_name,s.customer_name,p.name,p.unit,p.quantity]))},
    {title:'Customer acquisitions',columns:['Customer','Acquisition agent','Acquisition date','Verification'],rows:data.registrations.map(c=>[c.business_name,c.acquired_by_name,c.acquisition_date,c.acquisition_verified||'pending'])},
  ]};
}
