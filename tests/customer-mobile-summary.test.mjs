import test from 'node:test';
import assert from 'node:assert/strict';
import {customerInvoiceQuery,customerMonthInvoiceQuery} from '../src/lib/customer-mobile-summary.js';

test('mobile invoice summary includes only posted commercial invoices and excludes opening balances',()=>{
  const query=customerInvoiceQuery('customer-a');
  assert.equal(query.customer_id,'customer-a');
  assert.deepEqual(query.accounting_source,{$ne:'opening_balances'});
  assert.deepEqual(query.status.$in,['posted','partially_paid','paid','overdue']);
  for(const status of ['draft','cancelled','credited','void'])assert.equal(query.status.$in.includes(status),false);
});

test('mobile monthly totals cover the complete calendar month, including year rollover',()=>{
  assert.deepEqual(customerMonthInvoiceQuery('c',new Date('2026-12-31T23:59:59Z')).invoice_date,{$gte:'2026-12-01',$lt:'2027-01-01'});
  assert.deepEqual(customerMonthInvoiceQuery('c',new Date('2028-02-29T12:00:00Z')).invoice_date,{$gte:'2028-02-01',$lt:'2028-03-01'});
});
