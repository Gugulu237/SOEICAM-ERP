import {createHash} from 'node:crypto';
import {requireActiveContext,forbidden} from '../access.js';
import {assertModule} from './role-catalogue.js';
import {readRecords} from './commercial-workspace.js';
import {openingBalancesWorkspace,postOpeningBalances} from './opening-balances.js';
import {stockUnit} from '../../lib/item-units.js';
import {companySalesWarehouse} from '../../lib/sales-stock.js';
import {MANAGED_WAREHOUSE_TYPES} from '../../lib/warehouse-workspace.js';
import {assetDate,assetMonths,shiftMonth} from '../../lib/asset-schedule.js';
import {openingPartyLines} from '../../lib/opening-records.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const money=(value,label='amount')=>{
 if(!['number','string'].includes(typeof value)||String(value).trim()==='')throw fail('Enter a valid '+label+'.');
 const n=Number(value),c=Math.round(n*100);
 if(!Number.isFinite(n)||n<0||n>1e12||Math.abs(n*100-c)>0.0001||!Number.isSafeInteger(c))throw fail('Use non-negative amounts with at most two decimal places.');
 return c;
};
const text=(value,label,max=160)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw fail('Enter '+label+'.');return value.trim();};
const positive=(value,label)=>{const n=money(value,label);if(!n)throw fail('Enter a positive '+label+'.');return n;};
const reference=value=>text(value,'the original document or asset reference',100);
const norm=value=>String(value||'').trim().toLocaleUpperCase();
function access(context){const role=requireActiveContext(context);if(role!=='admin')throw forbidden('Only administrators can enter opening balances.');assertModule({...context,role},'accounting');}
const active=row=>row&&row.is_active!==false&&row.is_posting!==false&&(!row.currency||row.currency==='XAF');
const nextMonth=date=>shiftMonth(date.slice(0,7),1);
const factory=w=>w&&w.is_active!==false&&!MANAGED_WAREHOUSE_TYPES.includes(w.warehouse_type);

export async function openingPositionWorkspace(stores,context){
 access(context);
 const base=await openingBalancesWorkspace(stores,context);
 const [products,warehouses,customers,suppliers,treasury,rules,journals]=await Promise.all([
  readRecords(stores.Product),readRecords(stores.Warehouse),readRecords(stores.Customer),readRecords(stores.Supplier),readRecords(stores.TreasuryAccount),readRecords(stores.PostingRule,{is_active:true}),readRecords(stores.JournalEntry,{source_module:'opening_balances',status:'posted'}),
 ]);
 const lines=[];
 for(let i=0;i<journals.length;i+=100)lines.push(...await readRecords(stores.JournalLine,{journal_id:{$in:journals.slice(i,i+100).map(j=>j.id)}}));
 const recorded=new Set(journals.flatMap(j=>j.opening_detail_account_ids||[]));
 const defaults=Object.fromEntries(['customer_receivable','supplier_payable','raw_material_inventory','finished_goods_inventory'].map(key=>[key,rules.find(r=>r.rule_key===key)?.account_id||'']));
 return {...base,accounts:base.accounts.map(a=>({...a,opening_details_recorded:recorded.has(a.id),opening_debit:lines.filter(l=>l.account_id===a.id).reduce((n,l)=>n+Number(l.debit||0),0),opening_credit:lines.filter(l=>l.account_id===a.id).reduce((n,l)=>n+Number(l.credit||0),0)})),defaults,
  products:products.filter(p=>p.is_active!==false&&!p.item_removed_at&&p.configuration_status!=='draft'&&p.inventory_type!=='service').map(p=>({id:p.id,name:p.name,unit:stockUnit(p),inventory_type:p.inventory_type,expiry_tracking:p.expiry_tracking,account_id:p.inventory_account_id||defaults[['assembly','finished_product'].includes(p.inventory_type)?'finished_goods_inventory':'raw_material_inventory']})),
  warehouses:warehouses.filter(factory).map(w=>({id:w.id,name:w.name,warehouse_type:w.warehouse_type})),
  customers:customers.filter(c=>!c.customer_removed_at).map(c=>({id:c.id,name:c.business_name||c.name})),
  suppliers:suppliers.filter(s=>!s.supplier_removed_at).map(s=>({id:s.id,name:s.name})),
  treasury:treasury.filter(t=>active(t)).map(t=>({id:t.id,name:t.name,account_id:t.gl_account_id,account_type:t.account_type})),
 };
}

