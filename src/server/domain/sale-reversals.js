import {createHash} from 'node:crypto';
import {principalRole} from './roles.js';
import {requireStaff,postJournal,getRuleAccount,getAccountByNumber,round2,round3,today} from './field-ops.js';
import {readRecords} from './commercial-workspace.js';
import {checkedJournalLines} from './journal-validation.js';
import {postedInvoiceStatuses} from '../../lib/company-sales.js';
import {resolveAccountConsolidations} from '../../lib/account-consolidation.js';
import {canReadManagementAccounting} from '../../lib/management-access.js';
import {resolveNonSaleInventoryExpense,nonSaleInventoryExpenseAccount} from './non-sale-inventory-expense.js';
import {openingSaleCostBasis,OPENING_COST_MARKER} from './opening-cost-basis.js';

export const SALE_REVERSAL_ACTIONS=['previewSaleReversal','reverseSale'];
const retainedCostPolicy='unreturned-goods-operating-expense-v1';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sum=(rows,key)=>round2(rows.reduce((n,r)=>n+Number(r[key]||0),0));
const companyWarehouse=w=>w.is_active!==false&&['factory','cold_room','finished_goods','main','warehouse','general'].includes(w.warehouse_type);
const sorted=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
const publicReversal=(ctx,reversal)=>ctx.costsVisible||!reversal.retained_cost_expense?reversal:{...reversal,retained_cost_expense:{policy:reversal.retained_cost_expense.policy}};

async function context(client,user,body){
  const {employee,role}=await requireStaff(client,user,['admin','employee','commercial'],'sale reversals');
  if(role!=='admin'&&employee?.status!=='active')throw Error('An active sales staff account is required.');
  client.auth.assertModule?.(body.fieldSaleId?'commercial':'sales');
  if(Boolean(body.invoiceId)===Boolean(body.fieldSaleId))throw Error('Choose one invoice or Commercial supply to reverse.');
  const svc=client.asServiceRole,s=svc.entities;
  let invoice=body.invoiceId?await s.Invoice.get(body.invoiceId):null;
  if(body.invoiceId&&!invoice)throw Error('Invoice not found.');
  const fieldId=invoice?.field_sale_id||body.fieldSaleId;
  const field=fieldId?await s.FieldSale.get(fieldId):null;
  if(fieldId&&!field)throw Error('Supply not found.');
  if(field&&!invoice){const linked=await readRecords(s.Invoice,{field_sale_id:field.id});if(linked.length>1)throw Error('Reconcile duplicate invoices for this supply first.');invoice=linked[0]||null;}
  const order=invoice?.sales_order_id?await s.SalesOrder.get(invoice.sales_order_id):null;
  const source=field||order;
  if(!source||source.supply_kind==='exchange'||invoice?.opening_batch_id)throw Error('Choose a recorded product sale. Opening balances and replacement-only exchanges use their own correction workflows.');
  const owner=field?field.recorded_by===user.id||field.commercial_id===employee?.id:order.sales_supply_recorded_by===user.id||invoice.recorded_by===user.id||invoice.document_created_by===user.id;
  if(principalRole(user,employee)!=='admin'&&!owner)throw Error('You may reverse only your own sales. Ask the General Manager to review another user’s sale.');
  if(role==='commercial'&&!field)throw Error('Open your own Commercial supply to reverse it.');
  return {svc,s,invoice,field,order,source,costsVisible:canReadManagementAccounting(principalRole(user,employee),employee)};
}

