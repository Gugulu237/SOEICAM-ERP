import { createHash } from 'node:crypto';
import { requireStaff, postJournal, round2, today, audit } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { assetDate, assetMoney, assetMonths, depreciationPlan, monthEnd, monthIndex, shiftMonth, scheduleThrough } from '../../lib/asset-schedule.js';

export const ASSET_ACTIONS = ['assetWorkspace','assetDepreciationPreview','assetRegister','assetUpdatePlan','assetRunDepreciation','assetFundReplacement','assetDispose'];
const idFor = (type, value) => type + '-' + createHash('sha256').update(value).digest('hex').slice(0,40);
const line = (account, debit, credit) => ({ account_id:account.id, account_number:account.account_number, account_name:account.name, debit, credit });
function text(value, name) { if (typeof value !== 'string' || !value.trim() || value.length > 500) throw Error(`Enter ${name}`); return value.trim(); }
function requestId(body, user) { if (!/^[A-Za-z0-9_-]{8,100}$/.test(body.requestKey || '')) throw Error('Reopen the form to obtain a valid save reference'); return idFor('AS',`${user.id}:${body.action}:${body.requestKey}`); }
function pastDate(value) { const date = assetDate(value); if (date > today()) throw Error('The date cannot be in the future'); return date; }
async function account(svc, id, types, normal) {
  const row = id ? await svc.entities.Account.get(id) : null;
  if (!row || row.is_active !== true || row.is_posting === false || !types.includes(row.account_type) || (normal && row.normal_balance !== normal)) throw Error(`Select an active ${normal || ''} ${types.join('/')} posting account`);
  return row;
}
async function assetAccounts(svc, asset) {
  const [cost, accum, expense] = await Promise.all([
    account(svc,asset.asset_account_id,['asset'],'debit'), account(svc,asset.accum_dep_account_id,['asset'],'credit'),
    account(svc,asset.expense_account_id,['expense','other_expense'],'debit'),
  ]);
  if (new Set([cost.id,accum.id,expense.id]).size !== 3) throw Error('Use separate asset cost, accumulated depreciation and expense accounts');
  return { cost, accum, expense };
}
async function treasury(svc, id) {
  const row = id ? await svc.entities.TreasuryAccount.get(id) : null;
  if (!row || row.is_active !== true) throw Error('Choose an active treasury account');
  return { ...row, ledger:await account(svc,row.gl_account_id,['asset'],'debit') };
}
function sameRequest(record, payload) { if (record.asset_request_payload !== JSON.stringify(payload)) throw Error('This save reference was used for different details; reopen the form'); }
async function posted(svc, entry) {
  const journal = entry.journal_id ? await svc.entities.JournalEntry.get(entry.journal_id) : null;
  if (!journal || journal.status !== 'posted' || journal.source_document_id !== entry.id) throw Error('This depreciation entry has no matching posted journal; reconcile it before funding');
}
async function reserveSummary(svc, entries) {
  const transfers = await readRecords(svc.entities.TreasuryTransaction,{ source:'asset_replacement', transaction_type:'transfer_out' });
  const journalIds = [...new Set(transfers.map(t=>t.journal_id).filter(Boolean))], valid = new Set();
  for (let i=0;i<journalIds.length;i+=100) for (const journal of await readRecords(svc.entities.JournalEntry,{id:{$in:journalIds.slice(i,i+100)},status:'posted'})) valid.add(journal.id);
  const sums = new Map();
  for (const t of transfers) if (valid.has(t.journal_id)) sums.set(t.depreciation_entry_id,round2((sums.get(t.depreciation_entry_id)||0)+Number(t.amount)));
  return { transfers, entries:entries.map(e=>{const target=Number(e.replacement_target||0),funded=sums.get(e.id)||0;return {...e,replacement_target:target,replacement_funded:funded,replacement_outstanding:Math.max(0,round2(target-funded))};}) };
}
async function preview(svc, month) {
  monthIndex(month);
  if (monthEnd(month)>today()) throw Error('Choose a completed month; depreciation is posted at month end');
  const assets=await readRecords(svc.entities.FixedAsset,{status:'active'}), rows=[], issues=[];
  for (const asset of assets) {
    let due;
    try { due=scheduleThrough(asset,month); }
    catch(error){issues.push(`${asset.name}: ${error.message}`);continue;}
    if(rows.length+due.length>500)throw Error('This run exceeds 500 asset-months. Choose an earlier month and post in smaller runs');
    for(const row of due)rows.push({...row,asset_id:asset.id,asset_number:asset.asset_number,asset_name:asset.name,replacement_target:asset.replacement_fund_enabled===false?0:row.amount});
  }
  if (rows.length>500) throw Error('This run exceeds 500 asset-months. Choose an earlier month and post in smaller runs');
  return { rows, issues, total:round2(rows.reduce((n,r)=>n+r.amount,0)), token:idFor('preview',JSON.stringify({assets,month,rows})), month };
}