async function prepare(stores,context,body){
 const setup=await openingPositionWorkspace(stores,context),date=assetDate(body.date);
 if(!Array.isArray(body.details)||!body.details.length||body.details.length>200)throw fail('Enter between 1 and 200 starting-position records.');
 const accountMap=new Map(setup.accounts.map(a=>[a.id,a])),by=(name,id)=>setup[name].find(r=>r.id===id);
 const account=(id,types,normal)=>{const a=accountMap.get(id);if(!active(a)||!types.includes(a.account_type)||a.normal_balance!==normal)throw fail('Choose an active '+normal+' '+types.join('/')+' account for the opening detail.');return a.id;};
 const totals=new Map(),parties=new Map(),seen=new Set(),details=[];
 const add=(id,debit=0,credit=0)=>{const row=totals.get(id)||{account_id:id,debit:0,credit:0};row.debit+=debit;row.credit+=credit;if(!Number.isSafeInteger(row.debit)||!Number.isSafeInteger(row.credit))throw fail('Opening balances exceed the supported precision.');totals.set(id,row);};
 const [existingInvoices,existingBills,existingAssets,balances,movements]=await Promise.all([readRecords(stores.Invoice),readRecords(stores.Bill),readRecords(stores.FixedAsset),readRecords(stores.StockBalance),readRecords(stores.StockMovement)]);
 for(const row of body.details){
  if(!row||typeof row!=='object'||!['cash','stock','asset','receivable','payable'].includes(row.kind))throw fail('Choose a valid opening detail type.');
  const detail={kind:row.kind},keys=[];
  if(row.kind==='cash'){
   const t=by('treasury',row.treasury_id);if(!t)throw fail('Choose an active cash or bank account.');
   if(setup.treasury.filter(v=>v.account_id===t.account_id).length!==1)throw fail('Link each treasury account to its own GL account before entering opening balances.');
   detail.treasury_id=t.id;detail.account_id=account(t.account_id,['asset'],'debit');detail.amount=positive(row.amount,'cash or bank balance')/100;
   keys.push('cash:'+t.id);add(detail.account_id,money(detail.amount));
  }else if(row.kind==='stock'){
   const p=by('products',row.product_id),w=by('warehouses',row.warehouse_id);
   if(!p||!w)throw fail('Choose a configured inventory item and an active factory warehouse.');
   if(!companySalesWarehouse(w))throw fail('Choose an active company stock location for opening inventory.');
   const quantity=Number(row.quantity),cost=Number(row.unit_cost);
   if(!['number','string'].includes(typeof row.quantity)||!String(row.quantity).trim()||!Number.isFinite(quantity)||quantity<=0||quantity>1e9||Math.abs(quantity*1000-Math.round(quantity*1000))>0.00001)throw fail('Enter a positive opening quantity with at most three decimal places.');
   if(!['number','string'].includes(typeof row.unit_cost)||!String(row.unit_cost).trim()||!Number.isFinite(cost)||cost<=0||cost>1e12||Math.abs(cost*1e6-Math.round(cost*1e6))>0.0001)throw fail('Enter a positive opening unit cost with at most six decimal places.');
   const lot=row.lot_number?reference(row.lot_number):'OPEN-'+date,expiry='';
   if(balances.some(b=>b.product_id===p.id&&b.warehouse_id===w.id&&(Number(b.quantity??0)!==0||Number(b.total_value??0)!==0))||movements.some(m=>m.product_id===p.id&&[m.source_warehouse_id,m.destination_warehouse_id,m.warehouse_id].includes(w.id)))throw fail('This item already has stock activity in that warehouse. Reconcile its stock in Inventory instead of importing it again.');
   const value=Math.round(quantity*cost*100);if(!Number.isSafeInteger(value)||value<=0||value>1e14)throw fail('The opening stock value is outside the supported range.');
   const empty=balances.find(b=>b.product_id===p.id&&b.warehouse_id===w.id&&norm(b.lot_number)===norm(lot));
   Object.assign(detail,{product_id:p.id,product_name:p.name,warehouse_id:w.id,warehouse_name:w.name,unit:p.unit,quantity,unit_cost:cost,total_value:value/100,lot_number:lot,expiry_date:expiry,account_id:account(p.account_id,['asset'],'debit'),balance_id:empty?.id||''});
   keys.push('stock:'+p.id+':'+w.id+':'+norm(lot));add(detail.account_id,value);
  }else if(row.kind==='asset'){
   const ref=reference(row.reference),name=text(row.name,'the existing asset name'),acquired=assetDate(row.acquisition_date);
   if(acquired>date)throw fail('An opening asset must have been acquired on or before the opening date.');
   if(existingAssets.some(a=>norm(a.asset_number)===norm(ref)||row.serial_number&&norm(a.serial_number)===norm(row.serial_number)))throw fail('This asset reference or serial number is already registered.');
   const cost=positive(row.acquisition_cost,'asset cost'),accum=money(row.accumulated_depreciation??0),salvage=money(row.salvage_value??0),months=assetMonths(row.remaining_months??60);
   if(accum+salvage>cost)throw fail('Accumulated depreciation and residual value cannot exceed the asset cost.');
   const costId=account(row.asset_account_id,['asset'],'debit'),accumId=account(row.accum_dep_account_id,['asset'],'credit'),expenseId=account(row.expense_account_id,['expense','other_expense'],'debit');
   if(new Set([costId,accumId,expenseId]).size!==3)throw fail('Use separate asset cost, accumulated depreciation and depreciation expense accounts.');
   Object.assign(detail,{reference:ref,name,acquisition_date:acquired,acquisition_cost:cost/100,accumulated_depreciation:accum/100,salvage_value:salvage/100,remaining_months:months,asset_account_id:costId,accum_dep_account_id:accumId,expense_account_id:expenseId,serial_number:String(row.serial_number||'').slice(0,160),location:String(row.location||'').slice(0,160),category:['machinery','vehicle','building','furniture','equipment','it_equipment','other'].includes(row.category)?row.category:'equipment'});
   keys.push('asset:'+norm(ref));if(row.serial_number)keys.push('asset-serial:'+norm(row.serial_number));add(costId,cost);if(accum)add(accumId,0,accum);
  }else{
   const customer=row.kind==='receivable',party=by(customer?'customers':'suppliers',row.party_id),ref=reference(row.reference);
   if(!party)throw fail('Choose an existing customer or supplier for the opening debt.');
   const issued=assetDate(row.document_date||date),due=assetDate(row.due_date||date),amount=positive(row.amount,'outstanding balance');
   if(issued>date||due<issued)throw fail('The original debt date must be on or before opening, and its due date cannot precede that document.');
   const existing=customer?existingInvoices:existingBills,field=customer?'customer_id':'supplier_id',number=customer?'invoice_number':'bill_number';
   if(existing.some(d=>d[field]===party.id&&[d[number],d.opening_document_reference].some(v=>norm(v)===norm(ref))))throw fail('This original customer invoice or supplier bill is already recorded.');
   const id=account(setup.defaults[customer?'customer_receivable':'supplier_payable'],[customer?'asset':'liability'],customer?'debit':'credit');
   Object.assign(detail,{party_id:party.id,party_name:party.name,reference:ref,document_date:issued,due_date:due,amount:amount/100,account_id:id});
   keys.push(row.kind+':'+party.id+':'+norm(ref));
   add(id,customer?amount:0,customer?0:amount);
   const allocations=parties.get(id)||[];allocations.push({party_type:customer?'customer':'supplier',party_id:party.id,debit:customer?amount/100:0,credit:customer?0:amount/100});parties.set(id,allocations);
  }
  for(const key of keys){if(seen.has(key))throw fail('Each opening item, asset or original debt document can be entered only once.');seen.add(key);}
  details.push(detail);
 }
 for(const[id,allocations]of parties){const t=totals.get(id);if(allocations.reduce((n,l)=>n+money(l.debit),0)!==t.debit||allocations.reduce((n,l)=>n+money(l.credit),0)!==t.credit)throw fail('Keep customer and supplier control accounts separate from other opening categories.');}
 return {setup,details,totals,parties,accountMap,date};
}

