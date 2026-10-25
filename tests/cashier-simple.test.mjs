import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,date,user} from './helpers/cashier.mjs';
import {cashierAction} from '../src/server/domain/cashier-workspace.js';
import {cashDepositors,receiptAllocations} from '../src/lib/cashier-receipts.js';
test('depositor menu separates Commercial cash, recorded cash sales and customer credit receipts',()=>{
 const options=cashDepositors({handovers:[{id:'h',commercial_name:'Agent',handover_date:date,status:'partially_received',expected_amount:1000,received_amount:400}],depositDays:[{id:'day',commercial_name:'New agent',collection_date:date,requestable:1500,disputed:false}],invoices:[{id:'paid',customer_id:'c',available_amount:0},{id:'cash',invoice_number:'INV-CASH',customer_id:'c',customer_name:'Cash customer',stock_holder_name:'Delivery employee',payment_type:'cash',available_amount:1000},{id:'credit',invoice_number:'INV-CREDIT',customer_id:'c',customer_name:'Credit customer',payment_type:'credit',available_amount:2000}]});
 assert.equal(options.length,4);assert.equal(options.find(o=>o.id==='handover:h').amount,600);
 assert.equal(options.find(o=>o.id==='invoice:cash').name,'Delivery employee');
 assert.equal(options.find(o=>o.id==='customer:c').amount,2000);
 assert.equal(options.filter(o=>o.group==='Customer payments').length,1);
});
test('receipt allocation cannot exceed unreserved invoices and keeps fractional amounts exact',()=>{
 assert.deepEqual(receiptAllocations([{id:'a',available_amount:100.1},{id:'b',available_amount:200}],150.2),[{invoice_id:'a',amount:100.1},{invoice_id:'b',amount:50.1}]);
 assert.throws(()=>receiptAllocations([{id:'a',available_amount:100}],101),/exceeds/);
 assert.throws(()=>receiptAllocations([],0),/greater than zero/);
});
test('daily savings and petty cash top-ups move money once without creating sales or expenses',async()=>{
 const {client,entities:s}=await fixture();
 const gl=await s.Account.create({name:'Cash reserve',account_number:'5719',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:0});
 const reserve=await s.TreasuryAccount.create({name:'Cash reserve',account_type:'cash',gl_account_id:gl.id,balance:0,is_active:true});
 const body={action:'cashierTransfer',date,requestKey:'daily-savings-key',accountId:'till',toAccountId:reserve.id,amount:2500,description:'Daily savings',reference:'SAV-1',purpose:'daily_savings'};
 await cashierAction(client,user,body);await cashierAction(client,user,body);
 assert.equal((await s.TreasuryAccount.get('till')).balance,97500);assert.equal((await s.TreasuryAccount.get(reserve.id)).balance,2500);
 const tx=await s.TreasuryTransaction.list();assert.equal(tx.length,2);assert.ok(tx.every(t=>t.source==='daily_savings'));
 const journal=await s.JournalLine.list();assert.ok(journal.every(l=>[gl.id,'till-gl'].includes(l.account_id)));
 assert.equal((await s.ExpenseRequest.list()).length,1);assert.equal((await s.Invoice.list()).length,0);
 await assert.rejects(cashierAction(client,user,{...body,requestKey:'bank-savings-key',toAccountId:'bank'}),e=>e.status===403);
 await assert.rejects(cashierAction(client,user,{...body,requestKey:'float-savings-key',toAccountId:'float'}),/petty cash/);
 await cashierAction(client,user,{...body,requestKey:'top-up-float-key',toAccountId:'float',purpose:'petty_cash_replenishment'});
 assert.equal((await s.TreasuryAccount.get('float')).balance,102500);
});
test('one confirmation atomically prepares and receives daily cash; a late failure rolls everything back',async()=>{
 const db=new PGlite();
 try{
  const {client,entities:s}=await fixture(db),route=await functionRoute();
  const collection=await s.CashCollection.create({commercial_id:'daily-agent',commercial_name:'Daily agent',customer_id:'customer-a',collection_number:'DAILY-1',collection_date:date,amount_collected:2500,outstanding_amount:2500,received_amount:0,method:'cash',status:'held_by_commercial'});
  globalThis.__cashierClient=client;globalThis.__cashierTransaction=async callback=>{await db.exec('BEGIN');try{const result=await callback();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};
  const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,original=s.Account.update;let fail=true;
  s.Account.update=async(id,value)=>{if(id==='till-gl'&&fail)throw Error('Receipt ledger unavailable');return original(id,value);};
  const body={action:'cashierReceiveDailyCash',date,collectionDate:date,commercialId:'daily-agent',collectionIds:[collection.id],expectedAmount:2500,receivedAmount:2500,treasuryAccountId:'till',requestKey:'atomic-daily-cash'},params={params:Promise.resolve({name:'fieldOps'})};
  assert.equal((await route(request(body),params)).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
  fail=false;assert.equal((await route(request(body),params)).status,200);assert.equal((await route(request(body),params)).status,200);
  assert.equal((await s.TreasuryAccount.get('till')).balance,102500);assert.equal((await s.CashCollection.get(collection.id)).status,'received');
  assert.equal((await s.CashHandover.list()).length,2);assert.equal((await s.JournalEntry.list()).length,1);assert.equal((await s.TreasuryTransaction.list()).length,1);
  assert.equal((await s.FieldSale.list()).length,0);assert.equal((await s.Invoice.list()).length,0);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
