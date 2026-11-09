import {createHash} from 'node:crypto';
import {readRecords} from './commercial-workspace.js';
import {journalCents,journalDate,checkedJournalLines,journalPayload,ledgerStatuses} from './journal-validation.js';
import {resolveAccountConsolidations} from '../../lib/account-consolidation.js';
import {businessDate} from '../../lib/business-date.js';

export const OPENING_COST_POLICY='owner-confirmed-opening-lot-cost-v1';
export const OPENING_COST_MARKER='accounting_control_opening_cost_correction';
const invalid=()=>Error('Reconcile the confirmed opening-stock cost correction before reversing this sale.');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const add=(a,b)=>{const value=a+b;if(!Number.isSafeInteger(value))throw invalid();return value;};
const cents=value=>{try{return journalCents(value);}catch{throw invalid();}};
const milli=value=>{if(!['number','string'].includes(typeof value)||!String(value).trim())throw invalid();const number=Number(value),result=Math.round(number*1000);if(!Number.isFinite(number)||number<0||!Number.isSafeInteger(result)||Math.abs(number*1000-result)>0.0001)throw invalid();return result;};
const correctionId=issueId=>'OCC-'+createHash('sha256').update(OPENING_COST_POLICY+':'+issueId).digest('hex');
const hasMarker=row=>!!row&&Object.hasOwn(row,OPENING_COST_MARKER);
const pointer=full=>({policy:full.policy,id:full.id,journal_id:full.journal_id,requires_corrected_basis_reversal:true});
function checkedPosted(journal,lines,requirePayload=false){
 if(!journal||journal.status!=='posted'||!journal.id||lines.some(line=>line.journal_id!==journal.id||line.status&&!ledgerStatuses.includes(line.status)))throw invalid();
 try{journalDate(journal.entry_date);}catch{throw invalid();}
 if(journal.entry_date>businessDate())throw invalid();
 let checked;try{checked=checkedJournalLines(lines);}catch{throw invalid();}
 if(cents(journal.total_debit)!==cents(checked.debit)||cents(journal.total_credit)!==cents(checked.credit)||new Set(lines.map(line=>line.id)).size!==lines.length)throw invalid();
 const payload=journalPayload({entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines:checked.lines});
 if(requirePayload&&!journal.posting_payload||journal.posting_payload&&journal.posting_payload!==payload)throw invalid();
 return checked.lines;
}
function financialNet(lines,aliases){
 const result=new Map();for(const line of lines){const id=aliases.canonicalId(line.account_id);result.set(id,add(result.get(id)||0,cents(line.debit)-cents(line.credit)));}return result;
}
const equalNet=(a,b)=>[...new Set([...a.keys(),...b.keys()])].every(id=>(a.get(id)||0)===(b.get(id)||0));
function quantitiesAndCosts(rows,costField){
 const result=new Map(),ids=new Set();for(const row of rows){if(!row.id||ids.has(row.id)||!row.product_id||!milli(row.quantity))throw invalid();ids.add(row.id);const previous=result.get(row.product_id)||{quantity:0,value:0};previous.quantity=add(previous.quantity,milli(row.quantity));previous.value=add(previous.value,cents(row[costField]));result.set(row.product_id,previous);}return result;
}
const equalProducts=(a,b)=>[...new Set([...a.keys(),...b.keys()])].every(id=>same(a.get(id),b.get(id)));
function adjustedGroups(lines,description,aliases,accountId,reduction){
 const groups=new Map();for(const line of lines.filter(row=>row.description===description)){const id=aliases.canonicalId(line.account_id),value=description==='Cost of goods sold'?cents(line.debit):cents(line.credit);groups.set(id,add(groups.get(id)||0,value));}
 const id=aliases.canonicalId(accountId),value=add(groups.get(id)||0,-reduction);if(value<0)throw invalid();groups.set(id,value);
 return [...groups].filter(([,value])=>value).map(([account_id,value])=>({account_id,...(description==='Cost of goods sold'?{debit:value/100,credit:0}:{debit:0,credit:value/100}),description}));
}

