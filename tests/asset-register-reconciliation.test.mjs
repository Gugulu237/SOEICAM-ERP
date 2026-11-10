import test from 'node:test';
import assert from 'node:assert/strict';
import {assetRegisterReconciliation} from '../src/server/domain/asset-register-reconciliation.js';
import {fixedAssetAction} from '../src/server/domain/fixed-assets.js';
import {assetAccountWorkspace} from '../src/server/domain/asset-account-link.js';
import {assetSetupIncomplete,assetScheduleStatus} from '../src/lib/asset-register-review.js';

function fixture(){
 const account=(id,number,type,normal,balance,extra={})=>({id,account_number:number,name:'Fixture '+id,account_type:type,normal_balance:normal,balance,is_active:true,is_posting:true,...extra});
 const records={Account:[account('plant','2210','asset','debit',1500),account('instrument','2211','asset','debit',400),account('contra','2819','asset','credit',200),account('equity','3000','equity','credit',1900),account('expense','6800','expense','debit',200),account('old-empty','2200','asset','debit',0,{is_posting:false}),account('till','2990','asset','debit',500),account('stock','2991','asset','debit',600),account('control','2992','asset','debit',700,{is_control_account:true})],FixedAsset:[{id:'legacy',name:'Historical equipment record',asset_account_id:'old-empty',acquisition_cost:0,accumulated_depreciation:0,net_book_value:0,status:'fully_depreciated'},{id:'registered',name:'Reviewed instrument',asset_account_id:'instrument',accum_dep_account_id:'contra',expense_account_id:'expense',acquisition_date:'2025-01-01',in_service_date:'2025-01-01',acquisition_cost:400,accumulated_depreciation:80,net_book_value:320,salvage_value:0,useful_life_months:60,depreciation_method:'straight_line',last_depreciation_date:'2026-10-31',status:'active',automatic_depreciation:{enabled:false}}],TreasuryAccount:[{id:'cash-desk',gl_account_id:'till',account_type:'cash',balance:500,is_active:true}],PostingRule:[{id:'stock-rule',rule_key:'finished_goods_inventory',account_id:'stock',is_active:true}],Product:[],JournalEntry:[],JournalLine:[],DepreciationEntry:[],TreasuryTransaction:[],AuditLog:[]};
 const post=(id,date,entries,status='posted')=>{const debit=entries.reduce((n,e)=>n+(e.debit||0),0),credit=entries.reduce((n,e)=>n+(e.credit||0),0);records.JournalEntry.push({id,journal_number:'JV-'+id,entry_date:date,status,total_debit:debit,total_credit:credit,description:'Fixture source '+id,private_notes:'SECRET-HEADER'});records.JournalLine.push(...entries.map((e,i)=>({id:id+'-'+i,journal_id:id,debit:0,credit:0,...e,private_cost:'SECRET-LINE'})));};
 post('opening','2025-01-01',[{account_id:'plant',debit:1500},{account_id:'instrument',debit:400},{account_id:'equity',credit:1900}]);post('depreciation','2025-12-31',[{account_id:'expense',debit:200},{account_id:'contra',credit:200}]);post('original','2026-01-01',[{account_id:'plant',debit:20},{account_id:'equity',credit:20}],'reversed');post('reversal','2026-02-01',[{account_id:'equity',debit:20},{account_id:'plant',credit:20}]);post('draft','2026-03-01',[{account_id:'plant',debit:999},{account_id:'equity',credit:999}],'draft');
 const calls=[];
 const matches=(row,q)=>Object.entries(q||{}).every(([k,v])=>v&&typeof v==='object'&&'$in'in v?v.$in.includes(row[k]):row[k]===v);
 const stores=Object.fromEntries(Object.entries(records).map(([name,rows])=>[name,{filter:async(q,sort,limit,skip=0)=>{calls.push({name,q});return structuredClone(rows.filter(r=>matches(r,q)).slice(skip,limit?skip+limit:undefined));},get:async id=>structuredClone(rows.find(r=>r.id===id)),create(){throw Error('Read-only reconciliation attempted create');},update(){throw Error('Read-only reconciliation attempted update');}}]));
 return {records,stores,calls,post,client:{auth:{staff:async()=>({id:'fixture-gm',role:'admin',status:'active'}),assertModule:()=>{}},asServiceRole:{entities:stores}}};
}

