import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {postedSaleFixture,postedFieldFixture} from './helpers/posted-sale-edit-fixture.mjs';
import {postedSaleEditAction} from '../src/server/domain/posted-sale-edits.js';
import {saleReversalAction} from '../src/server/domain/sale-reversals.js';
const call=(f,body)=>postedSaleEditAction(f.client,f.user,{invoiceId:'invoice',...body});
async function edit(f,patch={}){
 const workspace=await call(f,{action:'postedSaleEditWorkspace'});
 const body={customerId:workspace.customerId,locationId:workspace.locationId,paymentType:workspace.paymentType,treasuryAccountId:workspace.treasuryAccountId||'till',reference:'R-1',reason:'Physical receipt checked',lines:workspace.lines.map(l=>({line_id:l.line_id,quantity:l.quantity})),...patch};
 const review=await call(f,{action:'previewPostedSaleEdit',...body});
 const save={action:'savePostedSaleEdit',...body,requestKey:randomUUID(),fingerprint:review.fingerprint,confirmed:true};
 return {review,save,post:()=>call(f,save)};
}
const line=q=>[{line_id:'invoice-line',quantity:q}];
test('posted edit workspace and preview do not mutate sales, cash, accounting or stock',async()=>{
 const f=postedSaleFixture(),before=structuredClone(f.rows);
 await edit(f,{lines:line(3)});assert.deepEqual(f.rows,before);
});
test('cash invoice becomes unpaid credit without another stock issue, invoice number or journal',async()=>{
 const f=postedSaleFixture({cash:true}),before=structuredClone(f.rows.StockMovement),e=await edit(f,{paymentType:'credit'});
 const result=await e.post(),invoice=f.rows.Invoice[0];
 assert.equal(invoice.invoice_number,'INV-TEST');assert.equal(invoice.payment_type,'credit');assert.equal(invoice.amount_paid,0);assert.equal(invoice.balance,2000);
 assert.equal(f.rows.Customer[0].balance,2000);assert.equal(f.rows.TreasuryAccount[0].balance,100000);assert.equal(f.rows.TreasuryTransaction[0].amount,0);
 assert.equal(f.rows.Account.find(a=>a.id==='cash').balance,100000);assert.equal(f.rows.Account.find(a=>a.id==='ar').balance,2000);
 assert.deepEqual(f.rows.StockMovement,before);assert.equal(f.rows.StockBalance[0].quantity,6);assert.equal(f.rows.JournalEntry.length,1);
 assert.equal(f.rows.AuditLog[0].posted_sale_edit_before.invoice.payment_type,'cash');assert.equal(result.balance,2000);
 const after=structuredClone(f.rows);assert.equal((await e.post()).reused,true);assert.deepEqual(f.rows,after);
});
test('a credit invoice can be corrected to paid cash once',async()=>{
 const f=postedSaleFixture(),e=await edit(f,{paymentType:'cash'});await e.post();
 assert.equal(f.rows.Invoice[0].balance,0);assert.equal(f.rows.Invoice[0].amount_paid,2000);assert.equal(f.rows.Customer[0].balance,0);
 assert.equal(f.rows.TreasuryAccount[0].balance,102000);assert.equal(f.rows.TreasuryTransaction.length,1);assert.equal(f.rows.Account.find(a=>a.id==='ar').balance,0);
 assert.equal((await e.post()).reused,true);assert.equal(f.rows.TreasuryTransaction.length,1);
});
test('reducing posted credit quantities restores original lot value and reduces receivables and COGS',async()=>{
 const f=postedSaleFixture(),e=await edit(f,{lines:line(2)});await e.post();
 assert.equal(f.rows.Invoice[0].total,1000);assert.equal(f.rows.InvoiceLine[0].quantity,2);assert.equal(f.rows.SalesOrderLine[0].quantity,2);
 assert.equal(f.rows.Customer[0].balance,1000);assert.equal(f.rows.StockBalance[0].quantity,8);assert.equal(f.rows.StockBalance[0].total_value,1600);
 assert.equal(f.rows.Account.find(a=>a.id==='cogs').balance,400);assert.equal(f.rows.Account.find(a=>a.id==='inventory').balance,1600);
 assert.equal(f.rows.StockMovement[0].quantity,4);assert.equal(f.rows.StockMovement.at(-1).movement_type,'customer_return');
 assert.equal(f.rows.Invoice[0].posted_sale_stock_layers[0].quantity,2);
});
test('increasing a cash sale consumes only the additional units and updates the actual receipt delta',async()=>{
 const f=postedSaleFixture({cash:true}),e=await edit(f,{lines:line(7)});await e.post();
 assert.equal(f.rows.Invoice[0].total,3500);assert.equal(f.rows.Invoice[0].amount_paid,3500);assert.equal(f.rows.StockBalance[0].quantity,3);
 assert.equal(f.rows.StockBalance[0].total_value,600);assert.equal(f.rows.TreasuryAccount[0].balance,103500);assert.equal(f.rows.TreasuryTransaction[0].amount,3500);
 assert.equal(f.rows.Account.find(a=>a.id==='cogs').balance,1400);assert.equal(f.rows.Customer[0].balance,0);
});
test('combined payment, quantity and branch correction keeps the invoice and moves the debt to that branch',async()=>{
 const f=postedSaleFixture({cash:true});await f.stores.Customer.create({id:'branch',business_name:'Customer A Jouvence',parent_id:'c1',is_active:true,balance:0});
 const e=await edit(f,{paymentType:'credit',customerId:'branch',locationId:'branch',lines:line(3)});await e.post();
 assert.equal(f.rows.Invoice[0].customer_id,'branch');assert.equal(f.rows.Invoice[0].balance,1500);assert.equal(f.rows.Customer.find(c=>c.id==='branch').balance,1500);
 assert.equal(f.rows.Customer[0].balance,0);assert.equal(f.rows.TreasuryAccount[0].balance,100000);assert.equal(f.rows.Invoice[0].invoice_number,'INV-TEST');
 assert.equal(f.rows.Invoice[0].invoice_document.options.bill_to_name,'Customer A Jouvence');
});
test('a later edit uses effective stock layers and does not return the original quantities twice',async()=>{
 const f=postedSaleFixture();await (await edit(f,{lines:line(2)})).post();await (await edit(f,{lines:line(3)})).post();
 assert.equal(f.rows.InvoiceLine[0].quantity,3);assert.equal(f.rows.StockBalance[0].quantity,7);assert.equal(f.rows.StockBalance[0].total_value,1400);
 assert.equal(f.rows.InvoiceLine[0].cogs_total,600);assert.equal(f.rows.Invoice[0].posted_sale_stock_layers.reduce((n,l)=>n+l.quantity,0),3);
});
test('allocated receipts are preserved while a valid credit quantity correction changes only the remaining balance',async()=>{
 const f=postedSaleFixture();await f.stores.Payment.create({id:'payment',status:'posted',party_id:'c1',amount:500});
 await f.stores.PaymentAllocation.create({id:'allocation',payment_id:'payment',document_id:'invoice',amount:500});
 await f.stores.Invoice.update('invoice',{amount_paid:500,balance:1500});await f.stores.Customer.update('c1',{balance:1500});await f.stores.Account.update('ar',{balance:1500});
 const before=structuredClone([f.rows.Payment,f.rows.PaymentAllocation]);await (await edit(f,{lines:line(3)})).post();
 assert.equal(f.rows.Invoice[0].amount_paid,500);assert.equal(f.rows.Invoice[0].balance,1000);assert.equal(f.rows.Customer[0].balance,1000);
 assert.deepEqual([f.rows.Payment,f.rows.PaymentAllocation],before);
});
test('stock shortages, zeroing every line and unsupported quantity precision cannot save a correction',async()=>{
 for(const q of [11,0,-1,0.0001,'']){
  const f=postedSaleFixture(),before=structuredClone(f.rows);await assert.rejects(edit(f,{lines:line(q)}));assert.deepEqual(f.rows,before);
 }
});
test('expired stock is excluded when a posted quantity is increased',async()=>{
 const f=postedSaleFixture();await f.stores.StockBalance.update('stock',{expiry_date:'2020-01-01'});const before=structuredClone(f.rows);
 await assert.rejects(edit(f,{lines:line(5)}),/Insufficient/);assert.deepEqual(f.rows,before);
});
test('a stale stock or accounting snapshot rejects confirmation before any edit is posted',async()=>{
 const f=postedSaleFixture(),e=await edit(f,{lines:line(3)});await f.stores.Account.update('ar',{balance:2100});const before=structuredClone(f.rows);
 await assert.rejects(e.post(),/Reload/);assert.deepEqual(f.rows,before);
});
test('another commercial agent cannot edit a sale they did not record',async()=>{
 const f=postedSaleFixture({userId:'other-user',role:'commercial'}),before=structuredClone(f.rows);await assert.rejects(edit(f,{lines:line(3)}),/only sales/);assert.deepEqual(f.rows,before);
});
test('closed periods and pending receipts block changes without altering the original transaction',async()=>{
 for(const mode of ['closed','pending']){
 const f=postedSaleFixture();
 if(mode==='closed')await f.stores.AccountingPeriod.update('period',{status:'closed'});
 else await f.stores.Payment.create({id:'pending',party_id:'c1',payment_type:'customer_payment',status:'approved',receipt_allocations:[{invoice_id:'invoice',amount:100}]});
 const before=structuredClone(f.rows);await assert.rejects(edit(f,{lines:line(3)}));assert.deepEqual(f.rows,before);
 }
});
test('the posted journal remains balanced and its payload reconciles after payment and quantity edits',async()=>{
 const f=postedSaleFixture({cash:true});await (await edit(f,{paymentType:'credit',lines:line(3)})).post();
 const journal=f.rows.JournalEntry[0],lines=f.rows.JournalLine;
 assert.equal(lines.reduce((n,l)=>n+l.debit,0),journal.total_debit);assert.equal(lines.reduce((n,l)=>n+l.credit,0),journal.total_credit);assert.equal(journal.total_debit,journal.total_credit);
 const workspace=await call(f,{action:'postedSaleEditWorkspace'});assert.equal(workspace.total,1500);
});