function request(body,context){
 if(!body||!/^[\w-]{16,80}$/.test(body.requestKey||''))throw fail('Reopen opening balances for a valid save reference.');
 const payload=JSON.stringify(body),id='OD-'+hash(context.user.id+':'+body.requestKey);
 return {payload,id};
}

async function writeDetails(stores,context,prepared,id,accountJournals){
 const {details,date,accountMap,parties}=prepared,result={stock:[],assets:[],receivables:[],payables:[]};
 const marker={opening_batch_id:id,accounting_source:'opening_balances',opening_date:date,opening_imported_by:context.user.id};
 for(const row of details){
  if(row.kind==='cash')continue;
  const journalId=accountJournals.get(row.account_id||row.asset_account_id)?.id;
  if(row.kind==='stock'){
   const values={product_id:row.product_id,product_name:row.product_name,warehouse_id:row.warehouse_id,warehouse_name:row.warehouse_name,quantity:row.quantity,total_value:row.total_value,unit_cost:row.unit_cost,lot_number:row.lot_number,expiry_date:'',qc_status:'approved',...marker};
   const balance=row.balance_id?await stores.StockBalance.update(row.balance_id,values):await stores.StockBalance.create(values);
   await stores.StockMovement.create({product_id:row.product_id,product_name:row.product_name,destination_warehouse_id:row.warehouse_id,movement_type:'opening_balance',movement_date:date,quantity:row.quantity,unit_cost:row.unit_cost,total_value:row.total_value,lot_number:row.lot_number,expiry_date:row.expiry_date||undefined,status:'approved',document_type:'OpeningBalances',document_id:id,journal_id:journalId,reason:'Opening inventory',created_by:context.user.id,...marker});
   result.stock.push(balance.id);
  }else if(row.kind==='asset'){
   const cost=accountMap.get(row.asset_account_id),accum=accountMap.get(row.accum_dep_account_id),expense=accountMap.get(row.expense_account_id);
   const asset=await stores.FixedAsset.create({...marker,asset_number:row.reference,name:row.name,category:row.category,serial_number:row.serial_number,location:row.location,acquisition_date:row.acquisition_date,in_service_date:row.acquisition_date,acquisition_cost:row.acquisition_cost,accumulated_depreciation:row.accumulated_depreciation,net_book_value:Math.round((row.acquisition_cost-row.accumulated_depreciation)*100)/100,salvage_value:row.salvage_value,useful_life_months:row.remaining_months,depreciation_method:'straight_line',last_depreciation_date:date,depreciation_plan:{start:nextMonth(date),months:row.remaining_months,basis:Math.round((row.acquisition_cost-row.salvage_value-row.accumulated_depreciation)*100)/100,opening:row.accumulated_depreciation},status:row.acquisition_cost-row.accumulated_depreciation<=row.salvage_value?'fully_depreciated':'active',replacement_fund_enabled:false,asset_revision:1,asset_account_id:cost.id,asset_account_number:cost.account_number,asset_account_name:cost.name,accum_dep_account_id:accum.id,accum_dep_account_number:accum.account_number,accum_dep_account_name:accum.name,expense_account_id:expense.id,expense_account_number:expense.account_number,expense_account_name:expense.name,journal_id:journalId,notes:'Existing asset imported at opening; prior depreciation retained.'});
   result.assets.push(asset.id);
  }else{
   const customer=row.kind==='receivable',entity=customer?'Invoice':'Bill';
   const data={...marker,opening_account_id:row.account_id,opening_document_reference:row.reference,journal_id:journalId,due_date:row.due_date,total:row.amount,amount_paid:0,balance:row.amount,notes:'Opening outstanding balance from '+row.reference};
   if(customer)Object.assign(data,{invoice_number:row.reference,customer_id:row.party_id,customer_name:row.party_name,invoice_date:row.document_date,payment_type:'credit',status:'posted',subtotal:row.amount,tax_total:0});
   else Object.assign(data,{bill_number:row.reference,supplier_id:row.party_id,supplier_name:row.party_name,bill_date:row.document_date,status:'open'});
   const saved=await stores[entity].create(data);result[customer?'receivables':'payables'].push(saved.id);
  }
 }
 // Party caches are reconstructed from posted GL evidence, never added to
 // an unposted legacy setup balance a second time.
 const journals=await readRecords(stores.JournalEntry,{status:{$in:['posted','reversed']}}),posted=new Set(journals.map(j=>j.id));
 for(const[accountId,allocations]of parties){
  const lines=await readRecords(stores.JournalLine,{account_id:accountId});
  for(const partyId of new Set(allocations.map(l=>l.party_id))){
   const type=allocations.find(l=>l.party_id===partyId).party_type;
   const balance=lines.filter(l=>posted.has(l.journal_id)).flatMap(openingPartyLines).filter(l=>l.party_type===type&&l.party_id===partyId).reduce((n,l)=>n+(type==='customer'?Number(l.debit||0)-Number(l.credit||0):Number(l.credit||0)-Number(l.debit||0)),0);
   await stores[type==='customer'?'Customer':'Supplier'].update(partyId,{balance:Math.round(balance*100)/100});
  }
 }
 for(const productId of new Set(details.filter(d=>d.kind==='stock').map(d=>d.product_id))){
  const rows=await readRecords(stores.StockBalance,{product_id:productId});
  if(rows.some(b=>!Number.isFinite(Number(b.quantity))||Number(b.quantity)<0||!Number.isFinite(Number(b.total_value))||Number(b.total_value)<0))continue;
  const quantity=rows.reduce((n,b)=>n+Number(b.quantity),0),value=rows.reduce((n,b)=>n+Number(b.total_value),0);
  if(quantity>0)await stores.Product.update(productId,{current_cost:value/quantity});
 }
 return result;
}