async function plan(ctx){
  const {svc,s,invoice,field,source}=ctx;
  const record=field||invoice,type=field?'FieldSale':'Invoice';
  if(source.sale_reversal||invoice?.sale_reversal)throw Error('This sale has already been reversed. Open its recorded correction.');
  if(field?field.status!=='approved_posted':!postedInvoiceStatuses.includes(invoice.status))throw Error('Only a posted sale can be reversed.');
  if(invoice&&!postedInvoiceStatuses.includes(invoice.status))throw Error('This invoice is no longer open for reversal.');
  const journal=record.journal_id?await s.JournalEntry.get(record.journal_id):null;
  if(!journal||journal.status!=='posted'||journal.reversed_by_journal||journal.source_document_id!==record.id||journal.source_document_type!==type)throw Error('Reconcile the original sale journal before reversal.');
  if(!journal.entry_date||journal.entry_date>today())throw Error('The reversal date cannot precede the original sale journal.');
  if(invoice&&(invoice.customer_id!==source.customer_id||round2(invoice.total)!==round2(source.total)||field&&(invoice.journal_id!==field.journal_id||round2(invoice.balance)!==round2(field.amount_due))))throw Error('Reconcile the linked sale and invoice amounts before reversal.');
  if(invoice&&round2(Number(invoice.amount_paid||0)+Number(invoice.balance))!==round2(invoice.total))throw Error('Reconcile the invoice receipts and balance before reversal.');
  const original=checkedJournalLines(await readRecords(s.JournalLine,{journal_id:journal.id}));
  if(original.debit!==round2(journal.total_debit)||original.credit!==round2(journal.total_credit))throw Error('The original sale journal totals need reconciliation.');
  const accounts=await readRecords(s.Account),aliases=resolveAccountConsolidations(accounts),postingAccounts=new Map(original.lines.map(line=>[line.account_id,aliases.byId.get(aliases.canonicalId(line.account_id))]));
  for(const account of postingAccounts.values())if(!account||account.is_active===false||account.is_posting===false||!['debit','credit'].includes(account.normal_balance)||account.currency&&account.currency!=='XAF')throw Error('Review the active posting accounts and currency before reversal.');
  for(const account of [...postingAccounts.values()])postingAccounts.set(account.id,account);
  const [lines,customer,pending,warehouses,moves]=await Promise.all([
    readRecords(s[field?'FieldSaleLine':'InvoiceLine'],{[field?'field_sale_id':'invoice_id']:record.id}),s.Customer.get(source.customer_id),
    readRecords(s.Payment,{party_id:source.customer_id,payment_type:'customer_payment',status:{$in:['awaiting_cashier','pending_approval','approved']}}),
    readRecords(s.Warehouse),readRecords(s.StockMovement,{document_type:field?'FieldSale':'SalesOrder',document_id:source.id,status:'approved'})
  ]);
  if(!customer||!Number.isFinite(Number(customer.balance||0)))throw Error('The billing customer or balance needs reconciliation.');
  if(invoice&&pending.some(p=>(p.receipt_allocations||[]).some(a=>a.invoice_id===invoice.id)))throw Error('Complete or reject the pending receipt for this invoice before reversing the sale. Cash already handed over must be approved first.');
  const total=round2(record.total),due=round2(field?field.amount_due:invoice.payment_type==='cash'?0:invoice.balance),paid=round2(total-due);
  if(!Number.isFinite(total)||total<=0||!Number.isFinite(due)||due<0||due>total||!lines.length)throw Error('Reconcile the sale amounts and product lines first.');
  const settlement=!field&&invoice.cash_sale_settlement;
  const receivable=await getRuleAccount(svc,'customer_receivable');
  const cashAccount=settlement?postingAccounts.get(settlement.ledger_account_id):await getAccountByNumber(svc,'1050');
  const cashLines=original.lines.filter(l=>l.account_id===(settlement?settlement.ledger_account_id:cashAccount?.id));
  const cash=sum(cashLines,'debit');
  let receipt;
  if(settlement){
    const receipts=await readRecords(s.TreasuryTransaction,{source:'cash_sale',source_document_id:invoice.id});
    receipt=receipts[0];
    if(invoice.payment_type!=='cash'||!invoice.cash_deposited||cash!==total||cashLines.length!==1||cashLines[0].party_id!==source.customer_id||
       !cashAccount||settlement.amount!==total||settlement.journal_id!==journal.id||invoice.deposit_journal_id!==journal.id||
       receipts.length!==1||receipt.id!==settlement.transaction_id||receipt.journal_id!==journal.id||receipt.treasury_account_id!==settlement.treasury_account_id||
       invoice.deposit_treasury_account_id!==settlement.treasury_account_id||receipt.transaction_type!=='receipt'||round2(receipt.amount)!==cash||receipt.transaction_date!==journal.entry_date)
      throw Error('Reconcile the original treasury receipt before reversing this sale.');
  }
  const originalDebt=sum(original.lines.filter(l=>l.account_id===receivable.id),'debit');
  if(round2(cash+originalDebt)!==total)throw Error('The original cash and receivable accounts need reconciliation before reversal.');
  if(cash){
    if(field){
      const collections=await readRecords(s.CashCollection,{field_sale_id:field.id});
      if(sum(collections,'amount_collected')!==cash||sum(collections,'received_amount')!==cash||collections.some(c=>Number(c.outstanding_amount)>0||c.status!=='received'))throw Error('Complete the cashier handover of this sale’s collected cash before reversal. The money will remain in company funds as customer credit.');
    }else if(round2(invoice.balance)!==0||round2(invoice.amount_paid)!==total)throw Error('Deposit and approve this cash invoice’s receipt before reversal. The money will remain in company funds as customer credit.');
  }
  let cost=round2(lines.reduce((n,l)=>n+Number(field?l.line_cost:l.cogs_total||0),0));
  const costLines=original.lines.filter(l=>['Cost of goods sold','Inventory released'].includes(l.description));
  if(sum(costLines,'debit')!==cost||sum(costLines,'credit')!==cost)throw Error('The original item cost postings need reconciliation before reversal.');
  let cogsLines=costLines.filter(line=>line.description==='Cost of goods sold');const inventoryLines=costLines.filter(line=>line.description==='Inventory released');
  if(cogsLines.some(line=>Number(line.credit)!==0||postingAccounts.get(line.account_id)?.account_type!=='cogs'||postingAccounts.get(line.account_id)?.normal_balance!=='debit')||inventoryLines.some(line=>Number(line.debit)!==0||postingAccounts.get(line.account_id)?.account_type!=='asset'||postingAccounts.get(line.account_id)?.normal_balance!=='debit')||sum(cogsLines,'debit')!==cost||sum(inventoryLines,'credit')!==cost)throw Error('The original item cost postings need reconciliation before reversal.');
  let issues=moves.filter(m=>m.source_warehouse_id&&!m.destination_warehouse_id&&Number(m.quantity)>0),openingBasis=null;
  if(!field)openingBasis=await openingSaleCostBasis(s,{invoice,order:ctx.order,journal,invoiceLines:lines,issues,originalLines:original.lines,accounts});
  else if([source,invoice,journal,...issues].some(row=>row&&Object.hasOwn(row,OPENING_COST_MARKER)))throw Error('Reconcile the confirmed opening-stock cost correction before reversing this sale.');
  if(openingBasis){cost=openingBasis.cost;issues=openingBasis.issues;cogsLines=openingBasis.effectiveCogsLines;}
  let retainedExpense=null,retainedExpenseError='';
  if(cost)try{retainedExpense=await resolveNonSaleInventoryExpense(s,'unreturned_goods_expense');}catch(error){retainedExpenseError=error.message;}
  const retainedCostReview={policy:retainedCostPolicy,amount:cost,available:!retainedExpenseError,expense_account:retainedExpense?.account?{id:retainedExpense.account.id,account_number:retainedExpense.account.account_number,name:retainedExpense.account.name}:cost?{id:'',account_number:retainedExpense?.account_number||'',name:retainedExpense?.name||''}:null,will_create_account:retainedExpense?.needs_account===true,error:retainedExpenseError};
  const quantities=rows=>{const out={};for(const r of rows)out[r.product_id]=round3((out[r.product_id]||0)+Number(r.quantity));return Object.entries(out).sort(([a],[b])=>a.localeCompare(b));};
  const canRestore=hash(quantities(issues))===hash(quantities(lines))&&sum(issues,'total_value')===cost;
  const period=(await readRecords(s.AccountingPeriod)).find(p=>p.start_date<=today()&&today()<=p.end_date&&['closed','locked'].includes(p.status));
  if(period)throw Error('The current accounting period is closed or locked. Reopen an authorized period before recording the correction.');
  const affectedIds=new Set([...postingAccounts.keys(),...[...postingAccounts.values()].map(account=>account.id)]);
  const snapshot={record:record.id,journal:journal.id,total,due,paid,customerBalance:customer.balance,lines:sorted(original.lines),accounts:sorted(accounts.filter(account=>affectedIds.has(account.id))),issues:sorted(issues),invoiceStatus:invoice?.status,invoicePaid:invoice?.amount_paid,invoiceBalance:invoice?.balance,date:today(),retainedCostExpense:retainedExpense,retainedCostExpenseError:retainedExpenseError,retainedCostPolicy,...(settlement?{settlement,receipt}:{}),...(openingBasis?{openingCostBasis:openingBasis.proof}:{})};
  return {journal,original,postingAccounts,lines,customer,total,due,paid,cash,cashAccount,settlement,receivable,cost,costLines,cogsLines,retainedCostReview,issues,canRestore,openingBasis,warehouses:warehouses.filter(companyWarehouse),snapshot,reviewToken:hash(snapshot)};
}

