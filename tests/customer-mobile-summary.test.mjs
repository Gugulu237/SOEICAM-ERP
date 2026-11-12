import test from 'node:test';
import assert from 'node:assert/strict';
import {customerInvoiceQuery,customerMonthInvoiceQuery} from '../src/lib/customer-mobile-summary.js';
import {customerAccountBalance,customerGroupBalance,customerOpenInvoiceQuery,headquartersDeliveryBalanceQuery} from '../src/lib/customer-billing-summary.js';
import {whereClause} from '../src/server/query.js';

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

test('group balance counts headquarters and visible direct branch accounts once',()=>{
  const headquarters={id:'hq',balance:'12340'};
  const east={id:'east',parent_id:'hq',balance:2350};
  const west={id:'west',parent_id:'hq',balance:'3650.01'};
  assert.equal(customerAccountBalance(east),2350);
  assert.equal(customerGroupBalance(headquarters,[east,east,west,{id:'other',parent_id:'elsewhere',balance:999}]),18340.01);
  assert.equal(customerGroupBalance(headquarters,[east,{...west,balance:null}]),null);
  assert.equal(customerAccountBalance({balance:''}),null);
});

test('headquarters delivery debt uses the saved billing account and exact branch location',()=>{
  const hq={id:'hq',financial_centralization_mode:'decentralized'};
  const branch={id:'east',parent_id:'hq'};
  const branchInvoiceQuery=headquartersDeliveryBalanceQuery(branch,hq);
  assert.deepEqual(branchInvoiceQuery,{
    customer_id:'hq',location_id:'east',accounting_source:{$ne:'opening_balances'},opening_batch_id:{$in:['',null]},
    status:{$in:['posted','partially_paid','overdue']},balance:{$gt:0},payment_type:{$ne:'cash'},
  });
  assert.equal(headquartersDeliveryBalanceQuery(branch,{id:'unrelated'}),null);
  assert.equal(headquartersDeliveryBalanceQuery(branch,{...hq,parent_id:'another-parent'}),null);
  assert.equal(headquartersDeliveryBalanceQuery(branch,null),null);
  const params=[];
  const sql=whereClause(branchInvoiceQuery,{fields:{customer_id:{},location_id:{},payment_type:{}}},params);
  assert.match(sql,/"customer_id" = \$1/);
  const locationParameter=sql.match(/"location_id" = \$(\d+)/);
  assert.ok(locationParameter);
  assert.match(sql,/"payment_type" IS DISTINCT FROM/);
  assert.match(sql,/IS NULL/);
  assert.equal(params[0],'hq');
  assert.equal(params[Number(locationParameter[1])-1],'east');
  assert.equal(customerOpenInvoiceQuery('east').opening_batch_id,undefined);
});