// A protected, owner-confirmed correction changes the effective basis only.
// Original invoice lines, stock issues and journals remain immutable history.
// No customer balances, stock quantities or current product prices prove cost.
export async function openingSaleCostBasis(stores,{invoice,order,journal,invoiceLines,issues,originalLines,accounts}){
 const [auditRows,correctionHeaders]=await Promise.all([
  readRecords(stores.AuditLog,{action:'correct_opening_lot_cost'}),
  readRecords(stores.JournalEntry,{source_module:'accounting_corrections',source_document_type:'OpeningLotCostCorrection',source_document_id:{$in:issues.filter(row=>row.id).map(row=>correctionId(row.id))},status:{$in:ledgerStatuses}}),
 ]);
 const audits=auditRows.filter(row=>{const full=row[OPENING_COST_MARKER];return full&&(full.source_journal_id===journal?.id||invoice&&full.source_invoice_id===invoice.id||order&&full.source_order_id===order.id);});
 const markedIssues=issues.filter(hasMarker);
 if(![invoice,order,journal].some(hasMarker)&&!markedIssues.length&&!audits.length&&!correctionHeaders.length)return null;
 if(!invoice||!order||!journal||audits.length!==1||correctionHeaders.length!==1||markedIssues.length!==1)throw invalid();
 const full=journal[OPENING_COST_MARKER],audit=audits[0];
 if(!full||typeof full!=='object'||Array.isArray(full)||full.policy!==OPENING_COST_POLICY||full.requires_corrected_basis_reversal!==true||full.stock_disposition!=='fully_sold'||full.id!==correctionId(full.source_issue_id)||audit.id!==full.id||audit.action!=='correct_opening_lot_cost'||audit.module!=='accounting_corrections'||audit.entity_type!=='JournalEntry'||audit.entity_id!==full.journal_id||audit.audit_source!=='server_verified'||audit.accounting_control_opening_cost_policy!==OPENING_COST_POLICY||!same(audit[OPENING_COST_MARKER],full))throw invalid();
 const expectedPointer=pointer(full);
 if(!same(invoice[OPENING_COST_MARKER],expectedPointer)||!same(order[OPENING_COST_MARKER],expectedPointer)||!same(markedIssues[0][OPENING_COST_MARKER],expectedPointer))throw invalid();
 const required=['journal_id','journal_number','date','source_journal_id','source_invoice_id','source_order_id','source_issue_id','source_invoice_line_id','source_stock_balance_id','source_opening_journal_id','source_opening_reclassification_journal_id','source_opening_movement_id','source_opening_audit_id','product_id','inventory_account_id','cogs_account_id','opening_account_id'];
 if(required.some(key=>typeof full[key]!=='string'||!full[key]||full[key].length>200)||typeof full.lot_number!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(full.date)||full.date>businessDate())throw invalid();
 if(full.source_journal_id!==journal.id||full.source_invoice_id!==invoice.id||full.source_order_id!==order.id||invoice.journal_id!==journal.id||invoice.sales_order_id!==order.id||order.invoice_id!==invoice.id||journal.source_module!=='sales'||journal.source_document_type!=='Invoice'||journal.source_document_id!==invoice.id||full.date<journal.entry_date)throw invalid();
 if(typeof full.unit_cost!=='string'||!/^(?:0|[1-9]\d*)\.\d{4}$/.test(full.unit_cost)||!milli(full.quantity))throw invalid();
 const [whole,fraction]=full.unit_cost.split('.'),scaled=BigInt(whole)*10000n+BigInt(fraction),decimalCents=(BigInt(milli(full.quantity))*scaled+50000n)/100000n;
 if(decimalCents>100000000000000n)throw invalid();
 const original=cents(full.original_cost),corrected=cents(full.corrected_cost),reduction=cents(full.cost_reduction);
 if(!reduction||corrected>=original||corrected!==Number(decimalCents)||original-corrected!==reduction)throw invalid();
 const aliases=resolveAccountConsolidations(accounts),inventory=aliases.byId.get(full.inventory_account_id),cogs=aliases.byId.get(aliases.canonicalId(full.cogs_account_id)),opening=aliases.byId.get(full.opening_account_id);
 if(!inventory||inventory.account_type!=='asset'||inventory.normal_balance!=='debit'||!cogs||cogs.account_type!=='cogs'||cogs.normal_balance!=='debit'||!opening||opening.account_type!=='equity'||opening.normal_balance!=='credit'||[inventory,cogs,opening].some(row=>row.is_active===false||row.is_posting===false||row.is_treasury||(row.currency||'XAF')!=='XAF'))throw invalid();
 const [sourceIssues,balance,openingMovement,openingAudit,openingJournal,openingReclassification,correctionLines,sourceHeaders]=await Promise.all([
  readRecords(stores.StockMovement,{document_type:'SalesOrder',document_id:order.id}),stores.StockBalance.get(full.source_stock_balance_id),stores.StockMovement.get(full.source_opening_movement_id),stores.AuditLog.get(full.source_opening_audit_id),stores.JournalEntry.get(full.source_opening_journal_id),stores.JournalEntry.get(full.source_opening_reclassification_journal_id),readRecords(stores.JournalLine,{journal_id:full.journal_id}),readRecords(stores.JournalEntry,{source_module:journal.source_module,source_document_type:journal.source_document_type,source_document_id:journal.source_document_id,status:{$in:ledgerStatuses}}),
 ]);
 if(sourceHeaders.length!==1||sourceHeaders[0].id!==journal.id||sourceIssues.length!==issues.length||sourceIssues.some(row=>!row.id||row.status!=='approved'||row.movement_type!=='customer_delivery'||!row.source_warehouse_id||row.destination_warehouse_id||row.movement_date!==invoice.invoice_date||!issues.some(issue=>same(issue,row))))throw invalid();
 if(invoiceLines.some(line=>line.invoice_id!==invoice.id)||!equalProducts(quantitiesAndCosts(invoiceLines,'cogs_total'),quantitiesAndCosts(sourceIssues,'total_value')))throw invalid();
 const invoiceCost=invoiceLines.reduce((n,row)=>add(n,cents(row.cogs_total)),0),recordedCogs=originalLines.filter(row=>row.description==='Cost of goods sold'),recordedInventory=originalLines.filter(row=>row.description==='Inventory released');
 if(recordedCogs.some(row=>cents(row.credit)!==0||aliases.byId.get(aliases.canonicalId(row.account_id))?.account_type!=='cogs')||recordedInventory.some(row=>cents(row.debit)!==0||aliases.byId.get(row.account_id)?.account_type!=='asset')||recordedCogs.reduce((n,row)=>add(n,cents(row.debit)),0)!==invoiceCost||recordedInventory.reduce((n,row)=>add(n,cents(row.credit)),0)!==invoiceCost)throw invalid();
 const issue=sourceIssues.find(row=>row.id===full.source_issue_id),line=invoiceLines.find(row=>row.id===full.source_invoice_line_id);
 if(!issue||markedIssues[0].id!==issue.id||!line||issue.product_id!==full.product_id||line.product_id!==full.product_id||(issue.lot_number||'')!==full.lot_number||milli(issue.quantity)!==milli(full.quantity)||milli(line.quantity)!==milli(full.quantity)||cents(issue.total_value)!==original||cents(line.cogs_total)!==original)throw invalid();
 if(!balance||balance.product_id!==full.product_id||balance.warehouse_id!==issue.source_warehouse_id||(balance.lot_number||'')!==full.lot_number||milli(balance.quantity)!==0||cents(balance.total_value)!==0)throw invalid();
 if(!openingMovement||openingMovement.status!=='approved'||openingMovement.document_type!=='WarehouseAdjustment'||openingMovement.document_id!==full.source_opening_audit_id||openingMovement.source_warehouse_id||openingMovement.destination_warehouse_id!==issue.source_warehouse_id||openingMovement.product_id!==full.product_id||(openingMovement.lot_number||'')!==full.lot_number||milli(openingMovement.quantity)!==milli(full.quantity)||cents(openingMovement.total_value)!==original)throw invalid();
 const openingResult=openingAudit?.warehouse_adjustment_result,openingRows=openingResult?.rows?.filter(row=>row.balance_id===balance.id);
 if(!openingAudit||openingAudit.audit_source!=='server_verified'||openingAudit.action!=='warehouse_quantity_adjusted'||openingAudit.module!=='inventory_adjustment'||openingAudit.id!==full.source_opening_audit_id||openingResult?.journal_id!==full.source_opening_journal_id||openingRows?.length!==1)throw invalid();
 const openingRow=openingRows[0];
 if(openingRow.product_id!==full.product_id||openingRow.warehouse_id!==issue.source_warehouse_id||(openingRow.lot_number||'')!==full.lot_number||milli(openingRow.book_quantity)!==0||cents(openingRow.book_value)!==0||milli(openingRow.counted_quantity)!==milli(full.quantity)||milli(openingRow.difference)!==milli(full.quantity)||cents(openingRow.value_after)!==original||cents(openingRow.value_difference)!==original)throw invalid();
 const [openingLines,setupLines]=await Promise.all([readRecords(stores.JournalLine,{journal_id:full.source_opening_journal_id}),readRecords(stores.JournalLine,{journal_id:full.source_opening_reclassification_journal_id})]);
 checkedPosted(journal,originalLines);checkedPosted(openingJournal,openingLines);checkedPosted(openingReclassification,setupLines);
 if(openingJournal.source_module!=='inventory_adjustment'||openingJournal.source_document_type!=='WarehouseAdjustment'||openingJournal.source_document_id!==openingAudit.id||openingJournal.entry_date>journal.entry_date||openingJournal.setup_stock_correction_journal_id!==openingReclassification.id||openingReclassification.source_module!=='accounting_corrections'||openingReclassification.source_document_type!=='SetupStockCorrection'||openingReclassification.source_document_id!==openingJournal.id||openingReclassification.setup_stock_source_journal_id!==openingJournal.id||openingResult.date!==openingJournal.entry_date||openingLines.filter(row=>row.account_id===inventory.id).reduce((n,row)=>add(n,cents(row.debit)),0)<original)throw invalid();
 const expectedSetup=new Map(),profitTypes=['revenue','other_income','expense','other_expense','cogs'];let profitNet=0;
 for(const row of openingLines){const account=aliases.byId.get(row.account_id);if(!account)throw invalid();if(!profitTypes.includes(account.account_type))continue;const value=cents(row.debit)-cents(row.credit),id=aliases.canonicalId(row.account_id);expectedSetup.set(id,add(expectedSetup.get(id)||0,-value));profitNet=add(profitNet,value);}
 expectedSetup.set(opening.id,add(expectedSetup.get(opening.id)||0,profitNet));if(!equalNet(expectedSetup,financialNet(setupLines,aliases)))throw invalid();
 const correction=correctionHeaders[0];
 checkedPosted(correction,correctionLines,true);
 if(correction.id!==full.journal_id||correction.journal_number!==full.journal_number||correction.entry_date!==full.date||correction.source_document_id!==full.id||correction.is_immutable!==true||!audit.user_id||correction.posted_by!==audit.user_id||correctionLines.filter(row=>cents(row.debit)||cents(row.credit)).length!==2||!equalNet(financialNet(correctionLines,aliases),new Map([[opening.id,reduction],[cogs.id,-reduction]])))throw invalid();
 const effectiveCogsLines=adjustedGroups(originalLines,'Cost of goods sold',aliases,full.cogs_account_id,reduction),effectiveInventoryLines=adjustedGroups(originalLines,'Inventory released',aliases,inventory.id,reduction);
 const cost=add(invoiceCost,-reduction);
 if(cost<0||effectiveCogsLines.reduce((n,row)=>add(n,cents(row.debit)),0)!==cost||effectiveInventoryLines.reduce((n,row)=>add(n,cents(row.credit)),0)!==cost)throw invalid();
 const effectiveIssues=issues.map(row=>row.id===issue.id?{...row,total_value:corrected/100,unit_cost:corrected/100/Number(row.quantity)}:row);
 if(effectiveIssues.reduce((n,row)=>add(n,cents(row.total_value)),0)!==cost)throw invalid();
 return {cost:cost/100,issues:effectiveIssues,effectiveCogsLines,effectiveInventoryLines,proof:{correction:full,audit,correctionJournal:correction,correctionLines,openingJournal,openingLines,openingReclassification,setupLines,openingAudit,openingMovement,balance,originalIssue:issue,originalInvoiceLine:line},review:{policy:OPENING_COST_POLICY,corrected:true}};
}
