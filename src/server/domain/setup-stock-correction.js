import {createHash} from 'node:crypto';
import {requireOpeningAccess} from './opening-balances.js';
import {readRecords} from './commercial-workspace.js';
import {postJournal} from './field-ops.js';
import {checkedJournalLines,journalCents,journalDate,journalPayload,ledgerStatuses} from './journal-validation.js';
import {businessDate} from '../../lib/business-date.js';
import {countVariance} from '../../lib/inventory-audit.js';

const policy='reviewed-setup-stock-equity-v1';
const profitTypes=new Set(['revenue','other_income','expense','other_expense','cogs']);
const inventoryRules=new Set(['raw_material_inventory','finished_goods_inventory','packaging_inventory','work_in_progress_inventory']);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const ordered=rows=>[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
const accountView=a=>({id:a.id,account_number:a.account_number||'',name:a.name||''});
const active=a=>a&&a.is_active!==false&&a.is_posting!==false&&(!a.currency||a.currency==='XAF');
const warehouseSource=j=>j.source_module==='inventory_adjustment'&&j.source_document_type==='WarehouseAdjustment';
const auditSource=j=>j.source_module==='inventory_audit'&&j.source_document_type==='InventoryAudit';
const eligibleSource=j=>warehouseSource(j)||auditSource(j);
const add=(a,b)=>{const result=a+b;if(!Number.isSafeInteger(result))throw fail('Ledger totals exceed the supported precision.');return result;};

async function state(s){
  const [accounts,journals,lines,treasury,periods,products,rules,audits,movements]=await Promise.all([
    readRecords(s.Account),readRecords(s.JournalEntry),readRecords(s.JournalLine),readRecords(s.TreasuryAccount),readRecords(s.AccountingPeriod),
    readRecords(s.Product),readRecords(s.PostingRule),readRecords(s.AuditLog,{$or:[{module:'inventory_adjustment',action:'warehouse_quantity_adjusted'},{module:'inventory_audit',entity_type:'InventoryAudit'}]}),
    readRecords(s.StockMovement,{document_type:{$in:['WarehouseAdjustment','InventoryAudit']}}),
  ]);
  const byAccount=new Map(accounts.map(a=>[a.id,a])),byJournal=new Map(journals.map(j=>[j.id,j]));
  const treasuryIds=new Set(treasury.map(t=>t.gl_account_id));
  const inventoryIds=new Set([...products.map(p=>p.inventory_account_id),...rules.filter(r=>inventoryRules.has(r.rule_key)).map(r=>r.account_id)].filter(Boolean));
  return {accounts,journals,lines,treasury,periods,products,rules,audits,movements,byAccount,byJournal,treasuryIds,inventoryIds};
}
const isCash=(t,a)=>a?.is_treasury||t.treasuryIds.has(a?.id)||a?.account_number==='1050';
const validEquity=(t,a)=>active(a)&&a.account_type==='equity'&&a.normal_balance==='credit'&&!a.is_control_account&&!isCash(t,a);
const lineView=(t,l)=>({account_id:l.account_id,account_number:t.byAccount.get(l.account_id)?.account_number||l.account_number||'',account_name:t.byAccount.get(l.account_id)?.name||l.account_name||'',account_type:t.byAccount.get(l.account_id)?.account_type||'',debit:Number(l.debit||0),credit:Number(l.credit||0)});

function discoverable(t,j){
  if(eligibleSource(j))return true;
  const lines=t.lines.filter(l=>l.journal_id===j.id&&(Number(l.debit)||Number(l.credit)));
  return lines.some(l=>t.inventoryIds.has(l.account_id)&&t.byAccount.get(l.account_id)?.account_type==='asset'&&t.byAccount.get(l.account_id)?.normal_balance==='debit')&&lines.some(l=>profitTypes.has(t.byAccount.get(l.account_id)?.account_type));
}
function countEvidence(t,j){
  if(!auditSource(j)){
    const audit=t.audits.find(a=>a.id===j.source_document_id&&a.module==='inventory_adjustment'&&a.action==='warehouse_quantity_adjusted');
    return {audit,record:audit?.warehouse_adjustment_result,balanceKey:'warehouse_adjustment_balance_id',date:audit?.warehouse_adjustment_result?.date,reference:audit?.warehouse_adjustment_result?.reference||'',approval:null};
  }
  const history=t.audits.filter(a=>a.module==='inventory_audit'&&a.entity_type==='InventoryAudit'&&a.entity_id===j.source_document_id);
  const posted=history.filter(a=>a.action==='inventoryAuditPost'&&a.inventory_audit_state?.status==='posted'&&a.inventory_audit_state?.journal_id===j.id);
  const audit=posted.length===1?posted[0]:null,record=audit?.inventory_audit_state;
  const approvals=history.filter(a=>a.action==='inventoryAuditApprove'&&a.inventory_audit_state?.revision===record?.revision-1);
  const approval=approvals.length===1?approvals[0]:null;
  const latest=history.reduce((n,a)=>Math.max(n,Number(a.inventory_audit_state?.revision)||0),0);
  return {audit,record,approval,latest,history,balanceKey:'inventory_audit_balance_id',date:record?.posting_date,reference:record?.evidence_reference||''};
}
function financialShape(lines){
  const amounts=new Map();
  for(const l of checkedJournalLines(lines).lines)for(const side of ['debit','credit']){
    const value=journalCents(l[side]);if(value){const key=l.account_id+':'+side;amounts.set(key,add(amounts.get(key)||0,value));}
  }
  return [...amounts].sort(([a],[b])=>a.localeCompare(b));
}
function verifyAuditEvidence(t,j,evidence,sourceLines){
  const {audit,record,approval,history,latest}=evidence,approved=approval?.inventory_audit_state;
  const invalid='The posted inventory audit and its independent approval do not match this journal.';
  if(!audit||!record||!approval||!approved||audit.audit_source!=='server_verified'||approval.audit_source!=='server_verified'||record.id!==j.source_document_id||record.status!=='posted'||record.managed_location!==false
    ||!Number.isSafeInteger(record.revision)||record.revision!==latest||record.revision<2||history.filter(a=>a.inventory_audit_state?.revision===record.revision).length!==1
    ||history.filter(a=>a.inventory_audit_state?.revision===approved.revision).length!==1||approved.status!=='approved'
    ||!record.posted_by||audit.user_id!==record.posted_by||j.posted_by!==record.posted_by||!record.approved_by||approval.user_id!==record.approved_by
    ||!Array.isArray(record.makers)||!record.makers.length||record.makers.includes(record.approved_by)
    ||!record.evidence_reference||record.evidence_reference.length<5||!record.approved_at||!record.posted_at)throw fail(invalid);
  for(const key of ['id','warehouse_id','warehouse_name','managed_location','rows','makers','approved_by','approved_at','approved_plan','evidence_reference','loss_account_id','gain_account_id'])if(JSON.stringify(canonical(approved[key]))!==JSON.stringify(canonical(record[key])))throw fail(invalid);
  if(!Array.isArray(record.approved_plan)||!Array.isArray(record.rows)||!record.rows.length)throw fail('An inventory-audit correction requires its original approved posting plan.');
  const expected=[],ids=new Set();
  for(const row of record.rows){
    if(!row.balance_id||ids.has(row.balance_id)||!row.product_id||row.warehouse_id!==record.warehouse_id||!row.inventory_account_id||!t.inventoryIds.has(row.inventory_account_id))throw fail('The inventory-audit rows, movements and journal accounts do not reconcile.');
    ids.add(row.balance_id);
    const variance=countVariance(row,row.counted_quantity);
    if(['difference','value_difference','value_after'].some(key=>Number(row[key])!==variance[key]))throw fail('The inventory-audit rows, movements and journal accounts do not reconcile.');
    if(!variance.difference)continue;
    const value=Math.abs(variance.value_difference);if(!value)continue;
    const inventory=t.byAccount.get(row.inventory_account_id),profit=t.byAccount.get(variance.value_difference<0?record.loss_account_id:record.gain_account_id);
    if(!inventory||inventory.account_type!=='asset'||inventory.normal_balance!=='debit'||!active(profit)||isCash(t,profit)||profit.normal_balance!==(variance.value_difference<0?'debit':'credit')||!(variance.value_difference<0?['expense','other_expense','cogs']:['other_income']).includes(profit.account_type))throw fail('The inventory-audit rows, movements and journal accounts do not reconcile.');
    expected.push({account_id:inventory.id,debit:variance.value_difference>0?value:0,credit:variance.value_difference<0?value:0},{account_id:profit.id,debit:variance.value_difference<0?value:0,credit:variance.value_difference>0?value:0});
  }
  if(hash(financialShape(expected))!==hash(financialShape(record.approved_plan))||hash(financialShape(record.approved_plan))!==hash(financialShape(sourceLines)))throw fail('The inventory-audit rows, movements and journal accounts do not reconcile.');
}

function candidate(t,j){
  const reasons=[],sourceLines=t.lines.filter(l=>l.journal_id===j.id),evidence=countEvidence(t,j),{audit,record}=evidence;
  const moves=t.movements.filter(m=>m.document_type===j.source_document_type&&m.document_id===j.source_document_id);
  const prior=t.journals.filter(r=>r.source_document_type==='SetupStockCorrection'&&r.source_document_id===j.id);
  const corrected=!!j.setup_stock_correction_id||!!j.setup_stock_correction_journal_id||prior.length>0;
  if(!eligibleSource(j)||!j.source_document_id)reasons.push('This inventory and profit-and-loss journal requires review through its original workflow. Setup correction supports only verified warehouse adjustments and inventory audits.');
  if(j.status!=='posted'||j.reversal_of||j.reversed_by_journal||j.reversed_at||t.journals.some(r=>r.reversal_of===j.id&&ledgerStatuses.includes(r.status)))reasons.push('A reversed or unposted source cannot be reclassified.');
  if(corrected)reasons.push('This source already has a setup correction.');
  try{journalDate(j.entry_date);if(j.entry_date>businessDate())throw Error();}catch{reasons.push('The source journal needs a valid date no later than today.');}
  const periods=t.periods.filter(p=>p.start_date<=j.entry_date&&p.end_date>=j.entry_date);
  if(!periods.length||periods.some(p=>p.status!=='open'))reasons.push('The original journal date must be in an open accounting period.');
  if(!audit||record?.journal_id!==j.id||evidence.date!==j.entry_date)reasons.push('The original stock-count audit does not match this journal.');
  if(!moves.length||moves.some(m=>m.journal_id!==j.id||m.movement_type!=='stock_count_variance'||m.status!=='approved'||m.movement_date!==j.entry_date))reasons.push('The source needs matching approved stock-count movements.');
  const inventory=[],profit=[];let profitCents=0;
  // Unsupported sources can also contain receivables or other asset lines.
  // Show their complete P&L effect even though those sources cannot be corrected.
  try{for(const l of sourceLines)if(profitTypes.has(t.byAccount.get(l.account_id)?.account_type))profitCents=add(profitCents,journalCents(l.credit)-journalCents(l.debit));}catch{profitCents=0;}
  try{
    if(sourceLines.some(l=>l.status&&l.status!=='posted'||l.party_type||l.party_id||l.opening_party_allocations?.length))throw fail('Party allocations or non-posted source lines require separate reconciliation.');
    const checked=checkedJournalLines(sourceLines);
    if(journalCents(j.total_debit)!==journalCents(checked.debit)||journalCents(j.total_credit)!==journalCents(checked.credit))throw fail('The original journal totals do not match its lines.');
    const payload=journalPayload({entryDate:j.entry_date,description:j.description,sourceModule:j.source_module,sourceDocumentType:j.source_document_type,lines:checked.lines});
    if(j.posting_payload&&j.posting_payload!==payload)throw fail('The original journal evidence has changed.');
    for(const l of checked.lines){
      const a=t.byAccount.get(l.account_id);
      if(!a||isCash(t,a)||a.currency&&a.currency!=='XAF')throw fail('Cash, treasury or missing accounts cannot use this correction.');
      if(a.account_type==='asset'&&a.normal_balance==='debit'&&t.inventoryIds.has(a.id))inventory.push(l);
      else if(profitTypes.has(a.account_type)&&active(a)&&!a.is_control_account){
        if(!['debit','credit'].includes(a.normal_balance))throw fail('A source account has an invalid normal balance.');
        profit.push(l);
      }else throw fail('Only mapped inventory assets and active profit-and-loss accounts are eligible.');
    }
    if(!inventory.length||!profit.length)throw fail('The source must contain inventory and profit-and-loss entries.');
    if(auditSource(j))verifyAuditEvidence(t,j,evidence,sourceLines);
    const stockNet=inventory.reduce((sum,l)=>add(sum,journalCents(l.debit)-journalCents(l.credit)),0);
    // A physical count can reduce quantity while increasing carrying value.
    // Movement direction follows quantity; signed value comes from its audited row.
    const auditRows=record?.rows;
    if(!Array.isArray(auditRows))throw fail('The count audit, inventory movements and journal values do not reconcile.');
    const usedMoves=new Set();let movementNet=0;
    for(const row of auditRows){
      const difference=Number(row.difference),valueDifference=Number(row.value_difference);
      if(row.difference==null||row.value_difference==null||!Number.isFinite(difference)||!Number.isFinite(valueDifference))throw fail('The count audit, inventory movements and journal values do not reconcile.');
      const valueCents=journalCents(Math.abs(valueDifference))*(valueDifference<0?-1:1);
      if(!difference&&!valueCents)continue;
      const matches=moves.filter(m=>row.balance_id&&m[evidence.balanceKey]===row.balance_id&&m.product_id===row.product_id);
      if(matches.length!==1||usedMoves.has(matches[0].id))throw fail('The count audit, inventory movements and journal values do not reconcile.');
      const m=matches[0],incoming=(difference||valueDifference)>0;
      if(!row.warehouse_id||m[incoming?'destination_warehouse_id':'source_warehouse_id']!==row.warehouse_id||m[incoming?'source_warehouse_id':'destination_warehouse_id'])throw fail('The count movement direction needs reconciliation.');
      if(Number(m.quantity)!==Math.abs(difference)||journalCents(m.total_value)!==Math.abs(valueCents))throw fail('The count audit, inventory movements and journal values do not reconcile.');
      if(auditSource(j)&&['lot_number','batch_number','expiry_date','production_order_id'].some(key=>(row[key]||'')!==(m[key]||'')))throw fail('The inventory-audit rows, movements and journal accounts do not reconcile.');
      usedMoves.add(m.id);movementNet=add(movementNet,valueCents);
    }
    const value=auditSource(j)?auditRows.reduce((n,row)=>n+Number(row.value_difference),0):Number(record?.value_difference);
    if(usedMoves.size!==moves.length||!Number.isFinite(value)||Math.abs(value*100-Math.round(value*100))>0.0001||stockNet!==Math.round(value*100)||stockNet!==movementNet)throw fail('The count audit, inventory movements and journal values do not reconcile.');
  }catch(error){reasons.push(error.message);}
  return {journal_id:j.id,journal_number:j.journal_number||j.id,date:j.entry_date||'',description:j.description||'',source_module:j.source_module||'',source_document_type:j.source_document_type||'',supported_source:eligibleSource(j),source_reference:evidence.reference||j.source_document_id||'',profit_effect:profitCents/100,eligible:reasons.length===0,blocked_reasons:[...new Set(reasons)],corrected,lines:sourceLines.map(l=>lineView(t,l)),source:j,sourceLines,audit:auditSource(j)?{posted:audit,approval:evidence.approval}:audit,moves,profit,periods};
}
function publicCandidate(c){const {source,sourceLines,audit,moves,profit,periods,...result}=c;return result;}

export async function setupStockCorrectionWorkspace(s,context){
  requireOpeningAccess(context);const t=await state(s);
  return {date:businessDate(),candidates:t.journals.filter(j=>discoverable(t,j)).sort((a,b)=>String(b.entry_date).localeCompare(String(a.entry_date))||String(a.id).localeCompare(String(b.id))).map(j=>publicCandidate(candidate(t,j))),equity_accounts:t.accounts.filter(a=>validEquity(t,a)).map(accountView)};
}
function selection(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['action','journalIds','offsetAccountId','accountingStartDate','reference','confirmSetup','token','requestKey','confirmed'].includes(k)))throw fail('Choose complete setup journals using the correction form.');
  if(body.confirmSetup!==true)throw fail('Confirm that every selected journal recorded opening or setup stock.');
  if(!Array.isArray(body.journalIds)||!body.journalIds.length||body.journalIds.length>100||body.journalIds.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(body.journalIds).size!==body.journalIds.length)throw fail('Select between 1 and 100 different setup journals.');
  const date=journalDate(body.accountingStartDate);if(date>businessDate())throw fail('The accounting start date cannot be in the future.');
  if(typeof body.offsetAccountId!=='string'||!body.offsetAccountId)throw fail('Choose an opening equity clearing account.');
  if(typeof body.reference!=='string'||body.reference.trim().length<3||body.reference.trim().length>500)throw fail('Enter a setup reference of 3 to 500 characters.');
  return {policy,journalIds:[...body.journalIds].sort(),offsetAccountId:body.offsetAccountId,accountingStartDate:date,reference:body.reference.trim(),confirmSetup:true};
}
function ledgerNet(t,id){
  let net=0;
  for(const l of t.lines.filter(l=>l.account_id===id&&ledgerStatuses.includes(t.byJournal.get(l.journal_id)?.status))){
    if(l.status&& !ledgerStatuses.includes(l.status))throw fail('Reconcile inconsistent posted lines in the affected accounts first.');
    const d=journalCents(l.debit),c=journalCents(l.credit);if(d&&c)throw fail('Reconcile invalid posted amounts in the affected accounts first.');
    net=add(net,d-c);
  }
  return net;
}
function plan(t,selected){
  const offset=t.byAccount.get(selected.offsetAccountId);
  if(!validEquity(t,offset))throw fail('Choose an active posting equity account for opening clearing.');
  const chosen=selected.journalIds.map(id=>{const j=t.byJournal.get(id);if(!j)throw fail('A selected source journal is missing.');return candidate(t,j);});
  for(const c of chosen){if(!c.eligible)throw fail(c.journal_number+': '+c.blocked_reasons.join(' '));if(c.date>selected.accountingStartDate)throw fail('Setup sources must be dated on or before the accounting start date.');}
  const affected=new Set([offset.id,...chosen.flatMap(c=>c.profit.map(l=>l.account_id))]);
  for(const id of affected){const a=t.byAccount.get(id),net=ledgerNet(t,id),expected=net*(a.normal_balance==='credit'?-1:1);if(!Number.isFinite(Number(a.balance||0))||Math.abs(Number(a.balance||0)*100-expected)>0.001)throw fail('Reconcile affected account balances with the posted ledger before correcting setup stock.');}
  let total=0;
  const journals=chosen.map(c=>{
    const amounts=new Map();
    for(const l of c.profit)amounts.set(l.account_id,add(amounts.get(l.account_id)||0,journalCents(l.credit)-journalCents(l.debit)));
    const lines=[...amounts].filter(([,amount])=>amount!==0).map(([account_id,amount])=>({account_id,debit:Math.max(0,amount)/100,credit:Math.max(0,-amount)/100}));
    const amount=[...amounts.values()].reduce(add,0);
    if(amount)lines.push({account_id:offset.id,debit:Math.max(0,-amount)/100,credit:Math.max(0,amount)/100});
    if(!lines.length)throw fail('The selected source has no net profit-and-loss balance to reclassify.');
    checkedJournalLines(lines);total=add(total,-amount);
    return {source_journal_id:c.journal_id,journal_number:c.journal_number,date:c.date,profit_effect:amount/100,profit_adjustment:-amount/100,lines:lines.map(l=>lineView(t,l))};
  });
  const token=hash({selected,sources:chosen.map(c=>({journal:c.source,lines:ordered(c.sourceLines),audit:c.audit,movements:ordered(c.moves),periods:ordered(c.periods)})),accounts:ordered(t.accounts.filter(a=>affected.has(a.id)||chosen.some(c=>c.sourceLines.some(l=>l.account_id===a.id)))),products:ordered(t.products),rules:ordered(t.rules),treasury:ordered(t.treasury)});
  return {token,accounting_start_date:selected.accountingStartDate,reference:selected.reference,offset_account:accountView(offset),journals,total_profit_adjustment:total/100,stock_change:0,cash_change:0};
}
export async function previewSetupStockCorrection(s,context,body){
  requireOpeningAccess(context);return plan(await state(s),selection(body));
}
export async function postSetupStockCorrection(s,context,body){
  requireOpeningAccess(context);const selected=selection(body);
  if(body.confirmed!==true||!/^[a-f\d-]{36}$/i.test(body.requestKey||'')||!/^[a-f\d]{64}$/.test(body.token||''))throw fail('Review and confirm the setup-stock correction first.');
  const id='SSC-'+hash([context.user.id,body.requestKey]),payload=hash({selected,userId:context.user.id,requestKey:body.requestKey,token:body.token});
  const previous=await s.AuditLog.get(id);
  if(previous){
    if(previous.audit_source!=='server_verified'||previous.action!=='correct_setup_stock'||previous.setup_stock_correction_policy!==policy||previous.setup_stock_correction_payload!==payload)throw fail('This correction reference was already used with different details.',409);
    return {...previous.setup_stock_correction_result,reused:true};
  }
  const t=await state(s),preview=plan(t,selected);
  if(preview.token!==body.token)throw fail('The journals or account settings changed. Review the setup correction again.',409);
  const journals=[];
  for(const row of preview.journals){
    const result=await postJournal({entities:s},{entryDate:row.date,description:'Setup stock reclassification: '+row.journal_number+' / '+selected.reference,sourceModule:'accounting_corrections',sourceDocumentType:'SetupStockCorrection',sourceDocumentId:row.source_journal_id,userId:context.user.id,lines:row.lines.map(({account_id,debit,credit})=>({account_id,debit,credit}))});
    if(result.reused)throw fail('This source has a correction that needs reconciliation.',409);
    await s.JournalEntry.update(result.journal.id,{setup_stock_correction_id:id,setup_stock_source_journal_id:row.source_journal_id,setup_stock_accounting_start_date:selected.accountingStartDate,setup_stock_correction_reference:selected.reference});
    await s.JournalEntry.update(row.source_journal_id,{setup_stock_correction_id:id,setup_stock_correction_journal_id:result.journal.id});
    journals.push({source_journal_id:row.source_journal_id,journal_id:result.journal.id,journal_number:result.journal.journal_number,date:row.date,profit_adjustment:row.profit_adjustment});
  }
  const result={correction_id:id,journals,total_profit_adjustment:preview.total_profit_adjustment,stock_change:0,cash_change:0,reused:false};
  await s.AuditLog.create({id,action:'correct_setup_stock',module:'accounting_corrections',entity_type:'JournalEntry',entity_id:journals[0].journal_id,user_id:context.user.id,audit_source:'server_verified',description:'Reclassified explicitly reviewed setup stock entries into opening equity: '+selected.reference,setup_stock_correction_policy:policy,setup_stock_correction_payload:payload,setup_stock_correction_selection:selected,setup_stock_correction_preview:preview,setup_stock_correction_sources:selected.journalIds.map(sourceId=>({journal:t.byJournal.get(sourceId),lines:ordered(t.lines.filter(l=>l.journal_id===sourceId))})),setup_stock_correction_result:result});
  return result;
}