export async function saleReversalAction(client,user,body){
  const ctx=await context(client,user,body),{svc,s,invoice,field,source}=ctx;
  if(!SALE_REVERSAL_ACTIONS.includes(body.action))throw Error('Unknown sale reversal action.');
  const existing=source.sale_reversal||invoice?.sale_reversal;
  const request={reason:typeof body.reason==='string'?body.reason.trim():'',stock:body.stockDisposition,warehouse:body.stockDisposition==='return_stock'?body.warehouseId||'':'',user:user.id,...(body.costTreatmentPolicy!==undefined?{costTreatmentPolicy:body.costTreatmentPolicy}:{})};
  const requestHash=hash(request);
  if(body.action==='reverseSale'&&existing){
    if(existing.request_hash!==requestHash)throw Error('This sale was already reversed with different details. Open its recorded correction.');
    const journal=await s.JournalEntry.get(existing.journal_id);
    return {reversal:publicReversal(ctx,journal?.sale_reversal||existing),reused:true};
  }
  const p=await plan(ctx);
  if(body.action==='previewSaleReversal'){
    const retainedReview={policy:retainedCostPolicy,available:p.retainedCostReview.available,requires_expense:p.cost>0,costs_visible:ctx.costsVisible,...(ctx.costsVisible?p.retainedCostReview:p.retainedCostReview.error?{error:'The operating expense for unreturned goods needs accounting review.'}:{error:''})};
    return {number:invoice?.invoice_number||field.sale_number,customer_name:source.customer_name,date:p.snapshot.date,total:p.total,unpaid_cancelled:p.due,customer_credit:p.paid,reviewToken:p.reviewToken,can_restore_stock:p.canRestore,retained_cost_review:retainedReview,...(p.openingBasis?{opening_cost_review:{...p.openingBasis.review,costs_visible:ctx.costsVisible,...(ctx.costsVisible?{effective_cost:p.cost,original_cost:sum(p.costLines,'debit'),cost_reduction:p.openingBasis.proof.correction.cost_reduction}:{})}}:{}),warehouses:p.warehouses.map(w=>({id:w.id,name:w.name})),items:p.lines.map(l=>({product_name:l.product_name,quantity:l.quantity,unit:l.unit})),has_replacements:Boolean(source.stock_replacements?.length),can_reverse:true};
  }
  if(request.reason.length<3||request.reason.length>1000)throw Error('Enter a reversal reason of 3 to 1000 characters.');
  if(!['retain_stock','return_stock'].includes(request.stock))throw Error('Choose what happened to the goods.');
  if(body.confirmed!==true)throw Error('Confirm the sale correction and the actual location of the goods.');
  if(body.reviewToken!==p.reviewToken)throw Error('This sale or customer balance changed. Reload the reversal preview before confirming.');
  const restoring=request.stock==='return_stock',warehouse=p.warehouses.find(w=>w.id===request.warehouse);
  if(restoring&&(!p.canRestore||!warehouse))throw Error('Choose an active company return warehouse; all original stock issue layers must reconcile.');
  if(!restoring&&p.cost&&(body.costTreatmentPolicy!==retainedCostPolicy||!p.retainedCostReview.available))throw Error(p.retainedCostReview.error?(ctx.costsVisible?p.retainedCostReview.error:'The operating expense for unreturned goods needs accounting review.'):'Review and confirm the operating expense for goods that have not returned.');
  const financial=p.original.lines.filter(l=>restoring&&!p.openingBasis||!p.costLines.some(c=>c.id===l.id)).map(l=>({account_id:p.postingAccounts.get(l.account_id).id,party_type:l.party_type,party_id:l.party_id,debit:l.credit,credit:l.debit,description:'Sale reversal: '+(l.description||'Original posting')}));
  if(restoring&&p.openingBasis)financial.push(...[...p.openingBasis.effectiveCogsLines,...p.openingBasis.effectiveInventoryLines].map(line=>({account_id:line.account_id,debit:line.credit,credit:line.debit,description:'Sale reversal using confirmed opening-stock basis: '+line.description})));
  let retainedCostExpense=null;
  if(!restoring&&p.cost){
    const expense=await nonSaleInventoryExpenseAccount(s,'unreturned_goods_expense'),credits=new Map();
    for(const line of p.cogsLines){const id=p.postingAccounts.get(line.account_id).id;credits.set(id,round2((credits.get(id)||0)+Number(line.debit)));}
    financial.push({account_id:expense.id,debit:p.cost,credit:0,description:'Operating expense for goods not returned after sale cancellation'},...[...credits].map(([account_id,credit])=>({account_id,debit:0,credit,description:'Reclassify cancelled-sale cost out of cost of goods sold'})));
    retainedCostExpense={policy:retainedCostPolicy,amount:p.cost,expense_account_id:expense.id,expense_account_number:expense.account_number,expense_account_name:expense.name,cogs_accounts:[...credits].map(([account_id,credit])=>({account_id,credit}))};
  }
  // Reversal retains the original money and gives the customer a credit.
  if(p.cash)financial.push({account_id:p.cashAccount.id,debit:p.cash,credit:0,description:'Cash retained for customer credit',...(p.settlement?{party_type:'customer',party_id:source.customer_id}:{})},{account_id:p.receivable.id,party_type:'customer',party_id:source.customer_id,debit:0,credit:p.cash,description:'Customer credit from reversed cash sale'});
  const {journal}=await postJournal(svc,{entryDate:p.snapshot.date,description:'Reversal of '+(invoice?.invoice_number||field.sale_number)+': '+request.reason,sourceModule:'sales',sourceDocumentType:'SaleReversal',sourceDocumentId:p.journal.id,userId:user.id,lines:financial});
  if(restoring)for(const issue of p.issues){
    // Returned dairy stock is quarantined. No reversal silently makes customer
    // returns saleable or puts goods back into a closed delivery run.
    await s.StockBalance.create({product_id:issue.product_id,product_name:issue.product_name,warehouse_id:warehouse.id,warehouse_name:warehouse.name,quantity:Number(issue.quantity),unit_cost:Number(issue.total_value)/Number(issue.quantity),total_value:Number(issue.total_value),lot_number:issue.lot_number||'',expiry_date:issue.expiry_date||'',production_order_id:issue.production_order_id||'',batch_number:issue.batch_number||'',qc_status:'pending',stock_origin:'sale_reversal',sale_reversal_journal_id:journal.id,original_stock_movement_id:issue.id});
    await s.StockMovement.create({product_id:issue.product_id,product_name:issue.product_name,quantity:Number(issue.quantity),unit_cost:Number(issue.total_value)/Number(issue.quantity),total_value:Number(issue.total_value),destination_warehouse_id:warehouse.id,lot_number:issue.lot_number||'',expiry_date:issue.expiry_date||'',production_order_id:issue.production_order_id||'',batch_number:issue.batch_number||'',movement_type:'customer_return',document_type:'SaleReversal',document_id:journal.id,original_stock_movement_id:issue.id,movement_date:p.snapshot.date,status:'approved',reason:request.reason,qc_status:'pending'});
  }
  const reversal={journal_id:journal.id,journal_number:journal.journal_number,date:p.snapshot.date,reason:request.reason,reversed_by:user.id,reversed_by_name:user.full_name||user.email||'',customer_credit:p.paid,unpaid_cancelled:p.due,total:p.total,stock_disposition:request.stock,warehouse_id:warehouse?.id||'',...(retainedCostExpense?{retained_cost_expense:retainedCostExpense}:{}),request_hash:requestHash,created_at:new Date().toISOString()};
  await s.JournalEntry.update(journal.id,{reversal_of:p.journal.id,reversal_reason:request.reason,sale_reversal:reversal});
  await s.JournalEntry.update(p.journal.id,{reversed_by_journal:journal.id,reversed_at:reversal.created_at,reversed_by:user.id,is_immutable:true});
  await s.Customer.update(source.customer_id,{balance:round2(Number(p.customer.balance||0)-p.total)});
  // Source sales stay readable by their author. Carrying costs and account
  // references remain in the restricted journal and immutable accounting audit.
  const sourceReversal=retainedCostExpense?{...reversal,retained_cost_expense:{policy:retainedCostPolicy}}:reversal;
  if(invoice)await s.Invoice.update(invoice.id,{status:'credited',balance:0,sale_reversal:sourceReversal,sale_reversal_date:reversal.date});
  // Keep source quantities and custody history intact. The dated correction is
  // a separate negative sale in reports, never a deletion of the original sale.
  await s[field?'FieldSale':'SalesOrder'].update(source.id,{amount_due:0,sale_reversal:sourceReversal,sale_reversal_date:reversal.date});
  await s.AuditLog.create({action:'reverse_sale',module:'sales',entity_type:field?'FieldSale':'SalesOrder',entity_id:source.id,user_id:user.id,audit_source:'server_verified',description:'Reversed '+(invoice?.invoice_number||field.sale_number),reason:request.reason,sale_reversal:reversal,original_sale:source,original_invoice:invoice||null,reviewed_snapshot:p.snapshot});
  return {reversal:publicReversal(ctx,reversal)};
}
