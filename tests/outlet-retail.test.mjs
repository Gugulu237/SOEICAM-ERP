import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,date,fieldHandler,request} from './helpers/commercial-supply.mjs';
import {outletAction,hotesseData} from '../src/server/domain/outlet-workspace.js';
import {outletStockSnapshot} from '../src/server/domain/outlet-stock.js';
import {validateOutletDailyReport} from '../src/server/domain/outlet-rules.js';
import {guardMutation} from '../src/server/access.js';
function setup(){const f=fixture();const employee={id:'host',role:'hotesse',status:'active',full_name:'Host'},user={id:'host-login',role:'user'},location={id:'outlet',customer_id:'customer-a',name:'Shop',assigned_hotesse_ids:['host'],is_active:true};f.tables.Employee.push(employee);f.tables.CustomerLocation.push(location);f.tables.FieldSale.push({id:'supply',status:'approved_posted',transaction_date:date,customer_id:'customer-a',location_id:'outlet'});f.tables.FieldSaleLine.push({id:'line-first',field_sale_id:'supply',product_id:'product-a',quantity:20,unit:'ea'});f.client.entities.Employee.filter=async()=>[employee];f.client.auth.me=async()=>user;
 const snapshot=(day=date)=>outletStockSnapshot(location,day,{products:f.tables.Product,fieldSales:f.tables.FieldSale,fieldLines:f.tables.FieldSaleLine,reports:f.tables.OutletVisit});
 const body=q=>({action:'recordOutletRetailSale',locationId:'outlet',productId:'product-a',quantity:q,requestKey:crypto.randomUUID(),snapshotKey:snapshot().snapshot_key});
 return {...f,employee,user,location,snapshot,body,act:body=>outletAction(f.client,user,body)};}
test('successive retail updates reduce remaining units, retry once, and leave accounting and company stock untouched',async()=>{
 const f=setup(),before=structuredClone(f.tables),input=f.body(3),handler=await fieldHandler();globalThis.__dailySupplyClient=f.client;
 try{const response=await handler(request(input)),first=await response.json();assert.equal(response.status,200,first.error);assert.equal(first.report.informational_only,true);assert.equal(first.report.lines[0].quantity,17);
 const retry=await f.act(input);assert.equal(retry.reused,true);assert.equal(f.tables.OutletVisit.length,1);await assert.rejects(f.act({...input,quantity:4}),/different sales details/);
 await f.act(f.body(2));const stock=f.snapshot();assert.equal(stock.products[0].display_quantity,15);assert.equal(stock.products[0].today_sold_quantity,5);assert.equal(stock.products[0].opening_quantity,20);assert.equal(stock.products[0].last_count_at,null,'A sale update is not a physical shelf count');
 const data=await hotesseData(f.client.asServiceRole,'host',date);assert.equal(data.outletProducts.outlet[0].today_sold_quantity,5);assert.equal(data.reports.length,2);
 for(const name of Object.keys(before).filter(n=>n!=='OutletVisit'))assert.deepEqual(f.tables[name],before[name],name+' remains unchanged');
 }finally{delete globalThis.__dailySupplyClient;}
});
test('outlet updates reject stale snapshots, over-selling, foreign outlets, spoofed products and inactive staff',async()=>{
 const f=setup(),stale=f.body(1);await f.act(f.body(2));await assert.rejects(f.act(stale),/stock changed/);
 for(const change of [{quantity:19},{quantity:0},{quantity:NaN},{quantity:true},{productId:'unknown'},{locationId:'elsewhere'},{snapshotKey:''}])await assert.rejects(f.act({...f.body(1),...change}));
 f.employee.status='inactive';await assert.rejects(f.act(f.body(1)),/active/i);assert.equal(f.tables.OutletVisit.length,1);
 await assert.rejects(outletAction(f.client,{id:'gm',role:'admin'},f.body(1)),/assigned Hotesse/);
 assert.throws(()=>guardMutation({role:'admin',user:{id:'gm',role:'admin'},employee:null},'OutletVisit','update',{lines:[]},{id:'event',report_type:'retail_sale'}),/reporting workflow/);
});
test('same-millisecond reports remain ordered, deliveries add stock, and closing totals never count retail updates twice',async()=>{
 const f=setup();await f.act(f.body(3));await f.act(f.body(2));f.tables.OutletVisit.forEach(r=>r.recorded_at=date+'T10:00:00.000Z');
 assert.equal(f.snapshot().products[0].display_quantity,15);
 f.tables.FieldSale.push({id:'later',status:'approved_posted',transaction_date:date,customer_id:'customer-a',location_id:'outlet'});f.tables.FieldSaleLine.push({id:'line-later',field_sale_id:'later',product_id:'product-a',quantity:4,unit:'ea'});
 let stock=f.snapshot();assert.equal(stock.products[0].display_quantity,19);assert.equal(stock.products[0].opening_quantity,24);
 const daily={action:'submitOutletVisit',locationId:'outlet',snapshotKey:stock.snapshot_key,requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',sold_quantity:5,damaged_quantity:0,quantity:19}]};
 assert.throws(()=>validateOutletDailyReport({...daily,lines:[{...daily.lines[0],sold_quantity:4}]},f.location,f.employee,stock),/lower than/);
 await f.act(daily);stock=f.snapshot();assert.equal(stock.products[0].display_quantity,19);assert.equal(stock.products[0].today_sold_quantity,5);assert.equal(stock.daily_report_submitted,true);await assert.rejects(f.act(f.body(1)),/closing report/);
 const tomorrow=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);assert.equal(f.snapshot(tomorrow).products[0].opening_quantity,19);assert.equal(f.snapshot(tomorrow).products[0].today_sold_quantity,0);
});
