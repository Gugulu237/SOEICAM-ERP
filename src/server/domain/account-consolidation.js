import {createHash} from 'node:crypto';
import catalog from '../generated/schema.json' with {type:'json'};
import {requireActiveContext,forbidden} from '../access.js';
import {principalRole} from './roles.js';
import {assertModule} from './role-catalogue.js';
import {readRecords} from './commercial-workspace.js';
import {postJournal} from './field-ops.js';
import {journalCents,journalDate,ledgerStatuses,checkedJournalLines,journalPayload} from './journal-validation.js';
import {businessDate} from '../../lib/business-date.js';
import {validPostingRuleAccount} from '../../lib/posting-rule-types.js';
import {resolveAccountConsolidations} from '../../lib/account-consolidation.js';

const policy='cogs-consolidation-v1';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const ordered=rows=>[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
const accountView=account=>({id:account.id,account_number:account.account_number,name:account.name});
const signedCents=value=>{const amount=Number(value||0);return journalCents(Math.abs(amount))*(amount<0?-1:1);};
const add=(left,right)=>{const value=left+right;if(!Number.isSafeInteger(value))throw fail('Ledger totals exceed the supported precision.');return value;};

function requireAdministrator(context){
  if(requireActiveContext(context)!=='admin'||principalRole(context.user,context.employee)!=='admin')throw forbidden('Only administrators can consolidate COGS accounts.');
  assertModule({...context,role:'admin'},'accounting');
}
function selection(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['action','sourceAccountId','targetAccountId','date','reference','token','requestKey','confirmed'].includes(key)))throw fail('Choose the source and destination COGS accounts through the consolidation form.');
  const {sourceAccountId,targetAccountId}=body;
  if(typeof sourceAccountId!=='string'||!sourceAccountId||typeof targetAccountId!=='string'||!targetAccountId||sourceAccountId===targetAccountId)throw fail('Choose two different COGS accounts.');
  const date=journalDate(body.date);if(date>businessDate())throw fail('Choose a consolidation date no later than today.');
  if(typeof body.reference!=='string'||body.reference.trim().length<3||body.reference.trim().length>500)throw fail('Enter a consolidation reference of 3 to 500 characters.');
  return {policy,sourceAccountId,targetAccountId,date,reference:body.reference.trim()};
}
async function state(stores){
  const names=['Account','JournalEntry','JournalLine','Product','PostingRule','AccountingPeriod',...['Budget','CompanySettings','FixedAsset','TreasuryAccount'].filter(name=>catalog[name])];
  const tables=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readRecords(stores[name])])));
  return tables;
}
function references(value,source){
  if(!value||typeof value!=='object')return false;
  return Object.entries(value).some(([key,item])=>/(^|_)account_id$/.test(key)?item===source.id:/(^|_)account_number$/.test(key)?item===source.account_number:references(item,source));
}
function ledgerNet(tables,account){
  const headers=new Map(tables.JournalEntry.map(journal=>[journal.id,journal]));let net=0;
  for(const line of tables.JournalLine.filter(row=>row.account_id===account.id)){
    const header=headers.get(line.journal_id);
    if(!header)throw fail('Reconcile orphan journal lines before consolidating accounts.');
    if(!ledgerStatuses.includes(header.status))continue;
    journalDate(header.entry_date);
    if(line.status&&!ledgerStatuses.includes(line.status)||line.party_id||line.party_type||line.opening_party_allocations?.length)throw fail('Reconcile the posted account lines before consolidating COGS.');
    const debit=journalCents(line.debit),credit=journalCents(line.credit);if(debit&&credit)throw fail('Reconcile the posted account lines before consolidating COGS.');
    net=add(net,debit-credit);
  }
  if(signedCents(account.balance)!==net)throw fail('Reconcile the account balances with the posted ledger before consolidation.');
  return net;
}
function plan(tables,selected){
  const byId=new Map(tables.Account.map(account=>[account.id,account])),source=byId.get(selected.sourceAccountId),target=byId.get(selected.targetAccountId);
  resolveAccountConsolidations(tables.Account);
  for(const account of [source,target])if(!account||account.account_type!=='cogs'||account.normal_balance!=='debit'||account.is_active===false||account.is_posting===false||account.is_treasury||account.is_control_account||(account.currency||'XAF')!=='XAF'||account.consolidated_into_account_id)throw fail('Choose active debit-normal XAF COGS posting accounts that have not been consolidated.');
  if(source.is_system||source.opening_balance_recorded||source.recurring_expense)throw fail('Keep system, opening-balance and recurring accounts outside COGS consolidation.');
  if(tables.Account.some(account=>account.parent_id===source.id||account.consolidated_into_account_id===source.id))throw fail('Consolidate the source account sub-accounts and aliases separately first.');
  if(tables.Account.some(account=>account.id!==source.id&&account.account_number===source.account_number)||tables.Account.some(account=>account.id!==target.id&&account.account_number===target.account_number))throw fail('Reconcile duplicate account numbers before consolidation.');
  const periods=tables.AccountingPeriod.filter(period=>period.start_date<=selected.date&&period.end_date>=selected.date);
  if(!periods.length||periods.some(period=>period.status!=='open'))throw fail('Choose a consolidation date in an open accounting period.');
  const sourceNet=ledgerNet(tables,source),targetNet=ledgerNet(tables,target),products=tables.Product.filter(product=>product.cogs_account_id===source.id),rules=tables.PostingRule.filter(rule=>rule.account_id===source.id);
  const affected=new Set([source.id,target.id]),journalIds=new Set(tables.JournalLine.filter(line=>affected.has(line.account_id)).map(line=>line.journal_id)),journals=tables.JournalEntry.filter(journal=>journalIds.has(journal.id)),evidence=tables.JournalLine.filter(line=>journalIds.has(line.journal_id));
  for(const journal of journals.filter(journal=>ledgerStatuses.includes(journal.status))){
    const lines=evidence.filter(line=>line.journal_id===journal.id),checked=checkedJournalLines(lines);
    if(lines.some(line=>line.status&&!ledgerStatuses.includes(line.status))||journalCents(journal.total_debit)!==journalCents(checked.debit)||journalCents(journal.total_credit)!==journalCents(checked.credit)||journal.posting_payload&&journal.posting_payload!==journalPayload({entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines:checked.lines}))throw fail('Reconcile the complete posted journals before consolidating COGS.');
    if(journal.entry_date>selected.date&&lines.some(line=>line.account_id===source.id))throw fail("Choose a consolidation date on or after the source account's latest posted entry.");
  }
  const unsupported=[];
  for(const journal of journals.filter(journal=>journal.status==='draft'&&evidence.some(line=>line.journal_id===journal.id&&line.account_id===source.id)))unsupported.push({entity:'JournalEntry',id:journal.id,name:journal.journal_number||journal.id});
  for(const rule of rules)if(!validPostingRuleAccount(target,rule.rule_key))unsupported.push({entity:'PostingRule',id:rule.id,name:rule.label||rule.rule_key});
  for(const product of tables.Product)if(['revenue_account_id','inventory_account_id'].some(key=>product[key]===source.id))unsupported.push({entity:'Product',id:product.id,name:product.name});
  for(const name of ['Budget','CompanySettings','FixedAsset','TreasuryAccount'])for(const row of tables[name]||[])if(references(row,source))unsupported.push({entity:name,id:row.id,name:row.name||row.company_name||row.id});
  for(const account of tables.Account.filter(account=>account.id!==source.id))if(references(account.recurring_expense,source))unsupported.push({entity:'Account',id:account.id,name:account.name});
  const lines=sourceNet?[{account_id:target.id,debit:Math.max(0,sourceNet)/100,credit:Math.max(0,-sourceNet)/100},{account_id:source.id,debit:Math.max(0,-sourceNet)/100,credit:Math.max(0,sourceNet)/100}]:[];
  const token=hash({selected,accounts:ordered(tables.Account),products:ordered(tables.Product),rules:ordered(tables.PostingRule),periods:ordered(tables.AccountingPeriod),unsupported,lines:ordered(evidence),journals:ordered(journals)});
  return {token,source_account:accountView(source),target_account:{...accountView(target),name:'Cost of Goods Sold'},date:selected.date,reference:selected.reference,transfer_lines:lines,source_balance:sourceNet/100,target_balance:targetNet/100,combined_balance:add(sourceNet,targetNet)/100,products_count:products.length,rules_count:rules.length,unsupported_references:unsupported,profit_change:0};
}
export async function previewAccountConsolidation(stores,context,body){
  requireAdministrator(context);return plan(await state(stores),selection(body));
}
export async function postAccountConsolidation(stores,context,body){
  requireAdministrator(context);const selected=selection(body);
  if(body.confirmed!==true||!/^[a-f\d-]{36}$/i.test(body.requestKey||'')||!/^[a-f\d]{64}$/.test(body.token||''))throw fail('Preview and confirm the COGS consolidation before posting.');
  const id='ACC-'+hash([context.user.id,body.requestKey]),payload=hash({selected,token:body.token,userId:context.user.id}),previous=await stores.AuditLog.get(id);
  if(previous){if(previous.audit_source!=='server_verified'||previous.action!=='consolidate_cogs_accounts'||previous.accounting_control_consolidation_policy!==policy||previous.accounting_control_consolidation_payload!==payload)throw fail('This consolidation reference already belongs to different account details.',409);return {...previous.accounting_control_consolidation_result,reused:true};}
  const tables=await state(stores),preview=plan(tables,selected);
  if(preview.token!==body.token)throw fail('The accounts, mappings or journals changed. Preview the consolidation again.',409);
  if(preview.unsupported_references.length)throw fail('Review the other account references before consolidating COGS.');
  let journal=null;
  if(preview.transfer_lines.length)({journal}=await postJournal({entities:stores},{entryDate:selected.date,description:'COGS account consolidation: '+preview.source_account.account_number+' to '+preview.target_account.account_number+' / '+selected.reference,sourceModule:'accounting_corrections',sourceDocumentType:'AccountConsolidation',sourceDocumentId:id,userId:context.user.id,lines:preview.transfer_lines}));
  for(const product of tables.Product.filter(product=>product.cogs_account_id===selected.sourceAccountId))await stores.Product.update(product.id,{cogs_account_id:selected.targetAccountId});
  for(const rule of tables.PostingRule.filter(rule=>rule.account_id===selected.sourceAccountId))await stores.PostingRule.update(rule.id,{account_id:selected.targetAccountId,account_number:preview.target_account.account_number,account_name:'Cost of Goods Sold'});
  const timestamp=new Date().toISOString();
  await stores.Account.update(selected.targetAccountId,{name:'Cost of Goods Sold'});
  await stores.Account.update(selected.sourceAccountId,{is_active:false,is_hidden:true,consolidated_into_account_id:selected.targetAccountId,account_consolidation_id:id,account_consolidated_at:timestamp,account_consolidated_by:context.user.id});
  const result={source_account_id:selected.sourceAccountId,target_account_id:selected.targetAccountId,journal_id:journal?.id||'',journal_number:journal?.journal_number||'',product_count:preview.products_count,rule_count:preview.rules_count,profit_change:0,reused:false};
  await stores.AuditLog.create({id,action:'consolidate_cogs_accounts',module:'accounting',entity_type:'Account',entity_id:selected.sourceAccountId,user_id:context.user.id,audit_source:'server_verified',description:'Consolidated '+preview.source_account.account_number+' into '+preview.target_account.account_number+' / '+selected.reference,accounting_control_consolidation_policy:policy,accounting_control_consolidation_payload:payload,accounting_control_consolidation_preview:preview,accounting_control_consolidation_accounts:tables.Account.filter(account=>[selected.sourceAccountId,selected.targetAccountId].includes(account.id)),accounting_control_consolidation_products:tables.Product.filter(product=>product.cogs_account_id===selected.sourceAccountId),accounting_control_consolidation_rules:tables.PostingRule.filter(rule=>rule.account_id===selected.sourceAccountId),accounting_control_consolidation_result:result});
  return result;
}
