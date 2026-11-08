import {createHash} from 'node:crypto';
import {requireActiveContext,forbidden} from '../access.js';
import {principalRole} from './roles.js';
import {assertModule} from './role-catalogue.js';
import {readRecords} from './commercial-workspace.js';
import {stockStaff,eligibleStockRecipient,validEmployeeStockLocation} from './employee-custody.js';
import {dispatchReconciliationData} from './dispatch-operations.js';
import {finishedProduct} from './commercial-rules.js';
import {postJournal} from './field-ops.js';
import {journalCents,journalDate,checkedJournalLines,journalPayload,ledgerStatuses} from './journal-validation.js';
import {validPostingRuleAccount} from '../../lib/posting-rule-types.js';
import {businessDate} from '../../lib/business-date.js';
import {eligibleDegustationExpenseAccount} from '../../lib/degustation-accounts.js';

const policy='legacy-degustation-appropriation-v1';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const ordered=rows=>[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
const add=(a,b)=>{const result=a+b;if(!Number.isSafeInteger(result))throw fail('Dégustation totals exceed the supported precision.');return result;};
const quantity=value=>{if(!['string','number'].includes(typeof value)||!String(value).trim())throw fail('Reconcile invalid Dégustation stock quantities.');const number=Number(value),milli=Math.round(number*1000);if(!Number.isFinite(number)||number<0||!Number.isSafeInteger(milli)||Math.abs(number*1000-milli)>0.0001)throw fail('Reconcile invalid Dégustation stock quantities.');return milli;};
const recordedValue=value=>{if(!['number','string'].includes(typeof value)||!String(value).trim())throw fail('Reconcile missing Dégustation lot and movement carrying values.');return journalCents(value);};
const lotKey=row=>JSON.stringify(['product_id','lot_number','expiry_date','qc_status','production_order_id','batch_number'].map(key=>row[key]||(key==='qc_status'?'approved':'')));
const accountView=account=>({id:account.id,account_number:account.account_number||'',number:account.account_number||'',name:account.name||''});
function authorize(context){
 if(requireActiveContext(context)!=='admin'||principalRole(context.user,context.employee)!=='admin')throw forbidden('Only the General Manager can expense reserved Dégustation stock.');
 for(const module of ['accounting','distribution'])assertModule({...context,role:'admin'},module);
}
function selected(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['action','dispatchId','expenseAccountId','date','reference','token','requestKey','confirmed'].includes(key)))throw fail('Review Dégustation through the reserved-stock appropriation form.');
 if(typeof body.dispatchId!=='string'||!body.dispatchId.trim()||typeof body.expenseAccountId!=='string'||!body.expenseAccountId.trim())throw fail('Choose the delivery run and its Dégustation expense account.');
 const date=journalDate(body.date);
 if(typeof body.reference!=='string'||body.reference.trim().length<3||body.reference.trim().length>500)throw fail('Enter a Dégustation review reference of 3 to 500 characters.');
 return {policy,dispatchId:body.dispatchId,expenseAccountId:body.expenseAccountId,date,reference:body.reference.trim()};
}
async function state(stores){
 const names=['Account','AccountingPeriod','Dispatch','DispatchLine','Employee','Warehouse','Vehicle','Product','PostingRule','StockBalance','StockMovement','SalesOrder','SalesOrderLine','FieldSale','FieldSaleLine','SpoilageRecord','JournalEntry','JournalLine','Invoice','InvoiceLine','TreasuryAccount','CompanySettings'];
 return Object.fromEntries(await Promise.all(names.map(async name=>[name,ordered(await readRecords(stores[name]))])));
}
function checkedJournal(t,id){
 const journal=t.JournalEntry.find(row=>row.id===id),lines=t.JournalLine.filter(row=>row.journal_id===id);
 if(!journal||journal.status!=='posted'||journalDate(journal.entry_date)>businessDate()||lines.some(line=>line.status&&!ledgerStatuses.includes(line.status)))throw fail('Reconcile the original sale and stock journals before expensing Dégustation.');
 const checked=checkedJournalLines(lines);
 if(journalCents(journal.total_debit)!==journalCents(checked.debit)||journalCents(journal.total_credit)!==journalCents(checked.credit)||journal.posting_payload&&journal.posting_payload!==journalPayload({entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines:checked.lines}))throw fail('Reconcile the original sale and stock journals before expensing Dégustation.');
 return {journal,lines};
}
function cache(t,account){
 const headers=new Map(t.JournalEntry.map(row=>[row.id,row]));let cents=0;
 for(const line of t.JournalLine.filter(row=>row.account_id===account.id)){
  const header=headers.get(line.journal_id);if(!header)throw fail('Reconcile the expense and inventory accounts with the posted ledger.');
  if(!ledgerStatuses.includes(header.status))continue;
  if(line.status&&!ledgerStatuses.includes(line.status))throw fail('Reconcile the expense and inventory accounts with the posted ledger.');
  const debit=journalCents(line.debit),credit=journalCents(line.credit);if(debit&&credit)throw fail('Reconcile the expense and inventory accounts with the posted ledger.');
  cents=add(cents,debit-credit);
 }
 if(cents!==journalCents(Math.abs(Number(account.balance||0)))*(Number(account.balance||0)<0?-1:1))throw fail('Reconcile the expense and inventory accounts with the posted ledger.');
 return cents;
}
function inventoryAccount(t,product){
 const rules=t.PostingRule.filter(row=>row.rule_key==='finished_goods_inventory'&&row.is_active!==false);
 if(!product.inventory_account_id&&rules.length!==1)throw fail('Configure one finished-goods inventory posting rule before expensing Dégustation.');
 const account=t.Account.find(row=>row.id===(product.inventory_account_id||rules[0]?.account_id));
 if(!validPostingRuleAccount(account,'finished_goods_inventory')||account.is_treasury||t.TreasuryAccount.some(row=>row.gl_account_id===account.id))throw fail('Review the finished-goods inventory accounts before expensing Dégustation.');
 return account;
}
function sourceProof(t,dispatch,balances,inventoryByProduct){
 const warehouseId=dispatch.vehicle_warehouse_id,manifest=t.DispatchLine.filter(row=>row.dispatch_id===dispatch.id),orders=t.SalesOrder.filter(row=>row.dispatch_id===dispatch.id),fields=t.FieldSale.filter(row=>row.dispatch_id===dispatch.id);
 const orderIds=new Set(orders.map(row=>row.id)),fieldIds=new Set(fields.map(row=>row.id));
 const relevant=movement=>movement.dispatch_id===dispatch.id||movement.document_type==='Dispatch'&&movement.document_id===dispatch.id||movement.document_type==='SalesOrder'&&orderIds.has(movement.document_id)||movement.document_type==='FieldSale'&&fieldIds.has(movement.document_id);
 const load=t.StockMovement.filter(row=>row.document_type==='Dispatch'&&row.document_id===dispatch.id&&row.movement_type==='vehicle_load');
 const received=load.filter(row=>row.destination_warehouse_id===warehouseId&&!row.source_warehouse_id),issued=load.filter(row=>row.source_warehouse_id===dispatch.warehouse_id&&!row.destination_warehouse_id);
 if(!received.length||!issued.length||load.some(row=>row.status!=='approved'||journalDate(row.movement_date)>businessDate()))throw fail('The original delivery load needs complete approved stock-transfer evidence.');
 const firstTime=received.every(row=>row.created_date)?received.map(row=>row.created_date).sort()[0]:null;
 const afterLoad=movement=>firstTime&&movement.created_date?movement.created_date>=firstTime:String(movement.movement_date||'')>=String(dispatch.dispatch_date||'').slice(0,10);
 const custody=t.StockMovement.filter(row=>(row.source_warehouse_id===warehouseId||row.destination_warehouse_id===warehouseId)&&(relevant(row)||afterLoad(row)));
 if(custody.some(row=>row.status!=='approved'||!relevant(row)||journalDate(row.movement_date)>businessDate()))throw fail('Reconcile pending or unrelated stock movements on this delivery run.');
 if(custody.some(row=>row.destination_warehouse_id===warehouseId&&!received.some(load=>load.id===row.id)))throw fail('Reconcile stock received after the original delivery load before expensing Dégustation.');
 const group=rows=>{const result=new Map();for(const row of rows){const key=lotKey(row),previous=result.get(key)||{quantity:0,value:0};previous.quantity=add(previous.quantity,quantity(row.quantity));previous.value=add(previous.value,recordedValue(row.total_value));result.set(key,previous);}return result;};
 const incoming=group(received),outgoingLoad=group(issued);
 if(JSON.stringify([...incoming].sort())!==JSON.stringify([...outgoingLoad].sort()))throw fail('The original delivery load quantities and values do not reconcile.');
 for(const line of manifest){const rows=received.filter(row=>row.product_id===line.product_id);if(quantity(line.loaded_quantity)!==rows.reduce((sum,row)=>add(sum,quantity(row.quantity)),0)||recordedValue(line.loaded_value)!==rows.reduce((sum,row)=>add(sum,recordedValue(row.total_value)),0))throw fail('The original delivery load quantities and values do not reconcile.');}
 if(recordedValue(dispatch.total_loaded_value)!==received.reduce((sum,row)=>add(sum,recordedValue(row.total_value)),0))throw fail('The original delivery load quantities and values do not reconcile.');
 const out=custody.filter(row=>row.source_warehouse_id===warehouseId);
 const allowed=row=>!row.destination_warehouse_id&&(row.document_type==='SalesOrder'&&row.movement_type==='customer_delivery'&&orderIds.has(row.document_id)||row.document_type==='FieldSale'&&row.movement_type==='field_delivery'&&fieldIds.has(row.document_id)||['Degustation','SpoilageRecord'].includes(row.document_type)&&row.movement_type==='promotional_issue'||row.document_type==='Dispatch'&&row.document_id===dispatch.id&&row.movement_type==='warehouse_transfer');
 if(out.some(row=>!allowed(row)))throw fail('Reconcile unsupported delivery stock movements before expensing Dégustation.');
 const released=group(out),current=group(balances);
 for(const key of new Set([...incoming.keys(),...released.keys(),...current.keys()])){const start=incoming.get(key)||{quantity:0,value:0},end=current.get(key)||{quantity:0,value:0},spent=released.get(key)||{quantity:0,value:0};if(start.quantity-spent.quantity!==end.quantity||start.value-spent.value!==end.value)throw fail('The remaining lot quantities or carrying values do not reconcile to the original load and issues.');}
 const documents=new Map();for(const row of out.filter(row=>row.document_type!=='Dispatch')){const key=row.document_type+':'+row.document_id,list=documents.get(key)||[];list.push(row);documents.set(key,list);}
 for(const moves of documents.values()){
  const first=moves[0];let journalId,expectedType=first.document_type,expectedId=first.document_id;
  if(first.document_type==='SalesOrder'){const order=orders.find(row=>row.id===first.document_id),invoices=t.Invoice.filter(row=>row.id===order?.invoice_id||row.sales_order_id===order?.id);if(!order||order.sale_reversal||invoices.length!==1)throw fail('Reconcile the original sale and stock journals before expensing Dégustation.');journalId=invoices[0].journal_id;expectedType='Invoice';expectedId=invoices[0].id;}
  else if(first.document_type==='FieldSale'){const sale=fields.find(row=>row.id===first.document_id);if(!sale||sale.sale_reversal)throw fail('Reconcile the original sale and stock journals before expensing Dégustation.');journalId=sale.journal_id;}
  else if(first.document_type==='SpoilageRecord')journalId=t.SpoilageRecord.find(row=>row.id===first.document_id)?.journal_id;
  else journalId=first.journal_id||t.JournalEntry.find(row=>row.source_document_type===expectedType&&row.source_document_id===expectedId)?.id;
  const total=moves.reduce((sum,row)=>add(sum,recordedValue(row.total_value)),0);if(!total&&!journalId)continue;
  const {journal,lines}=checkedJournal(t,journalId);if(journal.source_document_type!==expectedType||journal.source_document_id!==expectedId)throw fail('Reconcile the original sale and stock journals before expensing Dégustation.');
  const expected=new Map();for(const move of moves){const account=inventoryByProduct.get(move.product_id);if(!account)throw fail('Reconcile the original sale and stock journals before expensing Dégustation.');expected.set(account.id,add(expected.get(account.id)||0,recordedValue(move.total_value)));}
  for(const [id,value]of expected)if(lines.filter(row=>row.account_id===id).reduce((sum,row)=>add(sum,journalCents(row.credit)-journalCents(row.debit)),0)!==value)throw fail('The original stock issues and inventory journal values do not reconcile.');
 }
 return {movements:custody,load};
}
async function plan(stores,t,selection){
 if(selection.date!==businessDate())throw fail('Expense reserved Dégustation on the current business date.');
 const dispatch=t.Dispatch.find(row=>row.id===selection.dispatchId);
 if(!dispatch||!['loaded','in_transit'].includes(dispatch.status)||!dispatch.vehicle_warehouse_id||dispatch.unsold_return_request_id)throw fail('Choose an open delivery run without a pending stock return.');
 if(dispatch.degustation_appropriation)throw fail('This delivery run already has a Dégustation appropriation. Review its existing journal.',409);
 if(t.Dispatch.some(row=>row.id!==dispatch.id&&['loaded','in_transit'].includes(row.status)&&(row.vehicle_warehouse_id===dispatch.vehicle_warehouse_id||row.salesperson_id===dispatch.salesperson_id||dispatch.vehicle_id&&row.vehicle_id===dispatch.vehicle_id)))throw fail('Reconcile overlapping delivery runs before expensing Dégustation.');
 const [employee]=await stockStaff(stores,[t.Employee.find(row=>row.id===dispatch.salesperson_id)]),warehouse=t.Warehouse.find(row=>row.id===dispatch.vehicle_warehouse_id),source=t.Warehouse.find(row=>row.id===dispatch.warehouse_id),vehicle=dispatch.vehicle_id?t.Vehicle.find(row=>row.id===dispatch.vehicle_id):null;
 if(!eligibleStockRecipient(employee)||!source||source.is_active===false||!['finished_goods','cold_room','general'].includes(source.warehouse_type)||!warehouse||warehouse.is_active===false||warehouse.id===source.id||(!dispatch.vehicle_id?!validEmployeeStockLocation(warehouse,employee.id):!vehicle||vehicle.is_active===false||vehicle.warehouse_id!==warehouse.id||warehouse.warehouse_type!=='vehicle'))throw fail('Review the active stock holder and assigned custody location before expensing Dégustation.');
 const expense=t.Account.find(row=>row.id===selection.expenseAccountId),parent=t.Account.find(row=>row.id===expense?.parent_id);
 if(!validPostingRuleAccount(expense,'marketing_degustation_expense')||!eligibleDegustationExpenseAccount(expense,t.Account)||t.TreasuryAccount.some(row=>row.gl_account_id===expense.id))throw fail('Choose an active debit-normal Dégustation expense sub-account under Marketing.');
 const periods=t.AccountingPeriod.filter(row=>row.start_date<=selection.date&&row.end_date>=selection.date);if(!periods.length||periods.some(row=>row.status!=='open'))throw fail('An open accounting period is required to expense reserved Dégustation.');
 const reconciliation=await dispatchReconciliationData({entities:stores},dispatch);
 if(reconciliation.hasVariance||!reconciliation.rows.some(row=>row.actual>0)||reconciliation.rows.some(row=>quantity(row.actual)!==quantity(row.degustation_remaining)))throw fail('Only a reconciled run whose remaining stock is entirely reserved Dégustation can be appropriated.');
 const balances=t.StockBalance.filter(row=>row.warehouse_id===warehouse.id),inventoryByProduct=new Map(),lots=[];
 for(const balance of balances){
  const qty=quantity(balance.quantity),value=recordedValue(balance.total_value);if(!qty&&value)throw fail('Reconcile stock values without physical quantities before expensing Dégustation.');
  if(!qty)continue;
  const product=t.Product.find(row=>row.id===balance.product_id);if(!finishedProduct(product)||product.is_active===false||product.configuration_status==='draft'||(balance.qc_status||'approved')!=='approved'||balance.expiry_date&&balance.expiry_date<selection.date||Object.keys(balance).some(key=>key.startsWith('degustation_appropriation_')&&balance[key]!=null&&balance[key]!==''))throw fail('Choose unappropriated, approved and unexpired finished-product lots for Dégustation.');
  const inventory=inventoryAccount(t,product);inventoryByProduct.set(product.id,inventory);
  lots.push({id:balance.id,product_id:product.id,product_name:product.name,lot_number:balance.lot_number||'',expiry_date:balance.expiry_date||'',quantity:qty/1000,value:value/100,inventory_account_id:inventory.id,inventory_account_number:inventory.account_number||'',inventory_account_name:inventory.name||''});
 }
 // Historical sale products can have zero physical balance after being sold.
 for(const line of t.DispatchLine.filter(row=>row.dispatch_id===dispatch.id)){const product=t.Product.find(row=>row.id===line.product_id);if(!product)throw fail('Reconcile missing products on the original delivery manifest.');if(!inventoryByProduct.has(product.id))inventoryByProduct.set(product.id,inventoryAccount(t,product));}
 const proof=sourceProof(t,dispatch,balances,inventoryByProduct),credits=new Map();let totalQuantity=0,totalValue=0;
 for(const lot of lots){totalQuantity=add(totalQuantity,quantity(lot.quantity));totalValue=add(totalValue,journalCents(lot.value));credits.set(lot.inventory_account_id,add(credits.get(lot.inventory_account_id)||0,journalCents(lot.value)));}
 cache(t,expense);for(const[id,value]of credits){if(cache(t,t.Account.find(row=>row.id===id))<value)throw fail('The inventory ledger cannot support the remaining Dégustation carrying value.');}
 const journalLines=totalValue?[{account_id:expense.id,debit:totalValue/100,credit:0},...[...credits].filter(([,value])=>value).map(([id,value])=>({account_id:id,debit:0,credit:value/100}))]:[];
 const preview={dispatch:{id:dispatch.id,dispatch_number:dispatch.dispatch_number||'',employee_id:employee.id,employee_name:employee.full_name},expense_account:{...accountView(expense),parent_id:parent.id,parent_number:parent.account_number||'',parent_name:parent.name||''},date:selection.date,reference:selection.reference,lots,total_quantity:totalQuantity/1000,total_value:totalValue/100,journal_lines:journalLines,stock_quantity_change:0,inventory_value_change:-totalValue/100,cash_change:0};
 return {...preview,token:hash({selection,tables:t,proof,preview})};
}
export async function previewDegustationAppropriation(stores,context,body){authorize(context);const selection=selected(body);return plan(stores,await state(stores),selection);}
export async function postDegustationAppropriation(stores,context,body){
 authorize(context);const selection=selected(body);
 if(body.confirmed!==true||!/^[a-f\d-]{36}$/i.test(body.requestKey||'')||!/^[a-f\d]{64}$/.test(body.token||''))throw fail('Preview and confirm the reserved Dégustation appropriation before posting.');
 const id='DGA-'+hash(selection.dispatchId),payload=hash({selection,token:body.token,requestKey:body.requestKey,user_id:context.user.id}),previous=await stores.AuditLog.get(id);
 if(previous){if(previous.audit_source!=='server_verified'||previous.action!=='appropriate_reserved_degustation'||previous.accounting_control_degustation_appropriation_policy!==policy||previous.accounting_control_degustation_appropriation_payload!==payload)throw fail('This run already has a different Dégustation appropriation. Review the existing correction.',409);return {...previous.accounting_control_degustation_appropriation_result,reused:true};}
 const tables=await state(stores),preview=await plan(stores,tables,selection);if(preview.token!==body.token)throw fail('The delivery stock, sales, costs or accounts changed. Preview the Dégustation appropriation again.',409);
 let journal=null;if(preview.journal_lines.length){const result=await postJournal({entities:stores},{entryDate:selection.date,description:'Reserved Dégustation appropriation: '+preview.dispatch.dispatch_number+' / '+selection.reference,sourceModule:'degustation',sourceDocumentType:'DegustationAppropriation',sourceDocumentId:id,userId:context.user.id,lines:preview.journal_lines});if(result.reused)throw fail('An appropriation journal exists without complete custody evidence. Reconcile it before proceeding.',409);journal=result.journal;}
 const recordedAt=new Date().toISOString(),before=preview.lots.map(lot=>tables.StockBalance.find(row=>row.id===lot.id)),after=[];
 for(const lot of preview.lots){
  const metadata={degustation_appropriation_id:id,degustation_appropriation_dispatch_id:selection.dispatchId,degustation_appropriation_expense_account_id:selection.expenseAccountId,degustation_appropriation_inventory_account_id:lot.inventory_account_id,degustation_appropriation_quantity:lot.quantity,degustation_appropriation_value:lot.value};
  after.push(await stores.StockBalance.update(lot.id,{total_value:0,unit_cost:0,...metadata}));
  await stores.StockMovement.create({product_id:lot.product_id,product_name:lot.product_name,quantity:0,movement_type:'stock_adjustment',source_warehouse_id:tables.Dispatch.find(row=>row.id===selection.dispatchId).vehicle_warehouse_id,lot_number:lot.lot_number,expiry_date:lot.expiry_date||undefined,unit_cost:0,total_value:lot.value,document_type:'DegustationAppropriation',document_id:id,dispatch_id:selection.dispatchId,movement_date:selection.date,status:'approved',reason:'Promotional stock carrying value expensed; physical quantity unchanged / '+selection.reference,appropriation_value_only:true,inventory_appropriation_balance_id:lot.id,journal_id:journal?.id||'',recorded_by:context.user.id,recorded_at:recordedAt,...metadata});
 }
 const summary={id,date:selection.date,expense_account_id:selection.expenseAccountId,total_quantity:preview.total_quantity,total_value:preview.total_value,journal_id:journal?.id||'',journal_number:journal?.journal_number||'',recorded_by:context.user.id,recorded_at:recordedAt,reference:selection.reference,policy};
 await stores.Dispatch.update(selection.dispatchId,{degustation_appropriation:summary});
 const result={...summary,dispatch_id:selection.dispatchId,employee_id:preview.dispatch.employee_id,employee_name:preview.dispatch.employee_name,stock_quantity_change:0,inventory_value_change:-preview.total_value,cash_change:0,reused:false};
 await stores.AuditLog.create({id,action:'appropriate_reserved_degustation',module:'accounting',entity_type:'Dispatch',entity_id:selection.dispatchId,user_id:context.user.id,audit_source:'server_verified',description:'Expensed reserved Dégustation for '+preview.dispatch.employee_name+' / '+selection.reference,accounting_control_degustation_appropriation_policy:policy,accounting_control_degustation_appropriation_payload:payload,accounting_control_degustation_appropriation_preview:preview,accounting_control_degustation_appropriation_before:before,accounting_control_degustation_appropriation_after:after,accounting_control_degustation_appropriation_dispatch_before:tables.Dispatch.find(row=>row.id===selection.dispatchId),accounting_control_degustation_appropriation_result:result});
 return result;
}