test('a posted credit Commercial sale updates its source and linked invoice quantities together',async()=>{
 const f=postedFieldFixture(),e=await edit(f,{lines:[{line_id:'field-line',quantity:2}]});await e.post();
 assert.equal(f.rows.FieldSale[0].total,1000);assert.equal(f.rows.FieldSale[0].amount_due,1000);assert.equal(f.rows.FieldSaleLine[0].quantity,2);assert.equal(f.rows.InvoiceLine[0].quantity,2);
 assert.equal(f.rows.FieldSaleLine[0].line_cost,400);assert.equal(f.rows.StockBalance[0].quantity,8);assert.equal(f.rows.Customer[0].balance,1000);
});
test('a posted Commercial cash mistake can become credit before cash has entered a handover',async()=>{
 const f=postedFieldFixture({cash:true}),e=await edit(f,{paymentType:'credit',lines:[{line_id:'field-line',quantity:4}]});await e.post();
 assert.equal(f.rows.FieldSale[0].amount_collected,0);assert.equal(f.rows.FieldSale[0].amount_due,2000);assert.equal(f.rows.Invoice[0].balance,2000);
 assert.equal(f.rows.CashCollection[0].amount_collected,0);assert.equal(f.rows.CashCollection[0].status,'cancelled');assert.equal(f.rows.Account.find(a=>a.id==='clearing').balance,0);
 assert.equal(f.rows.TreasuryAccount[0].balance,100000);
});
test('Commercial cash already received in a handover cannot be silently removed by editing the sale',async()=>{
 const f=postedFieldFixture({cash:true});await f.stores.CashCollection.update('collection',{status:'received',received_amount:2000,outstanding_amount:0,handover_id:'handover'});
 const before=structuredClone(f.rows);await assert.rejects(edit(f,{paymentType:'credit',lines:[{line_id:'field-line',quantity:4}]}),/handover/);assert.deepEqual(f.rows,before);
});
test('a posted Commercial sale without an invoice can be edited without generating a duplicate invoice',async()=>{
 const f=postedFieldFixture({invoiced:false});
 const body={fieldSaleId:'field',paymentType:'credit',customerId:'c1',locationId:'',reference:'R-1',reason:'Physical receipt quantity verified',lines:[{line_id:'field-line',quantity:3}]};
 const review=await postedSaleEditAction(f.client,f.user,{...body,action:'previewPostedSaleEdit'});
 await postedSaleEditAction(f.client,f.user,{...body,action:'savePostedSaleEdit',requestKey:randomUUID(),fingerprint:review.fingerprint,confirmed:true});
 assert.equal(f.rows.Invoice.length,0);assert.equal(f.rows.FieldSale[0].total,1500);assert.equal(f.rows.FieldSaleLine[0].quantity,3);assert.equal(f.rows.StockBalance[0].quantity,7);
});

