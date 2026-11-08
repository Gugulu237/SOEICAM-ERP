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
import {resolveAccountConsolidations} from '../../lib/account-consolidation.js';

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
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['action','dispatchId','expenseAccountId','date','reference','token','requestKey','confirmed','roundingReviewPolicy'].includes(key)))throw fail('Review Dégustation through the reserved-stock appropriation form.');
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
 if(t.JournalEntry.filter(row=>ledgerStatuses.includes(row.status)&&(row.source_module||'')===(journal.source_module||'')&&row.source_document_type===journal.source_document_type&&row.source_document_id===journal.source_document_id).length!==1)throw fail('Reconcile the original sale and stock journals before expensing Dégustation.');
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
function legacyRounding(t,received,issued,out,balances,mismatches,inventoryByProduct,checkedSources){
 const roundPolicy='verified-legacy-rounded-unit-cost-v1',aliases=resolveAccountConsolidations(t.Account),cogsByProduct=new Map(),journalLines=[],lots=[];
 const rounded=(milli,cents)=>{const value=Math.round((milli/1000)*(cents/100)*100);return Number.isSafeInteger(value)&&value>=0?value:null;};
 const cogsFor=productId=>{
  if(cogsByProduct.has(productId))return cogsByProduct.get(productId);
  const product=t.Product.find(row=>row.id===productId),rules=t.PostingRule.filter(row=>row.rule_key==='direct_material_cogs'&&row.is_active!==false);
  if(!product||!product.cogs_account_id&&rules.length!==1)return null;
  const account=t.Account.find(row=>row.id===aliases.canonicalId(product.cogs_account_id||rules[0]?.account_id));
  if(!validPostingRuleAccount(account,'direct_material_cogs')||account.is_treasury||t.TreasuryAccount.some(row=>row.gl_account_id===account.id))return null;
  cogsByProduct.set(productId,account);return account;
 };
 // This narrowly recognizes the old issue algorithm. It never accepts an
 // arbitrary difference merely because the difference happens to be small.
 if(out.some(row=>!['SalesOrder','FieldSale'].includes(row.document_type)))return null;
 for(const {moves,lines}of checkedSources){
  const expected=new Map(),actual=new Map();
  for(const move of moves){const cogs=cogsFor(move.product_id);if(!cogs)return null;expected.set(cogs.id,add(expected.get(cogs.id)||0,recordedValue(move.total_value)));}
  for(const line of lines){const account=t.Account.find(row=>row.id===line.account_id);if(account?.account_type!=='cogs')continue;const id=aliases.canonicalId(account.id);actual.set(id,add(actual.get(id)||0,journalCents(line.debit)-journalCents(line.credit)));}
  if([...new Set([...expected.keys(),...actual.keys()])].some(id=>(expected.get(id)||0)!==(actual.get(id)||0)))return null;
 }
 let cogsChange=0,cacheChange=0;
 for(const mismatch of mismatches){
  const key=JSON.stringify([mismatch.product_id,mismatch.lot_number,mismatch.expiry_date,mismatch.qc_status,mismatch.production_order_id,mismatch.batch_number]),receipts=received.filter(row=>lotKey(row)===key),sourceLoads=issued.filter(row=>lotKey(row)===key),issues=out.filter(row=>lotKey(row)===key),current=balances.filter(row=>lotKey(row)===key);
  if(receipts.length!==1||sourceLoads.length!==1||current.length!==1||mismatch.quantity_delta!==0||mismatch.expected_quantity<0||mismatch.expected_quantity>0&&mismatch.expected_value<0)return null;
  const receipt=receipts[0],balance=current[0],loadQty=quantity(receipt.quantity),remainingQty=quantity(balance.quantity);if(!loadQty)return null;
  const loadValue=recordedValue(receipt.total_value),cpu=recordedValue(receipt.unit_cost),canonicalCPU=Math.round((loadValue/100)/(loadQty/1000)*100);
  if(!Number.isSafeInteger(canonicalCPU)||cpu!==canonicalCPU||recordedValue(sourceLoads[0].unit_cost)!==cpu||remainingQty&&recordedValue(balance.unit_cost)!==cpu)return null;
  if(issues.some(row=>recordedValue(row.unit_cost)!==cpu||rounded(quantity(row.quantity),cpu)!==recordedValue(row.total_value)))return null;
  const oldValue=rounded(remainingQty,cpu),actualValue=recordedValue(balance.total_value);if(oldValue===null||actualValue!==oldValue)return null;
  const expectedValue=loadValue-issues.reduce((sum,row)=>add(sum,recordedValue(row.total_value)),0),bound=Math.ceil((loadQty/1000+issues.length+1)/2);
  if(Math.abs(expectedValue-actualValue)>bound)return null;
  const exhausted=remainingQty===0,reconciledValue=exhausted?0:expectedValue,cogsAdjustment=exhausted?expectedValue:0,cacheDelta=reconciledValue-actualValue;
  const inventory=inventoryByProduct.get(mismatch.product_id),cogs=cogsAdjustment?cogsFor(mismatch.product_id):null;if(!inventory||cogsAdjustment&&!cogs)return null;
  const lot={...mismatch,receipt_unit_cost:cpu/100,legacy_remaining_value:oldValue/100,reconciled_value:reconciledValue/100,cache_value_change:cacheDelta/100,exhausted,cogs_adjustment:cogsAdjustment/100,rounding_bound:bound/100,inventory_account_id:inventory.id,cogs_account_id:cogs?.id||''};
  lots.push(lot);cogsChange=add(cogsChange,cogsAdjustment);cacheChange=add(cacheChange,cacheDelta);
  if(cogsAdjustment){const value=Math.abs(cogsAdjustment)/100,description='Legacy rounded cost residue: '+mismatch.product_name+' / '+(mismatch.lot_number||'-');journalLines.push({account_id:cogs.id,debit:cogsAdjustment>0?value:0,credit:cogsAdjustment<0?value:0,description},{account_id:inventory.id,debit:cogsAdjustment<0?value:0,credit:cogsAdjustment>0?value:0,description});}
 }
 return {required:true,policy:roundPolicy,cogs_change:cogsChange/100,inventory_value_change:-cogsChange/100,cache_value_change:cacheChange/100,journal_lines:journalLines,lots};
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
 const released=group(out),current=group(balances),mismatches=[],sourceJournals=[],checkedSources=[];
 for(const key of new Set([...incoming.keys(),...released.keys(),...current.keys()])){
  const start=incoming.get(key)||{quantity:0,value:0},end=current.get(key)||{quantity:0,value:0},spent=released.get(key)||{quantity:0,value:0},expectedQuantity=add(start.quantity,-spent.quantity),expectedValue=add(start.value,-spent.value);
  if(expectedQuantity===end.quantity&&expectedValue===end.value)continue;
  const [productId,lotNumber,expiryDate,qcStatus,productionOrderId,batchNumber]=JSON.parse(key),product=t.Product.find(row=>row.id===productId),loadedRows=received.filter(row=>lotKey(row)===key),releasedRows=out.filter(row=>lotKey(row)===key),balanceRows=balances.filter(row=>lotKey(row)===key);
  mismatches.push({product_id:productId,product_name:product?.name||loadedRows[0]?.product_name||releasedRows[0]?.product_name||balanceRows[0]?.product_name||productId,lot_number:lotNumber,expiry_date:expiryDate,qc_status:qcStatus,production_order_id:productionOrderId,batch_number:batchNumber,balance_ids:balanceRows.map(row=>row.id),load_movement_ids:loadedRows.map(row=>row.id),issue_movement_ids:releasedRows.map(row=>row.id),loaded_quantity:start.quantity/1000,loaded_value:start.value/100,released_quantity:spent.quantity/1000,released_value:spent.value/100,expected_quantity:expectedQuantity/1000,expected_value:expectedValue/100,current_quantity:end.quantity/1000,current_value:end.value/100,quantity_delta:add(end.quantity,-expectedQuantity)/1000,value_delta:add(end.value,-expectedValue)/100,loaded_unit_costs:[...new Set(loadedRows.map(row=>row.unit_cost??null))],released_unit_costs:[...new Set(releasedRows.map(row=>row.unit_cost??null))],current_unit_costs:[...new Set(balanceRows.map(row=>row.unit_cost??null))]});
 }
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
  sourceJournals.push({id:journal.id,journal_number:journal.journal_number||'',date:journal.entry_date,source_document_type:journal.source_document_type,source_document_id:journal.source_document_id,inventory_cost:total/100});
  checkedSources.push({moves,lines});
 }
 // Every original cost-bearing issue must have a verified posted journal.
 // Only the exact historical rounded-unit-cost algorithm permits a repair;
 // other discrepancies remain blocked and are returned for investigation.
 const rounding=mismatches.length?legacyRounding(t,received,issued,out,balances,mismatches,inventoryByProduct,checkedSources):null;
 if(mismatches.length&&!rounding)throw Object.assign(fail('The remaining lot quantities or carrying values do not reconcile to the original load and issues.',409),{degustation_appropriation_diagnostics:{dispatch_id:dispatch.id,stock_warehouse_id:warehouseId,source_journals_verified:true,source_journals:sourceJournals,mismatches}});
 return {movements:custody,load,source_journals:sourceJournals,rounding};
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
 // A historical quantity-times-rounded-unit-cost cache is not the ledger.
 // Preserve that cache in the audit and expense only the original receipt
 // value less the independently verified original sales cost releases.
 for(const lot of lots){const correction=proof.rounding?.lots.find(row=>row.balance_ids.includes(lot.id));if(correction){lot.recorded_value_before=lot.value;lot.value=correction.reconciled_value;}}
 for(const lot of lots){totalQuantity=add(totalQuantity,quantity(lot.quantity));totalValue=add(totalValue,journalCents(lot.value));credits.set(lot.inventory_account_id,add(credits.get(lot.inventory_account_id)||0,journalCents(lot.value)));}
 const roundingCredits=new Map();for(const line of proof.rounding?.journal_lines||[])if([...inventoryByProduct.values()].some(account=>account.id===line.account_id))roundingCredits.set(line.account_id,add(roundingCredits.get(line.account_id)||0,journalCents(line.credit)-journalCents(line.debit)));
 cache(t,expense);for(const id of new Set([...credits.keys(),...roundingCredits.keys()])){if(cache(t,t.Account.find(row=>row.id===id))<add(credits.get(id)||0,roundingCredits.get(id)||0))throw fail('The inventory ledger cannot support the remaining Dégustation carrying value.');}
 for(const id of new Set((proof.rounding?.journal_lines||[]).filter(row=>!roundingCredits.has(row.account_id)).map(row=>row.account_id)))cache(t,t.Account.find(row=>row.id===id));
 const journalLines=totalValue?[{account_id:expense.id,debit:totalValue/100,credit:0},...[...credits].filter(([,value])=>value).map(([id,value])=>({account_id:id,debit:0,credit:value/100}))]:[];
 const inventoryChange=add(-totalValue,proof.rounding?Math.round(proof.rounding.inventory_value_change*100):0)/100;
 const preview={dispatch:{id:dispatch.id,dispatch_number:dispatch.dispatch_number||'',employee_id:employee.id,employee_name:employee.full_name},expense_account:{...accountView(expense),parent_id:parent.id,parent_number:parent.account_number||'',parent_name:parent.name||''},date:selection.date,reference:selection.reference,lots,total_quantity:totalQuantity/1000,total_value:totalValue/100,journal_lines:journalLines,source_journals_verified:true,source_journals:proof.source_journals,...(proof.rounding?{legacy_rounding:proof.rounding}:{}),stock_quantity_change:0,inventory_value_change:inventoryChange,cash_change:0};
 return {...preview,token:hash({selection,tables:t,proof,preview})};
}
export async function previewDegustationAppropriation(stores,context,body){authorize(context);const selection=selected(body);return plan(stores,await state(stores),selection);}
export async function postDegustationAppropriation(stores,context,body){
 authorize(context);const selection=selected(body);
 if(body.confirmed!==true||!/^[a-f\d-]{36}$/i.test(body.requestKey||'')||!/^[a-f\d]{64}$/.test(body.token||''))throw fail('Preview and confirm the reserved Dégustation appropriation before posting.');
 const id='DGA-'+hash(selection.dispatchId),payload=hash({selection,token:body.token,requestKey:body.requestKey,user_id:context.user.id,roundingReviewPolicy:body.roundingReviewPolicy}),previous=await stores.AuditLog.get(id);
 if(previous){if(previous.audit_source!=='server_verified'||previous.action!=='appropriate_reserved_degustation'||previous.accounting_control_degustation_appropriation_policy!==policy||previous.accounting_control_degustation_appropriation_payload!==payload)throw fail('This run already has a different Dégustation appropriation. Review the existing correction.',409);return {...previous.accounting_control_degustation_appropriation_result,reused:true};}
 const tables=await state(stores),preview=await plan(stores,tables,selection);if(preview.token!==body.token)throw fail('The delivery stock, sales, costs or accounts changed. Preview the Dégustation appropriation again.',409);
 if(preview.legacy_rounding?.required&&body.roundingReviewPolicy!==preview.legacy_rounding.policy)throw fail('Preview and confirm the reserved Dégustation appropriation before posting.',409);
 const recordedAt=new Date().toISOString(),dispatch=tables.Dispatch.find(row=>row.id===selection.dispatchId),roundingId=id+'-ROUNDING',affectedIds=new Set([...preview.lots.map(lot=>lot.id),...(preview.legacy_rounding?.lots||[]).flatMap(lot=>lot.balance_ids)]),before=tables.StockBalance.filter(row=>affectedIds.has(row.id));
 let roundingJournal=null;
 if(preview.legacy_rounding?.journal_lines.length){
  const posted=await postJournal({entities:stores},{entryDate:selection.date,description:'Verified legacy rounded stock cost: '+preview.dispatch.dispatch_number+' / '+selection.reference,sourceModule:'accounting_corrections',sourceDocumentType:'DegustationRoundingCorrection',sourceDocumentId:roundingId,userId:context.user.id,lines:preview.legacy_rounding.journal_lines});
  if(posted.reused)throw fail('An appropriation journal exists without complete custody evidence. Reconcile it before proceeding.',409);roundingJournal=posted.journal;
 }
 for(const correction of preview.legacy_rounding?.lots||[]){
  const balance=before.find(row=>row.id===correction.balance_ids[0]);
  if(!correction.exhausted){
   // This repairs a derived cache only. The receipt-minus-issues ledger basis
   // is already correct, so no additional financial stock movement is made.
   await stores.StockBalance.update(balance.id,{total_value:correction.reconciled_value,unit_cost:Math.round(correction.reconciled_value/Number(balance.quantity)*100)/100});
  }else if(correction.cogs_adjustment){
   // An exhausted lot has no remaining quantity to expense as Marketing.
   // Settle its signed original sales-cost residue against COGS instead.
   await stores.StockMovement.create({product_id:correction.product_id,product_name:correction.product_name,quantity:0,movement_type:'stock_adjustment',...(correction.cogs_adjustment>0?{source_warehouse_id:dispatch.vehicle_warehouse_id}:{destination_warehouse_id:dispatch.vehicle_warehouse_id}),lot_number:correction.lot_number,expiry_date:correction.expiry_date||undefined,qc_status:correction.qc_status,production_order_id:correction.production_order_id||undefined,batch_number:correction.batch_number||undefined,unit_cost:0,total_value:Math.abs(correction.cogs_adjustment),document_type:'DegustationRoundingCorrection',document_id:roundingId,dispatch_id:selection.dispatchId,movement_date:selection.date,status:'approved',reason:'Verified exhausted-lot sales cost rounding residue; physical quantity unchanged / '+selection.reference,journal_id:roundingJournal.id,recorded_by:context.user.id,recorded_at:recordedAt,rounding_value_only:true,rounding_policy:preview.legacy_rounding.policy,rounding_cogs_change:correction.cogs_adjustment,rounding_balance_id:balance.id,rounding_inventory_account_id:correction.inventory_account_id,rounding_cogs_account_id:correction.cogs_account_id,rounding_receipt_ids:correction.load_movement_ids,rounding_issue_ids:correction.issue_movement_ids,rounding_source_value:correction.loaded_value,rounding_released_value:correction.released_value});
  }
 }
 const reconciled=await Promise.all(before.map(row=>stores.StockBalance.get(row.id)));
 let journal=null;if(preview.journal_lines.length){const result=await postJournal({entities:stores},{entryDate:selection.date,description:'Reserved Dégustation appropriation: '+preview.dispatch.dispatch_number+' / '+selection.reference,sourceModule:'degustation',sourceDocumentType:'DegustationAppropriation',sourceDocumentId:id,userId:context.user.id,lines:preview.journal_lines});if(result.reused)throw fail('An appropriation journal exists without complete custody evidence. Reconcile it before proceeding.',409);journal=result.journal;}
 for(const lot of preview.lots){
  const metadata={degustation_appropriation_id:id,degustation_appropriation_dispatch_id:selection.dispatchId,degustation_appropriation_expense_account_id:selection.expenseAccountId,degustation_appropriation_inventory_account_id:lot.inventory_account_id,degustation_appropriation_quantity:lot.quantity,degustation_appropriation_value:lot.value};
  await stores.StockBalance.update(lot.id,{total_value:0,unit_cost:0,...metadata});
  await stores.StockMovement.create({product_id:lot.product_id,product_name:lot.product_name,quantity:0,movement_type:'stock_adjustment',source_warehouse_id:tables.Dispatch.find(row=>row.id===selection.dispatchId).vehicle_warehouse_id,lot_number:lot.lot_number,expiry_date:lot.expiry_date||undefined,unit_cost:0,total_value:lot.value,document_type:'DegustationAppropriation',document_id:id,dispatch_id:selection.dispatchId,movement_date:selection.date,status:'approved',reason:'Promotional stock carrying value expensed; physical quantity unchanged / '+selection.reference,appropriation_value_only:true,inventory_appropriation_balance_id:lot.id,journal_id:journal?.id||'',recorded_by:context.user.id,recorded_at:recordedAt,...metadata});
 }
 const roundingSummary=preview.legacy_rounding?{rounding_journal_id:roundingJournal?.id||'',rounding_journal_number:roundingJournal?.journal_number||'',rounding_cogs_change:preview.legacy_rounding.cogs_change,rounding_inventory_value_change:preview.legacy_rounding.inventory_value_change,rounding_cache_value_change:preview.legacy_rounding.cache_value_change}:{};
 const summary={id,date:selection.date,expense_account_id:selection.expenseAccountId,total_quantity:preview.total_quantity,total_value:preview.total_value,journal_id:journal?.id||'',journal_number:journal?.journal_number||'',...roundingSummary,recorded_by:context.user.id,recorded_at:recordedAt,reference:selection.reference,policy};
 await stores.Dispatch.update(selection.dispatchId,{degustation_appropriation:summary});
 const result={...summary,dispatch_id:selection.dispatchId,employee_id:preview.dispatch.employee_id,employee_name:preview.dispatch.employee_name,stock_quantity_change:0,inventory_value_change:preview.inventory_value_change,cash_change:0,reused:false},after=await Promise.all(before.map(row=>stores.StockBalance.get(row.id)));
 await stores.AuditLog.create({id,action:'appropriate_reserved_degustation',module:'accounting',entity_type:'Dispatch',entity_id:selection.dispatchId,user_id:context.user.id,audit_source:'server_verified',description:'Expensed reserved Dégustation for '+preview.dispatch.employee_name+' / '+selection.reference,accounting_control_degustation_appropriation_policy:policy,accounting_control_degustation_appropriation_payload:payload,accounting_control_degustation_appropriation_preview:preview,accounting_control_degustation_appropriation_before:before,accounting_control_degustation_appropriation_reconciled:reconciled,accounting_control_degustation_appropriation_after:after,accounting_control_degustation_appropriation_dispatch_before:dispatch,accounting_control_degustation_appropriation_result:result});
 return result;
}
