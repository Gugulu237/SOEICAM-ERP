import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import catalog from '../src/server/generated/schema.json' with {type:'json'};
import {isAssemblyInventoryType} from '../src/lib/item-types.js';
import {postJournal} from '../src/server/domain/field-ops.js';
import {checkedJournalLines,journalCents,journalDate} from '../src/server/domain/journal-validation.js';
import {validateAccount} from '../src/lib/account-hierarchy.js';

export const CUTOVER_ID='driver-opening-cutover-2026-11-04';
export const NOT_AFTER='2026-11-03T23:10:16.468Z';
export const CLEARING_ACCOUNT_ID=CUTOVER_ID+'-clearing';
export const CLEARING_ACCOUNT_NUMBER='OPEN-ERP-20261104';
export const ENTITIES=['CompanySettings','Warehouse','Vehicle','Product','Dispatch','DispatchLine','DispatchRequest','StockBalance','StockMovement','FieldSale','SalesOrder','SpoilageRecord','Invoice','InvoiceLine','Customer','Supplier','Bill','Account','PostingRule','JournalEntry','JournalLine','AccountingPeriod','Payment','PaymentAllocation','CashCollection','CashHandover','TreasuryAccount','TreasuryTransaction','ProductionOrder','ProductionMaterial','AuditLog'];
const WRITES=new Set(['StockBalance','StockMovement','Dispatch','DispatchRequest','AuditLog','Account','CompanySettings']);
const OPEN_RUNS=new Set(['draft','pending_approval','approved','loaded','in_transit','returned']);
const OPEN_REQUESTS=new Set(['draft','pending_approval','approved']);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const identifier=s=>'"'+String(s).replaceAll('"','""')+'"';
const flatten=({extra_data,...row})=>({...extra_data,...row});
const decimal=(value,label,scale=2)=>{
  if(!['number','string'].includes(typeof value)||String(value).trim()==='')throw Error(label+' is missing or invalid.');
  const n=Number(value),factor=10**scale,rounded=Math.round(n*factor);
  if(!Number.isFinite(n)||Math.abs(n)>1e12||!Number.isSafeInteger(rounded)||Math.abs(n*factor-rounded)>0.0001)throw Error(label+' needs reconciliation.');
  return BigInt(rounded);
};
const money=n=>{if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw Error('Inventory value exceeds the safe review limit.');return Number(n)/100;};
const legacyPolicy=hash({version:1,id:CUTOVER_ID,notAfter:NOT_AFTER,scope:'registered vehicle stock only',financialWrites:false});
const legacyEquityPolicy=hash({version:2,id:CUTOVER_ID,notAfter:NOT_AFTER,scope:'registered vehicle stock only',financialWrites:'exact old-stock difference; operator-selected opening equity; shared journal engine'});
const policy=hash({version:3,id:CUTOVER_ID,notAfter:NOT_AFTER,scope:'registered vehicle stock only; current warehouse counts authoritative',financialWrites:'exact old-stock difference to dedicated pending opening clearing; no new sales or expenses'});
const normalize=(entity,row)=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v!=null&&['number','integer'].includes(catalog[entity].fields[k]?.type)?String(v):v]));
// SQL text ordering depends on the database collation. Use the same ordering
// for both snapshots and expected rows; arrays inside records remain ordered.
const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
const businessDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Douala',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export function planCutover(raw,options={}){
  const t=Object.fromEntries(ENTITIES.map(n=>[n,(raw[n]||[]).map(flatten)])),blockers=[];
  const marker=t.AuditLog.find(r=>r.id===CUTOVER_ID);
  if(marker){
    const validPolicy=marker.driver_cutover_policy===policy||marker.driver_cutover_policy===legacyEquityPolicy||marker.driver_cutover_policy===legacyPolicy&&marker.driver_cutover_receipt?.financial_entries_created===0;
    if(marker.action!=='driver_opening_cutover'||marker.audit_source!=='owner_maintenance'||!validPolicy||marker.driver_cutover_receipt?.cutover_id!==CUTOVER_ID||!Number.isFinite(Date.parse(marker.driver_cutover_receipt?.completed_at)))throw Error('An incompatible cutover marker exists; no reset is permitted.');
    return {completed:true,receipt:marker.driver_cutover_receipt,blockers:[]};
  }
  if(t.CompanySettings.length!==1||!/\bSOEICAM\b/i.test(t.CompanySettings[0].company_name||''))blockers.push('The database must identify exactly one SOEICAM company.');
  if(options.offsetAccountId)blockers.push('Arbitrary equity selection is disabled for this opening baseline. Run without --offset-account or -OpeningOffsetAccountId.');
  const warehouses=new Map(t.Warehouse.map(w=>[w.id,w])),products=new Map(t.Product.map(p=>[p.id,p]));
  const locationIds=new Set(t.Warehouse.filter(w=>w.warehouse_type==='vehicle').map(w=>w.id));
  const balances=t.StockBalance.filter(b=>locationIds.has(b.warehouse_id)&&(String(b.quantity)!=='0'||String(b.total_value)!=='0')).filter(b=>{
    try{return decimal(b.quantity,'Vehicle quantity',3)!==0n||decimal(b.total_value,'Vehicle value')!==0n;}catch(e){blockers.push(b.id+': '+e.message);return true;}
  });
  const dispatches=t.Dispatch.filter(d=>OPEN_RUNS.has(d.status));
  const requests=t.DispatchRequest.filter(d=>OPEN_REQUESTS.has(d.status));
  for(const row of t.Dispatch)if(!OPEN_RUNS.has(row.status)&&!['completed','cancelled'].includes(row.status))blockers.push('Delivery '+row.id+' has an unknown state; review it first.');
  for(const row of t.DispatchRequest)if(!OPEN_REQUESTS.has(row.status)&&!['processed','cancelled','rejected'].includes(row.status))blockers.push('Stock request '+row.id+' has an unknown state; review it first.');
  const dated=(row,label)=>{
    for(const stamp of [row.created_date,row.updated_date].filter(Boolean)){
      if(!Number.isFinite(Date.parse(stamp))||Date.parse(stamp)>Date.parse(NOT_AFTER))blockers.push(label+' changed after this cutover was prepared; inspect it before resetting.');
    }
    if(!row.created_date&&!row.updated_date)blockers.push(label+' has no trustworthy creation/update date.');
  };
  const relevantLocations=new Set([...balances.map(b=>b.warehouse_id),...dispatches.map(d=>d.vehicle_warehouse_id).filter(Boolean)]);
  for(const id of relevantLocations){
    const w=warehouses.get(id);
    const vehicles=t.Vehicle.filter(v=>v.warehouse_id===id||w?.vehicle_id===v.id);
    if(w?.warehouse_type!=='vehicle'||vehicles.length!==1||vehicles[0].warehouse_id&&vehicles[0].warehouse_id!==id||w.vehicle_id&&w.vehicle_id!==vehicles[0].id)blockers.push('Vehicle location '+id+' has ambiguous or inconsistent ownership.');
  }
  for(const row of [...dispatches,...requests]){
    dated(row,'Delivery '+(row.dispatch_number||row.request_number||row.id));
    if(!t.Vehicle.some(v=>v.id===row.vehicle_id))blockers.push('Delivery '+row.id+' has no registered vehicle.');
    if(row.status==='loaded'||row.status==='in_transit'){
      if(!row.vehicle_warehouse_id||!locationIds.has(row.vehicle_warehouse_id))blockers.push('Loaded delivery '+row.id+' has no verified vehicle stock location.');
    }
  }
  for(const row of balances){
    dated(row,'Vehicle stock '+row.id);
    try{
      if(decimal(row.quantity,'Vehicle quantity',3)<0n||decimal(row.total_value,'Vehicle value')<0n)blockers.push('Negative vehicle stock/value '+row.id+' needs reconciliation.');
      if(!products.has(row.product_id))blockers.push('Vehicle stock '+row.id+' has no product.');
    }catch(e){blockers.push(row.id+': '+e.message);}
  }
  const runs=new Set(dispatches.map(d=>d.id));
  const vehicles=new Set(t.Vehicle.map(v=>v.id));
  const linked=row=>runs.has(row.dispatch_id)||vehicles.has(row.vehicle_id)||locationIds.has(row.warehouse_id)||locationIds.has(row.custodian_warehouse_id)||locationIds.has(row.stock_warehouse_id);
  for(const row of t.FieldSale.filter(linked))if(!['posted','settled','cancelled','rejected'].includes(row.status))blockers.push('Unresolved field sale '+(row.sale_number||row.id)+' must be reconciled first.');
  for(const row of t.SalesOrder.filter(linked))if(!['delivered','completed','invoiced','cancelled','rejected'].includes(row.status))blockers.push('Unresolved sales order '+(row.order_number||row.id)+' must be reconciled first.');
  for(const row of t.SpoilageRecord.filter(linked))if(!['replaced','closed','completed','cancelled','rejected'].includes(row.status))blockers.push('Unresolved return/replacement '+(row.record_number||row.id)+' must be reconciled first.');
  // Current physical warehouse counts already include returned unsold goods.
  // Remove stale vehicle allocations as a migration adjustment, never a sale,
  // expense, new return or another manufacturing entry.
  const accountRows=new Map(t.Account.map(a=>[a.id,a])),accountIds=new Set(),beforeValue=new Map(),afterValue=new Map(),ledger=new Map();
  const selected=new Set(balances.map(b=>b.id));
  const accountFor=p=>{
    const key=isAssemblyInventoryType(p?.inventory_type)?'finished_goods_inventory':'raw_material_inventory';
    const rules=t.PostingRule.filter(r=>r.is_active!==false&&r.rule_key===key);
    if(!p?.inventory_account_id&&rules.length!==1)throw Error('Product '+(p?.name||p?.id||'unknown')+' needs one inventory posting rule.');
    const account=accountRows.get(p?.inventory_account_id||rules[0].account_id);
    if(!account||account.account_type!=='asset'||account.normal_balance!=='debit'||account.is_active===false||account.is_posting===false||account.is_treasury||account.currency&&account.currency!=='XAF')throw Error('Product '+p.name+' needs a valid inventory control account.');
    return account.id;
  };
  for(const row of t.StockBalance){
    try{
      const value=decimal(row.total_value,'Stock value '+row.id);
      if(value===0n&&decimal(row.quantity,'Stock quantity '+row.id,3)===0n)continue;
      const p=products.get(row.product_id);if(!p)throw Error('Stock '+row.id+' references a missing product.');
      const account=accountFor(p);accountIds.add(account);
      beforeValue.set(account,(beforeValue.get(account)||0n)+value);
      if(!selected.has(row.id))afterValue.set(account,(afterValue.get(account)||0n)+value);
    }catch(e){blockers.push(e.message);}
  }
  const posted=new Set(t.JournalEntry.filter(j=>['posted','reversed'].includes(j.status)).map(j=>j.id));
  for(const row of t.JournalLine.filter(l=>posted.has(l.journal_id))){
    try{ledger.set(row.account_id,(ledger.get(row.account_id)||0n)+BigInt(journalCents(row.debit??0))-BigInt(journalCents(row.credit??0)));}catch(e){blockers.push(e.message);}
  }
  const accounting=[...accountIds].map(id=>({account_id:id,account:accountRows.get(id).name,before_stock:money(beforeValue.get(id)||0n),remaining_stock:money(afterValue.get(id)||0n),posted_ledger:money(ledger.get(id)||0n),difference:money((afterValue.get(id)||0n)-(ledger.get(id)||0n))}));
  for(const id of accountIds){try{if(decimal(accountRows.get(id).balance,'Inventory account balance')!==(ledger.get(id)||0n))blockers.push('Inventory account '+accountRows.get(id).name+' has a balance that differs from its posted ledger.');}catch(e){blockers.push(e.message);}}
  const credits=[];
  for(const row of accounting){
    if(row.difference===0)continue;
    const id=row.account_id,before=beforeValue.get(id)||0n,remaining=afterValue.get(id)||0n;
    if((ledger.get(id)||0n)!==before||before<=remaining){
      blockers.push('Inventory account '+row.account+' needs separate reconciliation: its difference is not exactly the selected old driver stock.');continue;
    }
    credits.push({account_id:id,account:row.account,debit:0,credit:money(before-remaining)});
  }
  const total=money(credits.reduce((sum,l)=>sum+decimal(l.credit,'Inventory correction'),0n));
  const treasuryIds=new Set(t.TreasuryAccount.map(a=>a.gl_account_id));
  const clearingDefinition={id:CLEARING_ACCOUNT_ID,account_number:CLEARING_ACCOUNT_NUMBER,name:'Opening Balance Clearing - pending reconciliation',account_type:'equity',normal_balance:'credit',financial_statement:'balance_sheet',cash_flow_category:'none',parent_id:'',is_active:true,is_posting:true,is_control_account:false,allow_manual_journal:true,is_treasury:false,is_system:false,currency:'XAF',balance:0,description:'Temporary ERP migration clearing only. Reconcile against the complete approved opening trial balance; this is not final share capital, retained earnings, revenue or operating expense.',extra_data:{opening_cutover_id:CUTOVER_ID,opening_reconciliation_status:'pending'}};
  const existingClearing=accountRows.get(CLEARING_ACCOUNT_ID),offset=existingClearing||flatten(clearingDefinition);
  const validOffset=a=>a?.id===CLEARING_ACCOUNT_ID&&a.account_number===CLEARING_ACCOUNT_NUMBER&&a.name===clearingDefinition.name&&a.opening_cutover_id===CUTOVER_ID&&a.opening_reconciliation_status==='pending'&&a.account_type==='equity'&&a.normal_balance==='credit'&&a.financial_statement==='balance_sheet'&&a.is_active===true&&a.is_posting===true&&a.allow_manual_journal===true&&!a.is_control_account&&!a.is_treasury&&!treasuryIds.has(a.id)&&a.currency==='XAF';
  const date=businessDate();
  const correction={required:total>0,basis:'erp_opening_baseline',entry_date:date,total,offset_account_id:total?offset.id:'',offset_account:total?offset.name:'',clearing_account_number:total?CLEARING_ACCOUNT_NUMBER:'',create_clearing_account:total>0&&!existingClearing,reconciliation_status:total?'pending_full_opening_balance_reconciliation':'inventory_already_reconciled',lines:total?[{account_id:offset.id,account:offset.name,debit:total,credit:0},...credits]:[]};
  if(total>0){
    if(!validOffset(offset))blockers.push('The reserved opening-clearing account has incompatible settings; no other account will be substituted.');
    blockers.push(...validateAccount(offset,t.Account,{}));
    if(t.Account.some(a=>a.id!==offset.id&&String(a.name||'').trim().toLowerCase()===clearingDefinition.name.toLowerCase()))blockers.push('Another account uses the opening-clearing name. Reconcile the duplicate before continuing.');
    // An unfinished transaction cannot leave a used clearing account behind.
    // Existing zero, unused definitions are safe; otherwise require reconciliation.
    if(t.JournalLine.some(l=>l.account_id===offset.id))blockers.push('The cutover clearing account already has journal activity without a completion marker.');
    try{if(decimal(offset.balance,'Opening clearing balance')!==0n)blockers.push('The opening clearing account must be unused and zero before this one-time baseline.');}catch(e){blockers.push(e.message);}
    try{checkedJournalLines(correction.lines);}catch(e){blockers.push(e.message);}
    for(const period of t.AccountingPeriod){
      try{journalDate(period.start_date);journalDate(period.end_date);if(period.start_date>period.end_date)throw Error('Invalid accounting period dates.');}catch(e){blockers.push(e.message);}
      if(period.start_date<=date&&date<=period.end_date&&!['open','review'].includes(period.status))blockers.push('Accounting period '+period.name+' is not open for this correction.');
    }
    const seq=Number(t.CompanySettings[0]?.next_journal_number??1);
    if(!Number.isSafeInteger(seq)||seq<1)blockers.push('Reconcile the journal number sequence before posting.');
  }
  if(t.JournalEntry.some(j=>j.source_document_id===CUTOVER_ID))blockers.push('A cutover journal exists without its completion marker; review it before any retry.');
  const baseline={basis:'Current physical warehouse counts are authoritative and include returned unsold goods.',driver_opening_quantity:0,warehouse_quantities_added:0,customer_debts_reposted:false,supplier_debts_reposted:false,new_sales_or_expenses:false,full_opening_accounts_status:'pending_reconciliation'};
  const summary={cutover_id:CUTOVER_ID,not_after:NOT_AFTER,baseline,vehicle_lots:balances.length,closed_runs:dispatches.length,cancelled_requests:requests.length,removed_value:money(balances.reduce((sum,b)=>{try{return sum+decimal(b.total_value,'Vehicle value');}catch{return sum;}},0n)),vehicles:[...new Set(balances.map(b=>b.warehouse_id))].map(id=>({warehouse_id:id,name:warehouses.get(id)?.name,items:balances.filter(b=>b.warehouse_id===id).map(b=>({product:b.product_name,quantity:b.quantity,value:b.total_value,lot:b.lot_number}))})),accounting,correction,preserved:['Warehouse counts including returned unsold goods','Customer opening balances and invoices','Supplier opening balances and bills','Sales history','Payments and cash liabilities','Historical accounting journals','Production and product definitions']};
  return {completed:false,balances,dispatches,requests,summary,clearingAccount:correction.create_clearing_account?clearingDefinition:null,needsOffsetSelection:false,offsetCandidates:[],reviewHash:hash({policy,summary}),blockers:[...new Set(blockers)]};
}