test('register reconciliation separates gross/contra and saved zero-cost metadata without inventing asset rows',async()=>{
 const f=fixture(),before=structuredClone(f.records),data=await assetRegisterReconciliation(f.stores,{assets:f.records.FixedAsset,accounts:f.records.Account,treasuryAccounts:f.records.TreasuryAccount,date:'2026-11-10'});
 assert.equal(data.gross_ledger_cost,1900);assert.equal(data.accumulated_ledger_depreciation,200);assert.equal(data.ledger_net_book_value,1700);assert.equal(data.awaiting_registration_cost,1500);assert.deepEqual(data.incomplete_assets,['legacy']);
 assert.deepEqual(data.rows.map(r=>r.account.id).sort(),['contra','instrument','plant']);assert.equal(data.rows.find(r=>r.account.id==='plant').registered_value,0);assert.equal(data.rows.find(r=>r.account.id==='instrument').unassigned_value,0);assert.equal(data.rows.find(r=>r.account.id==='contra').unassigned_value,120);
 assert.equal(data.rows.find(r=>r.account.id==='plant').can_review_registration,true);assert.equal(data.rows.find(r=>r.account.id==='contra').can_review_registration,false);assert.deepEqual(f.records,before);
 assert.doesNotMatch(JSON.stringify(data),/SECRET|private_notes|private_cost/);assert.ok(data.rows.find(r=>r.account.id==='plant').cost_sources.some(r=>r.id==='original'));assert.ok(data.rows.find(r=>r.account.id==='plant').cost_sources.some(r=>r.id==='reversal'));assert.ok(!data.rows.find(r=>r.account.id==='plant').cost_sources.some(r=>r.id==='draft'));
 assert.equal(f.calls.filter(c=>c.name==='JournalLine'&&c.q.account_id).length,1,'account lines are loaded in one bounded batch');assert.equal(f.calls.filter(c=>c.name==='JournalEntry').length,1);
});

test('inconsistent ledger evidence remains unavailable and cannot become a false zero or an eligible registration',async()=>{
 const f=fixture();f.records.Account.find(a=>a.id==='plant').balance=1600;
 const data=await assetRegisterReconciliation(f.stores,{assets:f.records.FixedAsset,accounts:f.records.Account,treasuryAccounts:f.records.TreasuryAccount});
 const row=data.rows.find(r=>r.account.id==='plant');assert.equal(row.ledger_balance,null);assert.equal(row.stored_balance,1600);assert.equal(row.can_review_registration,false);assert.equal(data.gross_ledger_cost,null);assert.equal(data.awaiting_registration_cost,null);assert.match(row.issues.join(' '),/does not match its posted ledger/);
});

test('assetWorkspace is a read-only register/status/reconciliation projection and preserves actual saved records',async()=>{
 const f=fixture(),before=structuredClone(f.records),data=await fixedAssetAction(f.client,{id:'gm',role:'admin'},{action:'assetWorkspace'});
 assert.deepEqual(data.assets,before.FixedAsset);assert.equal(data.assets.length,2);assert.equal(data.assets[0].status,'fully_depreciated');assert.equal(data.assets[0].acquisition_cost,0);assert.equal(data.reconciliation.awaiting_registration_cost,1500);assert.equal(typeof data.depreciationStatus.pending_count,'number');assert.deepEqual(f.records,before);
 const workspace=await assetAccountWorkspace(f.stores,'plant');assert.equal(workspace.eligible,true);assert.equal(workspace.ledger_cost,1500);assert.ok(workspace.cost_sources.every(source=>['posted','reversed'].includes(f.records.JournalEntry.find(j=>j.id===source.id).status)));
});

test('register authorization refuses unauthorized roles before reading any company asset data',async()=>{
 const client={auth:{staff:async()=>({role:'commercial',status:'active'})},get asServiceRole(){throw Error('Private read before authorization');}};
 await assert.rejects(fixedAssetAction(client,{id:'agent',role:'user'},{action:'assetWorkspace'}),/Not permitted/);
 const f=fixture();f.client.auth.assertModule=()=>{throw Error('Accounting module disabled');};await assert.rejects(fixedAssetAction(f.client,{id:'gm',role:'admin'},{action:'assetWorkspace'}),/Accounting module disabled/);assert.equal(f.calls.length,0);
});

test('legacy zero-cost status is reviewed without reclassification or any inferred schedule',()=>{
 const legacy={id:'legacy',acquisition_cost:0,accumulated_depreciation:0,net_book_value:0,status:'fully_depreciated'},before=structuredClone(legacy);
 assert.equal(assetSetupIncomplete(legacy),true);assert.deepEqual(assetScheduleStatus([legacy],{date:'2026-11-10'}),{through:'2026-10',pending_count:0,pending_total:0,manual_count:0,issues:[]});assert.deepEqual(legacy,before);
});

test('foreign-currency balances are not silently reported or linked as XAF amounts',async()=>{
 const f=fixture();f.records.Account.find(a=>a.id==='plant').currency='USD';
 const data=await assetRegisterReconciliation(f.stores,{assets:f.records.FixedAsset,accounts:f.records.Account,treasuryAccounts:f.records.TreasuryAccount}),row=data.rows.find(r=>r.account.id==='plant');
 assert.equal(row.can_review_registration,false);assert.equal(row.ledger_balance,null);assert.equal(row.stored_balance,null);assert.equal(data.gross_ledger_cost,null);assert.equal(data.awaiting_registration_cost,null);assert.match(row.issues.join(' '),/denominated in XAF/);
});