export async function fixedAssetAction(client, user, body) {
  const { employee, role }=await requireStaff(client,user,['admin','cashier'],'fixed asset accounting');
  if(role!=='admin'&&employee?.status!=='active')throw Error('An active accounting staff account is required');
  client.auth.assertModule?.('accounting');
  const svc=client.asServiceRole, action=body.action;
  if(action==='assetWorkspace') {
    const [assets,entries,accounts,treasuryAccounts]=await Promise.all([readRecords(svc.entities.FixedAsset),readRecords(svc.entities.DepreciationEntry),readRecords(svc.entities.Account,{is_active:true}),readRecords(svc.entities.TreasuryAccount,{is_active:true})]);
    return {assets,...await reserveSummary(svc,entries),accounts,treasuryAccounts};
  }
  if(action==='assetDepreciationPreview')return preview(svc,body.month);

  if(action==='assetRegister') {
    const id=requestId(body,user),data=body.data||{}, payload={data,fundingAccountId:body.fundingAccountId||''};
    const existing=await svc.entities.FixedAsset.get(id);
    if(existing){sameRequest(existing,payload);return {asset:existing,reused:true};}
    const cost=assetMoney(data.acquisition_cost,'cost'),salvage=assetMoney(data.salvage_value,'residual value'),months=assetMonths(data.useful_life_months);
    if(cost<=0||salvage>cost)throw Error('Cost must be positive and residual value cannot exceed cost');
    const date=pastDate(data.acquisition_date),inService=assetDate(data.in_service_date||date);
    if(inService<date)throw Error('In-service date cannot precede acquisition');
    const accounts=await assetAccounts(svc,data);
    const asset=await svc.entities.FixedAsset.create({id,name:text(data.name,'an asset name'),category:data.category||'equipment',serial_number:String(data.serial_number||'').slice(0,250),location:String(data.location||'').slice(0,250),
      asset_number:'FA-'+id.slice(-10).toUpperCase(),acquisition_date:date,in_service_date:inService,acquisition_cost:cost,salvage_value:salvage,useful_life_months:months,depreciation_method:'straight_line',
      asset_account_id:accounts.cost.id,asset_account_number:accounts.cost.account_number,asset_account_name:accounts.cost.name,accum_dep_account_id:accounts.accum.id,accum_dep_account_number:accounts.accum.account_number,accum_dep_account_name:accounts.accum.name,
      expense_account_id:accounts.expense.id,expense_account_number:accounts.expense.account_number,expense_account_name:accounts.expense.name,
      accumulated_depreciation:0,net_book_value:cost,status:cost===salvage?'fully_depreciated':'active',replacement_fund_enabled:data.replacement_fund_enabled!==false,
      depreciation_plan:{start:inService.slice(0,7),months,basis:round2(cost-salvage),opening:0},asset_revision:1,created_by:user.id,asset_request_payload:JSON.stringify(payload)});
    if(body.fundingAccountId) {
      const credit=await account(svc,body.fundingAccountId,['asset','liability']);
      if([accounts.cost.id,accounts.accum.id].includes(credit.id))throw Error('The acquisition credit account must be separate from the asset accounts');
      let cash;
      if(credit.account_type==='liability'&&credit.normal_balance!=='credit')throw Error('The payable must be a credit-normal liability account');
      if(credit.account_type==='asset') {
        client.auth.assertModule?.('cashier');
        const matches=await readRecords(svc.entities.TreasuryAccount,{gl_account_id:credit.id,is_active:true});
        if(matches.length!==1)throw Error('Cash acquisitions require one active treasury account linked to the credit account');
        cash=await treasury(svc,matches[0].id);
        if(Number(cash.balance)<cost)throw Error('Insufficient treasury funds for this acquisition');
      }
      const {journal}=await postJournal(svc,{entryDate:date,description:`Asset acquisition: ${asset.name}`,sourceModule:'assets',sourceDocumentType:'FixedAsset',sourceDocumentId:asset.id,userId:user.id,lines:[line(accounts.cost,cost,0),line(credit,0,cost)]});
      asset.journal_id=journal.id;await svc.entities.FixedAsset.update(id,{journal_id:journal.id});
      if(cash){await svc.entities.TreasuryAccount.update(cash.id,{balance:round2(Number(cash.balance)-cost)});await svc.entities.TreasuryTransaction.create({treasury_account_id:cash.id,treasury_account_name:cash.name,transaction_type:'expense',amount:cost,transaction_date:date,source:'asset_acquisition',source_document_id:id,journal_id:journal.id,description:`Asset acquisition: ${asset.name}`,created_by:user.id});}
    }
    await audit(svc,{action:'create_asset',module:'assets',entityType:'FixedAsset',entityId:id,userId:user.id,description:`Registered ${asset.name}: ${months} months`});
    return {asset};
  }
  if(action==='assetUpdatePlan') {
    const asset=await svc.entities.FixedAsset.get(body.assetId);
    if(!asset||!['active','fully_depreciated'].includes(asset.status))throw Error('Select an active asset');
    if(Number(body.revision||0)!==Number(asset.asset_revision||0))throw Error('This asset changed; refresh before saving');
    const months=assetMonths(body.months),salvage=assetMoney(body.salvageValue,'residual value'),cost=Number(asset.acquisition_cost),accumulated=Number(asset.accumulated_depreciation||0);
    if(salvage>round2(cost-accumulated))throw Error('Residual value cannot exceed the current book value');
    const plan={nextMonth:asset.last_depreciation_date?shiftMonth(assetDate(asset.last_depreciation_date).slice(0,7),1):assetDate(asset.in_service_date||asset.acquisition_date).slice(0,7)};
    const {cost:costAccount,accum,expense}=await assetAccounts(svc,{...asset,accum_dep_account_id:body.accumAccountId||asset.accum_dep_account_id,expense_account_id:body.expenseAccountId||asset.expense_account_id});
    const basis=round2(cost-salvage-accumulated);
    const changes={useful_life_months:months,salvage_value:salvage,depreciation_method:'straight_line',replacement_fund_enabled:body.replacementFundEnabled!==false,
      depreciation_plan:{start:plan.nextMonth,months,basis,opening:accumulated},asset_revision:Number(asset.asset_revision||0)+1,status:basis>0?'active':'fully_depreciated',
      asset_account_id:costAccount.id,accum_dep_account_id:accum.id,accum_dep_account_name:accum.name,accum_dep_account_number:accum.account_number,expense_account_id:expense.id,expense_account_name:expense.name,expense_account_number:expense.account_number};
    if(accumulated>0&&accum.id!==asset.accum_dep_account_id)throw Error('An accumulated depreciation account with a posted balance cannot be reassigned');
    await svc.entities.FixedAsset.update(asset.id,changes);
    await audit(svc,{action:'revise_asset_plan',module:'assets',entityType:'FixedAsset',entityId:asset.id,userId:user.id,description:`${asset.name}: ${months} remaining months from ${plan.nextMonth}; previous charges retained`});
    return {asset:{...asset,...changes}};
  }
  if(action==='assetRunDepreciation') {
    const id=requestId(body,user),marker=await svc.entities.AuditLog.get(id),payload={month:body.month};
    if(marker){sameRequest(marker,payload);return {...marker.asset_result,reused:true};}
    const plan=await preview(svc,body.month);
    if(plan.issues.length)throw Error(plan.issues.join('; '));
    if(body.previewToken!==plan.token)throw Error('The depreciation preview changed. Refresh it before posting');
    let postedCount=0,total=0;
    const loaded=new Map();
    for(const row of plan.rows) {
      if(!loaded.has(row.asset_id)){const asset=await svc.entities.FixedAsset.get(row.asset_id);loaded.set(row.asset_id,{asset,accounts:await assetAccounts(svc,asset)});}
      const {asset,accounts}=loaded.get(row.asset_id),id=idFor('DEP',`${asset.id}:${row.month}`);
      const existing=await readRecords(svc.entities.DepreciationEntry,{asset_id:asset.id,period_label:row.month});
      if(existing.length)throw Error(`A depreciation entry already exists for ${asset.name} / ${row.month}; reconcile the register before continuing`);
      if(row.amount>0) {
        const entry=await svc.entities.DepreciationEntry.create({id,asset_id:asset.id,asset_number:asset.asset_number,asset_name:asset.name,period_label:row.month,depreciation_date:row.date,amount:row.amount,accumulated_after:row.accumulated_after,net_book_value_after:row.net_book_value_after,replacement_target:row.replacement_target,created_by:user.id});
        const {journal}=await postJournal(svc,{entryDate:row.date,description:`Depreciation ${row.month}: ${asset.name}`,sourceModule:'assets',sourceDocumentType:'DepreciationEntry',sourceDocumentId:entry.id,userId:user.id,lines:[line(accounts.expense,row.amount,0),line(accounts.accum,0,row.amount)]});
        await svc.entities.DepreciationEntry.update(id,{journal_id:journal.id});postedCount++;total=round2(total+row.amount);
      }
      const changes={depreciation_plan:asset.depreciation_plan||depreciationPlan(asset),accumulated_depreciation:row.accumulated_after,net_book_value:row.net_book_value_after,last_depreciation_date:row.date,status:row.net_book_value_after<=Number(asset.salvage_value)?'fully_depreciated':'active',asset_revision:Number(asset.asset_revision||0)+1};
      await svc.entities.FixedAsset.update(asset.id,changes);Object.assign(asset,changes);
    }
    const result={posted:postedCount,total};
    await svc.entities.AuditLog.create({id,action:'run_depreciation',module:'assets',entity_type:'DepreciationEntry',entity_id:body.month,user_id:user.id,description:`Depreciation ${body.month}: ${postedCount} entries, ${total} XAF`,asset_request_payload:JSON.stringify(payload),asset_result:result});
    return result;
  }
  if(action==='assetFundReplacement') {
    client.auth.assertModule?.('cashier');
    const id=requestId(body,user),amount=assetMoney(body.amount),date=pastDate(body.date),reference=text(body.reference,'the actual transfer reference');
    const payload={entryId:body.entryId,fromId:body.fromId,toId:body.toId,amount,date,reference},existing=await svc.entities.TreasuryTransaction.get(id);
    if(existing){sameRequest(existing,payload);return {transaction:existing,reused:true};}
    const entry=await svc.entities.DepreciationEntry.get(body.entryId);
    if(!entry)throw Error('Select a depreciation entry');
    await posted(svc,entry);
    if(date<entry.depreciation_date)throw Error('The funding date cannot precede the depreciation charge');
    const {entries}=await reserveSummary(svc,[entry]);
    if(amount<=0||amount>entries[0].replacement_outstanding)throw Error('Enter an amount within the remaining replacement funding target');
    const [from,to]=await Promise.all([treasury(svc,body.fromId),treasury(svc,body.toId)]);
    if(from.id===to.id||from.gl_account_id===to.gl_account_id)throw Error('Choose distinct source and reserve treasury accounts with separate ledger accounts');
    if(amount>Number(from.balance))throw Error(`Insufficient funds in ${from.name}`);
    const description=`Replacement fund: ${entry.asset_name} / ${entry.period_label}`;
    const metadata={source:'asset_replacement',asset_id:entry.asset_id,depreciation_entry_id:entry.id,amount,transaction_date:date,description,reference,created_by:user.id};
    const tx=await svc.entities.TreasuryTransaction.create({...metadata,id,transaction_number:'RF-'+id.slice(-10).toUpperCase(),treasury_account_id:from.id,treasury_account_name:from.name,counterparty_account_id:to.id,counterparty_account_name:to.name,transaction_type:'transfer_out',asset_request_payload:JSON.stringify(payload)});
    const {journal}=await postJournal(svc,{entryDate:date,description,sourceModule:'assets',sourceDocumentType:'AssetReplacementFunding',sourceDocumentId:id,userId:user.id,lines:[line(to.ledger,amount,0),line(from.ledger,0,amount)]});
    await svc.entities.TreasuryTransaction.update(id,{journal_id:journal.id});
    await svc.entities.TreasuryTransaction.create({...metadata,id:id+'-in',treasury_account_id:to.id,treasury_account_name:to.name,counterparty_account_id:from.id,counterparty_account_name:from.name,transaction_type:'transfer_in',source_document_id:id,journal_id:journal.id});
    await svc.entities.TreasuryAccount.update(from.id,{balance:round2(Number(from.balance)-amount)});
    await svc.entities.TreasuryAccount.update(to.id,{balance:round2(Number(to.balance||0)+amount)});
    await audit(svc,{action:'fund_asset_replacement',module:'assets',entityType:'DepreciationEntry',entityId:entry.id,userId:user.id,description:`${amount} XAF transferred from ${from.name} to ${to.name}; ${reference}`});
    return {transaction:{...tx,journal_id:journal.id}};
  }
  if(action==='assetDispose') {
    const asset=await svc.entities.FixedAsset.get(body.assetId);
    if(!asset)throw Error('Select an asset');
    if(asset.status==='disposed'){const payload=JSON.stringify({date:body.date,proceeds:Number(body.proceeds),proceedsAccountId:body.proceedsAccountId||'',gainLossAccountId:body.gainLossAccountId||''});if(asset.disposal_payload&&asset.disposal_payload!==payload)throw Error('This asset was already disposed with different details');return {reused:true};}
    if(asset.status==='written_off')throw Error('This asset is already written off');
    const date=pastDate(body.date),proceeds=assetMoney(body.proceeds),accounts=await assetAccounts(svc,asset);
    if(date<asset.acquisition_date||date<(asset.last_depreciation_date||''))throw Error('Disposal cannot precede acquisition or posted depreciation');
    const cost=Number(asset.acquisition_cost),accumulated=Number(asset.accumulated_depreciation||0),gain=round2(proceeds-(cost-accumulated));
    const lines=[line(accounts.accum,accumulated,0),line(accounts.cost,0,cost)];
    let cash;
    if(proceeds>0){const receiving=await account(svc,body.proceedsAccountId,['asset'],'debit');if(receiving.id===accounts.cost.id)throw Error('Disposal proceeds cannot be credited to the disposed asset');lines.push(line(receiving,proceeds,0));
      const matches=await readRecords(svc.entities.TreasuryAccount,{gl_account_id:receiving.id,is_active:true});
      if(matches.length>1)throw Error('The proceeds ledger has multiple treasury accounts; correct the mapping first');
      if(matches.length){client.auth.assertModule?.('cashier');cash=await treasury(svc,matches[0].id);}
    }
    if(gain!==0)lines.push(line(await account(svc,body.gainLossAccountId,gain>0?['other_income','revenue']:['other_expense','expense']),gain<0?-gain:0,gain>0?gain:0));
    const {journal}=await postJournal(svc,{entryDate:date,description:`Disposal: ${asset.name}`,sourceModule:'assets',sourceDocumentType:'AssetDisposal',sourceDocumentId:'disposal-'+asset.id,userId:user.id,lines});
    await svc.entities.FixedAsset.update(asset.id,{status:'disposed',disposal_date:date,disposal_proceeds:proceeds,disposal_gain_loss:gain,disposal_payload:JSON.stringify({date:body.date,proceeds:Number(body.proceeds),proceedsAccountId:body.proceedsAccountId||'',gainLossAccountId:body.gainLossAccountId||''}),net_book_value:0,asset_revision:Number(asset.asset_revision||0)+1});
    if(cash){await svc.entities.TreasuryAccount.update(cash.id,{balance:round2(Number(cash.balance||0)+proceeds)});await svc.entities.TreasuryTransaction.create({treasury_account_id:cash.id,treasury_account_name:cash.name,transaction_type:'receipt',amount:proceeds,transaction_date:date,source:'asset_disposal',source_document_id:asset.id,journal_id:journal.id,description:'Asset disposal: '+asset.name,created_by:user.id});}
    await audit(svc,{action:'dispose_asset',module:'assets',entityType:'FixedAsset',entityId:asset.id,userId:user.id,description:`Disposed ${asset.name}; replacement funding history retained`});
    return {journal};
  }
  throw Error('Unknown asset action');
}
