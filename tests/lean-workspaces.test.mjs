import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,date,user} from './helpers/cashier.mjs';
import {cashierAction} from '../src/server/domain/cashier-workspace.js';
import {businessOverview} from '../src/server/domain/business-overview.js';
import {recordScope,assertEntityAccess,guardMutation} from '../src/server/access.js';
import {guardTreasuryReferences,CASH_ACCOUNT_TYPES} from '../src/lib/treasury-access.js';
import {payrollWorkspace} from '../src/server/domain/payroll-v2.js';
import {isReadOnlyFunction} from '../src/lib/function-actions.js';

test('Cashier receives only cash accounts and movements; administrators retain bank access',async()=>{
 const {client,entities:s,rows}=await fixture();
 await s.TreasuryTransaction.create({treasury_account_id:'bank',treasury_account_name:'Private bank',transaction_date:date,amount:54321,transaction_type:'receipt'});
 await s.TreasuryTransaction.create({treasury_account_id:'till',treasury_account_name:'till',transaction_date:date,amount:1000,transaction_type:'receipt'});
 const cash=await cashierAction(client,user,{action:'cashierWorkspace',date});
 assert.deepEqual(cash.accounts.map(a=>a.id),['till','float']);assert.equal(cash.movements.length,1);assert.equal(cash.movements[0].treasury_account_name,'till');assert.equal(cash.role,'cashier');
 const admin=await cashierAction(client,{...user,role:'admin'},{action:'cashierWorkspace',date});
 assert.ok(admin.accounts.some(a=>a.id==='bank'));assert.equal(admin.movements.length,2);
 const context={user,role:'cashier',employee:rows.Employee[0]};
 assert.deepEqual(await recordScope(context,'TreasuryAccount','aggregate',s),{account_type:{$in:CASH_ACCOUNT_TYPES}});
 assert.deepEqual(await recordScope(context,'Account','get',s),{account_type:{$in:['expense','other_expense']}});
 assert.throws(()=>assertEntityAccess(context,'JournalLine','aggregate'));
 assert.throws(()=>guardMutation(context,'TreasuryAccount','create',{account_type:'bank',name:'Private'}),/administrators/);
 await assert.rejects(guardTreasuryReferences(s,'cashier',{treasury_account_id:'bank'}),/administrators/);
 const payroll=await payrollWorkspace(s,context);assert.ok(payroll.treasury_accounts.every(a=>a.account_type!=='bank'));
});

test('forged bank targets and historical bank retries are rejected before balances or journals change',async()=>{
 const {client,entities:s}=await fixture();
 const body={action:'cashierTransfer',date,requestKey:'safe-transfer-key',accountId:'till',toAccountId:'bank',amount:1000,description:'Transfer',reference:'TRANSFER-1'};
 await assert.rejects(cashierAction(client,user,body),e=>e.status===403);
 assert.equal((await s.TreasuryAccount.get('bank')).balance,100000);assert.equal((await s.TreasuryAccount.get('till')).balance,100000);assert.equal((await s.JournalEntry.list()).length,0);
 await s.TreasuryTransaction.create({cashier_request_key:user.id+':cashierTransfer:old-bank-request',treasury_account_id:'bank',amount:1000});
 await assert.rejects(cashierAction(client,user,{...body,toAccountId:'float',requestKey:'old-bank-request'}),e=>e.status===403);
 assert.equal((await s.JournalEntry.list()).length,0);
});

test('administrators can still transfer bank funds exactly once',async()=>{
 const {client,entities:s}=await fixture(),admin={...user,role:'admin'};
 const body={action:'cashierTransfer',date,requestKey:'admin-bank-transfer',accountId:'bank',toAccountId:'till',amount:1000,description:'Cash float funding',reference:'ADMIN-TRANSFER-1'};
 const first=await cashierAction(client,admin,body),again=await cashierAction(client,admin,body);
 assert.equal((await s.TreasuryAccount.get('bank')).balance,99000);assert.equal((await s.TreasuryAccount.get('till')).balance,101000);
 assert.equal(again.reused,true);assert.equal(again.transaction.id,first.transaction.id);assert.equal((await s.JournalEntry.list()).length,1);
});

test('company overview uses posted ledger profit, excludes drafts and purchases, and never loads product images',async()=>{
 const {client,entities:s}=await fixture();
 const accountIds={};
 for(const [id,type] of [['report-sales','revenue'],['report-cost','cogs'],['report-expense','expense'],['report-other','other_income']])accountIds[id]=(await s.Account.create({name:id,account_type:type})).id;
 const posted=await s.JournalEntry.create({status:'posted',entry_date:date}),draft=await s.JournalEntry.create({status:'draft',entry_date:date});
 for(const [account_id,debit,credit] of [['report-sales',0,100000],['report-cost',30000,0],['report-expense',20000,0],['report-other',0,5000]])await s.JournalLine.create({journal_id:posted.id,account_id:accountIds[account_id],debit,credit});
 await s.JournalLine.create({journal_id:draft.id,account_id:accountIds['report-sales'],debit:0,credit:900000});
 for(const [name,store] of Object.entries(s))store.aggregate=async({query={},groupBy,sum=[]}={})=>{const records=await store.filter(query),groups=new Map();for(const row of records){const key=groupBy?row[groupBy]:'all';if(!groups.has(key))groups.set(key,{count:0,...(groupBy?{[groupBy]:key}:{})});const out=groups.get(key);out.count++;for(const field of Array.isArray(sum)?sum:[sum])out['sum_'+field]=(out['sum_'+field]||0)+Number(row[field]||0);}return {rows:[...groups.values()]};};
 s.Product.filter=()=>{throw Error('Business summary must not fetch product images');};
 const data=await businessOverview(client,{...user,role:'admin'},{from:date.slice(0,8)+'01',to:date});
 assert.equal(data.sales,100000);assert.equal(data.cogs,30000);assert.equal(data.expenses,20000);assert.equal(data.other_income,5000);assert.equal(data.profit,55000);assert.equal(data.margin,55);assert.equal(data.cash,300000);assert.equal(data.posted_journals,1);
 assert.equal(data.sales_trend.length,1);assert.equal(data.sales_trend[0].amount,100000);
 assert.ok(isReadOnlyFunction('fieldOps','businessOverview'));
 await assert.rejects(businessOverview(client,user,{from:date,to:date}),/Not permitted/);
 await assert.rejects(businessOverview(client,{...user,role:'admin'},{from:'2026-02-30',to:date}),/valid report date/);
});