export async function saveOpeningPosition(stores,context,body){
 access(context);
 const {id,payload}=request(body,context),old=await stores.AuditLog.get(id);
 if(old){if(old.opening_position_payload!==payload)throw fail('This save reference belongs to different opening details.',409);return {...old.opening_position_result,reused:true};}
 if(!['post','attach'].includes(body.action||'post'))throw fail('Choose a valid opening-position operation.');
 const p=await prepare(stores,context,body),accountJournals=new Map(),journalAccounts=new Map(),partyUpdates=[];let journal;
 if(!String(body.reference||'').trim()||String(body.reference).trim().length>200)throw fail('Enter the reference from your previous accounting system.');
 if(body.action==='attach'){
  if(p.setup.date!==p.date)throw fail('Use the same opening date as the recorded balances.');
  if(body.lines?.some(l=>l.account_id||Number(l.debit)||Number(l.credit)))throw fail('Link details without adding new general ledger balances.');
  const openings=await readRecords(stores.JournalEntry,{source_module:'opening_balances',status:'posted'});
  for(const [accountId,total]of p.totals){
   const account=p.accountMap.get(accountId);
   if(!account.opening_recorded||account.opening_details_recorded||money(account.opening_debit)!==total.debit||money(account.opening_credit)!==total.credit)throw fail('Details must exactly match a recorded opening account that has not already been linked.');
   let candidates=[];
   for(const opening of openings){const lines=await readRecords(stores.JournalLine,{journal_id:opening.id,account_id:accountId});for(const line of lines)candidates.push({opening,line});}
   if(candidates.length!==1)throw fail('Reconcile this account\'s opening journal before linking detailed records.');
   const {opening,line}=candidates[0];accountJournals.set(accountId,opening);
   const ids=journalAccounts.get(opening.id)||new Set();ids.add(accountId);journalAccounts.set(opening.id,ids);
   if(p.parties.has(accountId)){
    if(line.party_id||line.opening_party_allocations)throw fail('This opening account already has a party allocation.');
    partyUpdates.push({id:line.id,allocations:p.parties.get(accountId)});
   }
  }
 }else{
  const general=body.lines||[];if(!Array.isArray(general)||general.length>200)throw fail('Enter up to 200 general opening account lines.');
  const totals=new Map([...p.totals].map(([id,row])=>[id,{...row}]));
  for(const row of general){
   const d=money(row.debit??0),c=money(row.credit??0);if(!row.account_id&&!d&&!c)continue;
   if(!row.account_id||d&&c||!d&&!c||totals.has(row.account_id))throw fail('Use separate general account lines; do not enter a detailed opening balance twice.');
   const old=totals.get(row.account_id)||{account_id:row.account_id,debit:0,credit:0};old.debit+=d;old.credit+=c;totals.set(row.account_id,old);
  }
  const lines=[...totals.values()].map(l=>({...l,debit:l.debit/100,credit:l.credit/100}));
  const saved=await postOpeningBalances(stores,context,{requestKey:body.requestKey,date:p.date,reference:body.reference,lines,details:p.details,acknowledgeControlBalances:body.acknowledgeControlBalances===true},{detailed:true,detailAccounts:new Set(p.totals.keys()),partyLines:p.parties});
  journal=saved.journal;
  for(const accountId of p.totals.keys())accountJournals.set(accountId,journal);
  journalAccounts.set(journal.id,new Set(p.totals.keys()));
 }
 for(const update of partyUpdates)await stores.JournalLine.update(update.id,{opening_party_allocations:update.allocations});
 const result=await writeDetails(stores,context,p,id,accountJournals);
 for(const[journalId,ids]of journalAccounts){const existing=await stores.JournalEntry.get(journalId);await stores.JournalEntry.update(journalId,{opening_detail_account_ids:[...new Set([...(existing.opening_detail_account_ids||[]),...ids])]});}
 const answer={...result,journal:journal?{id:journal.id,journal_number:journal.journal_number}:null,linked_only:body.action==='attach'};
 await stores.AuditLog.create({id,action:body.action==='attach'?'attach_opening_details':'import_opening_position',module:'accounting',entity_type:'OpeningBalances',entity_id:journal?.id||id,user_id:context.user.id,description:'Imported '+p.details.length+' starting-position records at '+p.date,opening_position_payload:payload,opening_position_result:answer});
 return answer;
}