test('older correction layer snapshots retain nested production provenance when quantities are restored',async()=>{
 const f=postedSaleFixture(),raw=structuredClone(f.rows.StockMovement);
 for(const row of raw){row.extra_data={production_order_id:row.production_order_id};delete row.production_order_id;}
 await f.stores.Invoice.update('invoice',{posted_sale_edit:{version:1,revision:1,id:'earlier-correction',stock_layers:raw}});
 await (await edit(f,{lines:line(2)})).post();
 assert.equal(f.rows.StockBalance.length,1);assert.equal(f.rows.StockBalance[0].quantity,8);assert.equal(f.rows.StockBalance[0].production_order_id,'batch-1');
});
test('an earlier fully reversed cash receipt is retained as history and is not collected again',async()=>{
 const f=postedSaleFixture();
 await f.stores.TreasuryTransaction.create({id:'old-receipt',source:'cash_sale',source_document_id:'invoice',amount:2000,reversed_by_sale_edit:'earlier-correction'});
 await f.stores.TreasuryTransaction.create({id:'old-reversal',source:'sale_correction',source_document_id:'earlier-correction',transaction_type:'expense',amount:2000});
 await (await edit(f,{paymentType:'cash'})).post();
 assert.equal(f.rows.TreasuryAccount[0].balance,102000);assert.equal(f.rows.TreasuryTransaction.find(t=>t.id==='old-receipt').amount,2000);
 assert.equal(f.rows.TreasuryTransaction.filter(t=>t.source==='cash_sale'&&!t.reversed_by_sale_edit).length,1);
});

