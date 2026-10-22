import test from 'node:test';
import assert from 'node:assert/strict';
import { companySalesRegister } from '../src/lib/company-sales.js';
import { companySalesAction } from '../src/server/domain/company-sales.js';

const from = '2026-10-01', to = '2026-10-18';
test('Supply Chain sales reporting is an explicit read-only grant and revoked or inactive staff cannot use it',async()=>{
  const reads=[],writes=[],staff={id:'supply',role:'supply_chain_manager',access_template:'warehouse_manager',status:'active',allowed_modules:['inventory','sales_reports']};
  const client={auth:{staff:async()=>staff,assertModule:module=>{assert.ok(staff.allowed_modules.includes(module));}},asServiceRole:{entities:new Proxy({},{get:(_,entity)=>({filter:async query=>{reads.push([entity,query]);return [];},create:async value=>writes.push(value),update:async value=>writes.push(value)})})}};
  const result=await companySalesAction(client,{id:'login',role:'user'},{from,to,employeeId:'forged',role:'admin'});
  assert.equal(result.totals.count,0);assert.equal(reads.length,2);assert.equal(writes.length,0);
  staff.allowed_modules=['inventory'];await assert.rejects(companySalesAction(client,{id:'login',role:'user'},{from,to}),/restricted/);assert.equal(reads.length,2);
  staff.allowed_modules=['sales_reports'];staff.status='inactive';await assert.rejects(companySalesAction(client,{id:'login',role:'user'},{from,to}),/active/);assert.equal(reads.length,2);
});
test('company Sales combines posted journal-backed documents and excludes drafts, review reports, exchanges and out-of-period records', () => {
  const invoice = { id: 'i', invoice_number: 'INV-1', invoice_date: to, status: 'posted', journal_id: 'journal-i', subtotal: 1000, tax_total: 192.5, total: 1192.5, balance: 1192.5 };
  const field = { id: 'f', sale_number: 'FS-1', transaction_date: to, status: 'approved_posted', journal_id: 'journal-f', commercial_name: 'Agent', customer_name: 'Customer', subtotal: 500, tax_total: 0, total: 500, receipt_file_uris: ['private/proof'] };
  const result = companySalesRegister({ from, to, invoices: [invoice, { ...invoice, id: 'draft', status: 'draft' }, { ...invoice, id: 'bad', journal_id: '' }], fieldSales: [field, { ...field, id: 'review', status: 'submitted' }, { ...field, id: 'draft', status: 'draft' }, { ...field, id: 'old', transaction_date: '2026-09-30' }, { ...field, id: 'future', transaction_date: '2026-10-19' }, { ...field, id: 'no-journal', journal_id: '' }, { ...field, id: 'return', status: 'replaced' }] });
  assert.equal(result.rows.length, 2); assert.deepEqual(result.totals, { count: 2, net: 1500, tax: 192.5, sales: 1692.5 });
  const supply = result.rows.find(row => row.source === 'Commercial supply');
  assert.equal(supply.receipt_count, 1); assert.equal(supply.receipt_file_uris, undefined); assert.equal(supply.journal_id, undefined);
});

test('company Sales is read-only and refuses field staff before any company table access', async () => {
  const reads = [];
  const stores = { Invoice: { filter: async query => { reads.push(['Invoice', query]); return []; } }, FieldSale: { filter: async query => { reads.push(['FieldSale', query]); return []; } } };
  const client = role => ({ entities: { Employee: { filter: async () => role === 'admin' ? [] : [{ id: 'staff', role, status: 'active' }] } }, asServiceRole: { entities: stores } });
  for (const role of ['commercial', 'driver', 'hotesse', 'cashier']) await assert.rejects(companySalesAction(client(role), { id: 'login', role: 'user' }, { from, to }), /restricted/);
  assert.equal(reads.length, 0);
  for (const role of ['admin', 'employee', 'production_manager']) {
    const result = await companySalesAction(client(role), { id: 'login', role: role === 'admin' ? 'admin' : 'user' }, { from, to });
    assert.equal(result.totals.count, 0);
  }
  assert.equal(reads.length, 6); assert.equal(reads[1][1].status, 'approved_posted');
  await assert.rejects(companySalesAction(client('admin'), { id: 'gm', role: 'admin' }, { from: '2025-01-01', to }), /one year/);
});