export function openingAccountReview(raw,plan){
  const accounts=new Map((raw.Account||[]).map(flatten).map(a=>[a.id,a]));
  const journals=(raw.JournalEntry||[]).map(flatten).filter(j=>['posted','reversed'].includes(j.status));
  const byJournal=new Map();
  for(const l of (raw.JournalLine||[]).map(flatten)){if(!byJournal.has(l.journal_id))byJournal.set(l.journal_id,[]);byJournal.get(l.journal_id).push(l);}
  const accounting=(plan.summary||plan.receipt)?.accounting||[],affected=new Set(accounting.filter(a=>a.difference!==0).map(a=>a.account_id));
  const openings=new Set(journals.filter(j=>j.source_module==='opening_balances').map(j=>j.id));
  const equity=[...accounts.values()].filter(a=>a.account_type==='equity').map(a=>{
    const lines=[...openings].flatMap(id=>byJournal.get(id)||[]).filter(l=>l.account_id===a.id);
    return {account_id:a.id,number:a.account_number||'',name:a.name,opening_journal_count:new Set(lines.map(l=>l.journal_id)).size,opening_net_credit:money(lines.reduce((n,l)=>n+BigInt(journalCents(l.credit))-BigInt(journalCents(l.debit)),0n))};
  }).sort((a,b)=>(a.number+' '+a.name).localeCompare(b.number+' '+b.name));
  const relevant=journals.filter(j=>(byJournal.get(j.id)||[]).some(l=>affected.has(l.account_id)));
  // Include initial opening evidence before later activity. Never infer an account
  // from its label, a matching balance or the mere fact that it was used before.
  relevant.sort((a,b)=>Number(openings.has(b.id))-Number(openings.has(a.id))||String(a.entry_date||'').localeCompare(String(b.entry_date||''))||a.id.localeCompare(b.id));
  const details=relevant.slice(0,20).map(j=>{
    const lines=byJournal.get(j.id)||[];
    return {journal_id:j.id,number:j.journal_number||'',date:j.entry_date||'',status:j.status,source_module:j.source_module||'',source_document_type:j.source_document_type||'',reversal_of:j.reversal_of||'',reversed_by_journal:j.reversed_by_journal||'',total_debit:j.total_debit,total_credit:j.total_credit,omitted_lines:Math.max(0,lines.length-30),lines:lines.slice(0,30).map(l=>({account_id:l.account_id,number:accounts.get(l.account_id)?.account_number||'',account:accounts.get(l.account_id)?.name||'Unknown account',account_type:accounts.get(l.account_id)?.account_type||'',debit:l.debit,credit:l.credit}))};
  });
  return {mode:'Read-only accounting evidence; no records changed',guidance:'Current warehouse counts and existing debts are the opening baseline. Stale vehicle value is reconciled through a dedicated temporary opening clearing account, not current sales or expenses. Reconcile the full opening trial balance before clearing this temporary balance.',opening_baseline:(plan.summary||plan.receipt)?.baseline,proposed_correction:(plan.summary||plan.receipt)?.correction,inventory_accounts:accounting.filter(a=>affected.has(a.account_id)),equity_opening_usage:equity,inventory_journal_count:relevant.length,omitted_journals:Math.max(0,relevant.length-details.length),inventory_journals:details};
}