test('a Commercial cash billing-branch edit keeps its held collection attributed to the corrected customer',async()=>{
 for(const received of [0,2000]){
 const f=postedFieldFixture({cash:true});Object.assign(f.rows.CashCollection[0],{received_amount:received,outstanding_amount:2000-received,status:received?'received':'held_by_commercial'});
 await f.stores.Customer.create({id:'branch',business_name:'Customer A Jouvence',parent_id:'c1',is_active:true,balance:0});
 const e=await edit(f,{invoiceId:undefined,fieldSaleId:'field',customerId:'branch',locationId:'branch'});await e.post();
 assert.equal(f.rows.CashCollection[0].customer_id,'branch');assert.equal(f.rows.CashCollection[0].amount_collected,2000);assert.equal(f.rows.CashCollection[0].outstanding_amount,2000-received);
 assert.equal(f.rows.CashCollection[0].status,received?'received':'held_by_commercial');assert.equal(f.rows.TreasuryAccount[0].balance,100000);
 }
});

test('a later reversal reviews only the corrected quantities and costs while preserving the original stock issue',async()=>{
 const f=postedSaleFixture();await (await edit(f,{lines:line(2)})).post();
 const review=await saleReversalAction(f.client,f.user,{action:'previewSaleReversal',invoiceId:'invoice'});
 assert.equal(review.can_restore_stock,true);assert.equal(review.items[0].quantity,2);assert.equal(review.retained_cost_review.amount,400);
 assert.equal(f.rows.StockMovement[0].quantity,4);assert.equal(f.rows.Invoice[0].posted_sale_stock_layers[0].quantity,2);
});
