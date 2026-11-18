import test from 'node:test';
import assert from 'node:assert/strict';
import {customerStockHistory} from '../src/lib/customer-stock-history.js';

test('customer delivery history reads every page and includes the exact headquarters-billed branch scope',async()=>{
 const calls=[];const entities={
  SalesOrder:{filter:async(query,options)=>{calls.push({entity:'orders',query,options});return options.cursor?{items:[{id:'second',status:'invoiced'}],has_more:false}:{items:[{id:'first',status:'delivered'},{id:'draft',status:'draft'}],has_more:true,next_cursor:'next'};}},
  SalesOrderLine:{filter:async(query)=>{assert.deepEqual(query.order_id.$in,['first','second']);return [{product_id:'p',product_name:'Yogurt',quantity:10,lot_number:'A'},{product_id:'p',product_name:'Yogurt',quantity:5,lot_number:'B'}];}},
  SpoilageRecord:{filter:async()=>[{product_id:'p',quantity:1}]},
  StockMovement:{filter:async(query)=>{assert.equal(query.movement_type,'customer_return');return [{product_id:'p',quantity:2}];}},
  StockBalance:{filter:async()=>[{lot_number:'A',expiry_date:'2026-12-01'},{lot_number:'B',expiry_date:'2026-11-20'}]},
 };
 const [row]=await customerStockHistory(entities,{customerId:'branch',headquartersId:'parent',date:'2026-11-18'});
 assert.deepEqual(calls[0].query,{$or:[{customer_id:'branch'},{customer_id:'parent',location_id:'branch'}]});
 assert.equal(calls.length,2);assert.equal(row.delivered,15);assert.equal(row.stillWith,12);assert.equal(row.earliest,'2026-11-20');assert.equal(row.days,2);
});
test('an incomplete history fails rather than presenting a partial quantity as a valid stock balance',async()=>{
 const entities={SalesOrder:{filter:async()=>({items:[],has_more:true})}};
 await assert.rejects(customerStockHistory(entities,{customerId:'c'}),/Some records could not be loaded/);
});