async function snapshot(tx,{targetKey='' }={}){
  const tables={};
  for(const name of ENTITIES){
    const rows=await tx.unsafe('SELECT * FROM public.'+identifier(catalog[name].table)+' ORDER BY id LIMIT 20001');
    if(rows.length>20000)throw Error('The cutover requires a narrower reviewed dataset: '+name);
    tables[name]=rows.map(r=>normalize(name,r)).sort(byId);
  }
  const [identity]=await tx.unsafe('SELECT current_database() AS database_name, current_user AS database_user');
  const target=hash({targetKey,identity,settings:tables.CompanySettings.map(r=>({id:r.id,name:r.company_name}))});
  return {tables,target,snapshot:hash(tables)};
}
// Diagnose a failed check without exposing IDs, amounts, customer information
// or free-text metadata. Differences still abort the entire transaction.
function verificationDifferences(expected,actual){
  const differences=[];
  for(const name of ENTITIES){
    const wanted=new Map(expected[name].map(row=>[row.id,row]));
    const received=new Map(actual[name].map(row=>[row.id,row]));
    let added=0,missing=0,changed=0;const fields=new Set();
    for(const [id,row]of wanted){
      if(!received.has(id)){missing++;continue;}
      const saved=received.get(id);
      if(hash(row)===hash(saved))continue;
      changed++;
      for(const key of new Set([...Object.keys(row),...Object.keys(saved)])){
        if(!Object.hasOwn(row,key)||!Object.hasOwn(saved,key)||hash(row[key])!==hash(saved[key]))fields.add(key==='extra_data'||catalog[name].fields[key]?key:'[unmapped column]');
      }
    }
    for(const id of received.keys())if(!wanted.has(id))added++;
    if(added||missing||changed)differences.push(name+': '+added+' added, '+missing+' missing, '+changed+' changed'+(fields.size?' (fields: '+[...fields].sort().slice(0,6).join(', ')+(fields.size>6?', ...':'')+')':''));
  }
  return differences.slice(0,5).join('; ')+(differences.length>5?'; '+(differences.length-5)+' more tables':'');
}
export async function inspectCutover(sql,options={}){
  return sql.begin(async tx=>{
    await tx.unsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await tx.unsafe("SET LOCAL statement_timeout='30000'");
    const s=await snapshot(tx,options),plan=planCutover(s.tables,options);
    if(plan.completed&&plan.receipt.target!==s.target)throw Error('The cutover receipt belongs to a different database target.');
    if(options.reviewOpeningAccounts)return {mode:'read-only opening-account review',completed:plan.completed,opening_account_review:openingAccountReview(s.tables,plan),blockers:plan.blockers};
    return {mode:'preview; no changes',target:s.target,snapshot:s.snapshot,policy,eligible:!plan.blockers.length&&!plan.needsOffsetSelection,completed:plan.completed,...(plan.completed?{receipt:plan.receipt}:{summary:plan.summary,blockers:plan.blockers,reviewHash:plan.reviewHash,needs_offset_selection:plan.needsOffsetSelection,offset_candidates:plan.offsetCandidates})};
  });
}
async function backup(directory,data){
  if(!directory||!path.isAbsolute(directory))throw Error('Choose an absolute backup directory outside a Git repository.');
  const parent=await realpath(path.dirname(directory));
  if(parent.toLowerCase()!==path.resolve(path.dirname(directory)).toLowerCase())throw Error('Backup parent must not be a symbolic link.');
  for(let check=parent;;check=path.dirname(check)){
    try{await stat(path.join(check,'.git'));throw Error('Backup must be outside Git.');}catch(e){if(e.code!=='ENOENT')throw e;}
    if(path.dirname(check)===check)break;
  }
  await mkdir(directory,{recursive:false,mode:0o700});
  const file=path.join(directory,'driver-stock-before.json'),text=JSON.stringify(data,null,2)+'\n';
  await writeFile(file,text,{flag:'wx',mode:0o600,flush:true});
  if(await readFile(file,'utf8')!==text)throw Error('Backup readback failed; no stock was changed.');
}
async function patch(tx,name,before,fields,extra){
  if(!WRITES.has(name))throw Error('Protected table');
  const values=Object.values(fields),keys=Object.keys(fields);
  const rows=await tx.unsafe('UPDATE public.'+identifier(catalog[name].table)+' SET '+keys.map((k,i)=>identifier(k)+'=$'+(i+1)).join(',')+',extra_data=$'+(values.length+1)+'::text::jsonb WHERE id=$'+(values.length+2)+' RETURNING *',[...values,JSON.stringify({...before.extra_data,...extra}),before.id]);
  if(rows.length!==1)throw Error('Expected exactly one changed record.');
  const expected=normalize(name,{...before,...fields,extra_data:{...before.extra_data,...extra}});
  const result=normalize(name,rows[0]);
  if(hash(result)!==hash(expected))throw Error('Unexpected changes to '+name+'; rolling back.');
  return result;
}
async function insert(tx,name,data){
  if(!['AuditLog','StockMovement','JournalEntry','JournalLine','Account'].includes(name))throw Error('Unexpected insert table');
  const base={},extra={};
  for(const [key,value]of Object.entries(data)){if(key==='extra_data')Object.assign(extra,value);else if(catalog[name].fields[key])base[key]=value;else extra[key]=value;}
  base.extra_data=JSON.stringify(extra);
  const keys=Object.keys(base),values=Object.values(base);
  const [result]=await tx.unsafe('INSERT INTO public.'+identifier(catalog[name].table)+' ('+keys.map(identifier).join(',')+') VALUES ('+keys.map((k,i)=>'$'+(i+1)+(k==='extra_data'?'::text::jsonb':'')).join(',')+') RETURNING *',values);
  const flat=flatten(result);
  for(const [key,value]of Object.entries(data)){
    if(key==='extra_data')for(const [field,expected] of Object.entries(value))if(hash(flat[field])!==hash(expected))throw Error('Inserted cutover metadata differs from the reviewed value.');
    const numeric=['number','integer'].includes(catalog[name].fields[key]?.type);
    if(key!=='extra_data'&&hash(numeric?String(flat[key]):flat[key])!==hash(numeric?String(value):value))throw Error('Inserted cutover evidence differs from the requested value.');
  }
  return normalize(name,result);
}
// Run the application's normal journal engine inside the same locked transaction.
// This small adapter allows only the reviewed accounts, sequence and new evidence.
function journalClient(tx,expected,plan,actor,now){
  const allowed=new Set(plan.summary.correction.lines.map(l=>l.account_id)),counters={};
  const entities={};
  for(const name of ['Account','CompanySettings','JournalEntry','JournalLine','AccountingPeriod','AuditLog']){
    const all=()=>expected[name].map(flatten);
    const create=async data=>{
      if(!['JournalEntry','JournalLine','AuditLog'].includes(name))throw Error('Unexpected journal insert.');
      const ordinal=counters[name]=(counters[name]||0)+1;
      const id=CUTOVER_ID+'-'+name.toLowerCase()+'-'+ordinal;
      const evidence={...data,id,created_date:now,updated_date:now,created_by:actor,maintenance_actor:actor,execution_channel:'owner_maintenance'};
      // This CLI is owner maintenance, not an authenticated employee session.
      if(name==='AuditLog')Object.assign(evidence,{audit_source:'owner_maintenance',user_id:'',user_name:actor});
      const row=await insert(tx,name,evidence);expected[name].push(row);return flatten(row);
    };
    entities[name]={
      list:async()=>all(),
      filter:async(query={},_sort,limit=20000)=>all().filter(row=>Object.entries(query).every(([key,value])=>value&&typeof value==='object'?Array.isArray(value.$in)&&value.$in.includes(row[key]):row[key]===value)).slice(0,limit),
      create,
      bulkCreate:async rows=>{const result=[];for(const row of rows)result.push(await create(row));return result;},
      update:async(id,fields)=>{
        const key=name==='Account'?'balance':name==='CompanySettings'?'next_journal_number':null;
        if(!key||Object.keys(fields).length!==1||!(key in fields)||name==='Account'&&!allowed.has(id))throw Error('Unexpected journal update.');
        const index=expected[name].findIndex(r=>r.id===id);if(index<0)throw Error('Missing journal update target.');
        const row=await patch(tx,name,expected[name][index],{...fields,updated_date:now},{});expected[name][index]=row;return flatten(row);
      }
    };
  }
  return {entities};
}
export async function applyCutover(sql,options){
  if(options.reviewOpeningAccounts)throw Error('Opening-account review is read-only and cannot apply a cutover.');
  if(!options.expectedTarget||!options.expectedSnapshot)throw Error('A reviewed target and snapshot are required.');
  if(typeof options.actor!=='string'||!options.actor.trim()||options.actor.length>150)throw Error('Identify the owner running this maintenance operation.');
  return sql.begin(async tx=>{
    await tx.unsafe('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await tx.unsafe("SET LOCAL lock_timeout='3s'");
    await tx.unsafe("SET LOCAL statement_timeout='120s'");
    await tx.unsafe('SELECT pg_advisory_xact_lock(867153024)');
    await tx.unsafe('LOCK TABLE '+ENTITIES.map(n=>'public.'+identifier(catalog[n].table)).sort().join(',')+' IN EXCLUSIVE MODE');
    const before=await snapshot(tx,options),plan=planCutover(before.tables,options);
    if(before.target!==options.expectedTarget)throw Error('The database target changed; no reset was applied.');
    if(plan.completed){if(plan.receipt.target!==before.target)throw Error('The cutover receipt belongs to a different database target.');return {mode:'already completed; no changes',...plan.receipt,reused:true};}
    if(before.snapshot!==options.expectedSnapshot)throw Error('Stock, deliveries or financial records changed since review; inspect again.');
    if(plan.blockers.length)throw Error('Cutover blocked:\n'+plan.blockers.join('\n'));
    if(options.expectedReview!==plan.reviewHash)throw Error('The accounting selection or posting date changed since review; inspect again.');
    if(!plan.balances.length&&!plan.dispatches.length&&!plan.requests.length)return {mode:'nothing to reset; no changes'};
    const selected=Object.fromEntries(['StockBalance','Dispatch','DispatchRequest'].map((n,i)=>[n,before.tables[n].filter(r=>[plan.balances,plan.dispatches,plan.requests][i].some(p=>p.id===r.id))]));
    if(plan.summary.correction.required){
      selected.Account=before.tables.Account.filter(a=>plan.summary.correction.lines.some(l=>l.account_id===a.id));
      selected.CompanySettings=before.tables.CompanySettings;
    }
    await backup(options.backupDir,{format:'soeicam-driver-cutover-v3',policy,target:before.target,snapshot:before.snapshot,actor:options.actor,summary:plan.summary,planned_new_clearing_account:plan.clearingAccount,tables:selected});
    const expected=structuredClone(before.tables),now=new Date().toISOString(),date=plan.summary.correction.entry_date;
    const mark={driver_cutover_id:CUTOVER_ID,driver_cutover_at:now,driver_cutover_actor:options.actor};
    const replace=(name,row)=>{const index=expected[name].findIndex(r=>r.id===row.id);expected[name][index]=row;};
    let journal=null;
    if(plan.summary.correction.required){
      if(plan.clearingAccount)expected.Account.push(await insert(tx,'Account',{...plan.clearingAccount,created_date:now,updated_date:now,created_by:options.actor}));
      ({journal}=await postJournal(journalClient(tx,expected,plan,options.actor,now),{
        entryDate:plan.summary.correction.entry_date,description:'ERP opening baseline: clear stale vehicle allocations; current warehouse counts include returned goods. Temporary opening clearing pending full reconciliation.',
        sourceModule:'inventory_adjustment',sourceDocumentType:'DriverStockCutover',sourceDocumentId:CUTOVER_ID,
        lines:plan.summary.correction.lines,userId:''
      }));
      mark.driver_cutover_journal_id=journal.id;
    }
    for(const row of selected.StockBalance){
      replace('StockBalance',await patch(tx,'StockBalance',row,{quantity:0,total_value:0,updated_date:now},{...mark,driver_cutover_previous_quantity:row.quantity,driver_cutover_previous_value:row.total_value}));
      const b=flatten(row),movement=await insert(tx,'StockMovement',{id:CUTOVER_ID+'-'+hash(row.id).slice(0,20),created_date:now,updated_date:now,created_by:options.actor,product_id:b.product_id,product_name:b.product_name||'',quantity:b.quantity,movement_type:'stock_adjustment',source_warehouse_id:b.warehouse_id,destination_warehouse_id:'',lot_number:b.lot_number||'',expiry_date:b.expiry_date||null,unit_cost:b.unit_cost??0,total_value:b.total_value,document_type:'DriverStockCutover',document_id:CUTOVER_ID,reason:'Opening baseline: clear stale vehicle allocation; returned unsold stock is already in the physical warehouse count.',status:'approved',movement_date:date,stock_balance_id:b.id,quantity_difference:-Number(b.quantity),value_difference:-Number(b.total_value),batch_number:b.batch_number||'',production_order_id:b.production_order_id||'',qc_status:b.qc_status||'',accounting_source:'erp_opening_baseline',...mark});
      expected.StockMovement.push(movement);
    }
    for(const row of selected.Dispatch){
      const status=['loaded','in_transit','returned'].includes(row.status)?'completed':'cancelled';
      replace('Dispatch',await patch(tx,'Dispatch',row,{status,closed_at:now,updated_date:now},{...mark,driver_cutover_previous_status:row.status,driver_cutover_no_physical_return:true}));
    }
    for(const row of selected.DispatchRequest)replace('DispatchRequest',await patch(tx,'DispatchRequest',row,{status:'cancelled',updated_date:now},{...mark,driver_cutover_previous_status:row.status}));
    const receipt={...plan.summary,completed_at:now,date,actor:options.actor,target:before.target,before_snapshot:before.snapshot,backup_directory:options.backupDir,financial_entries_created:journal?1:0,journal_id:journal?.id||'',journal_number:journal?.journal_number||'',review_hash:plan.reviewHash};
    expected.AuditLog.push(await insert(tx,'AuditLog',{id:CUTOVER_ID,created_date:now,updated_date:now,created_by:options.actor,user_name:options.actor,action:'driver_opening_cutover',module:'inventory_adjustment',entity_type:'CompanySettings',entity_id:before.tables.CompanySettings[0].id,description:'Owner-authorized opening baseline: stale driver allocations cleared; counted warehouse stock, customer and supplier debts and historical journals retained. '+(journal?'Temporary opening-clearing entry '+journal.journal_number+' awaits full opening reconciliation.':'Inventory ledger already matched the retained count.'),reason:'Returned unsold goods are included in the main warehouse count. Previous sales are represented by opening customer debts; no operations are recreated.',audit_source:'owner_maintenance',driver_cutover_policy:policy,driver_cutover_receipt:receipt}));
    for(const rows of Object.values(expected))rows.sort(byId);
    const after=await snapshot(tx,options);
    if(hash(expected)!==after.snapshot)throw Error('Post-cutover verification failed; all changes were rolled back. '+(verificationDifferences(expected,after.tables)||'Snapshot structure differs.'));
    const finalAccounts=new Map(after.tables.Account.map(a=>[a.id,flatten(a)])),posted=new Set(after.tables.JournalEntry.filter(j=>['posted','reversed'].includes(j.status)).map(j=>j.id));
    for(const row of plan.summary.accounting){
      const actual=after.tables.JournalLine.filter(l=>l.account_id===row.account_id&&posted.has(l.journal_id)).reduce((sum,l)=>sum+BigInt(journalCents(l.debit))-BigInt(journalCents(l.credit)),0n);
      if(actual!==decimal(row.remaining_stock,'Retained inventory')||actual!==decimal(finalAccounts.get(row.account_id).balance,'Final account balance'))throw Error('Final inventory ledger reconciliation failed; all changes were rolled back.');
    }
    if(journal){
      const actual=after.tables.JournalLine.filter(l=>l.account_id===CLEARING_ACCOUNT_ID&&posted.has(l.journal_id)).reduce((sum,l)=>sum+BigInt(journalCents(l.debit))-BigInt(journalCents(l.credit)),0n);
      if(actual!==decimal(plan.summary.correction.total,'Opening correction')||-actual!==decimal(finalAccounts.get(CLEARING_ACCOUNT_ID).balance,'Clearing account balance'))throw Error('Final opening-clearing reconciliation failed; all changes were rolled back.');
    }
    return {mode:'cutover committed',...receipt,inventory_reconciled:true,after_snapshot:after.snapshot,reused:false};
  });
}
