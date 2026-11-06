import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { fixture, functionRoute, request, date } from './helpers/cashier.mjs';
import { distributionControlAction } from '../src/server/domain/distribution-control.js';
import { employeeStockAction } from '../src/server/domain/employee-stock.js';
import { dispatchAction, dispatchReconciliationData } from '../src/server/domain/dispatch-operations.js';
import { currentSupplyRun, assertRunSupplyStock } from '../src/server/domain/commercial-runs.js';
import { salesSourceProducts } from '../src/server/domain/sales-stock-source.js';
import { isReadOnlyFunction } from '../src/lib/function-actions.js';
import catalog from '../src/server/generated/schema.json' with { type: 'json' };
import { splitRecord } from '../src/server/query.js';
const gm = { id: 'gm', role: 'admin' };
async function setup(db, { allocated = 2, total = 7, vehicle = false } = {}) {
  const f = await fixture(db), s = f.entities;
  for (const name of ['DispatchRequest', 'Dispatch']) { const create = s[name].create; s[name].create = async value => { const { record, extra } = splitRecord(value, catalog[name], { creating: true }); return create({ ...record, ...extra }); }; }
  for (const name of ['Warehouse', 'AuditLog']) { const create = s[name].create; s[name].create = async value => { if (!value.id) return create(value); const row = { ...value }; if (db) await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)', [name, row.id, JSON.stringify(row)]); else f.rows[name].push(row); return structuredClone(row); }; }
  await s.CompanySettings.update('settings', { company_name: 'SOEICAM', next_invoice_number: 1 });
  await s.Employee.update('cashier', { role: 'employee' });
  await s.Dispatch.deleteMany({}); await s.DispatchLine.deleteMany({}); await s.Warehouse.update('factory', { warehouse_type: 'finished_goods' });
  for (const b of await s.StockBalance.list()) await s.StockBalance.update(b.id, { quantity: 0, total_value: 0 });
  await s.StockBalance.create({ warehouse_id: 'factory', product_id: 'product-a', quantity: 20, unit_cost: 200, total_value: 4000, lot_number: 'LOT', qc_status: 'approved' });
  const inventoryRule=(await s.PostingRule.filter({rule_key:'finished_goods_inventory'}))[0];await s.Account.update(inventoryRule.account_id,{account_type:'asset'});
  await s.PostingRule.create({ rule_key: 'marketing_degustation_expense', account_id: 'expense', is_active: true });
  const actor = { id: 'cashier-login', role: 'user' };
  const issueBody = { action: 'issueDistributionStock', commercialId: 'cashier', driverId: '', vehicleId: vehicle ? 'vehicle-a' : '', warehouseId: 'factory', requestKey: crypto.randomUUID(), date, lines: [{ product_id: 'product-a', quantity: total, degustation_quantity: allocated }] };
  const issue = () => distributionControlAction(f.client, gm, issueBody);
  const give = dispatchId => ({ action: 'recordDegustation', requestKey: crypto.randomUUID(), date, dispatchId, customerId: 'customer-a', lines: [{ product_id: 'product-a', quantity: 1 }], notes: 'Customer tasting' });
  return { ...f, s, actor, issueBody, issue, give };
}
async function count(f, warehouse) { return (await f.s.StockBalance.filter({ warehouse_id: warehouse })).reduce((n, b) => n + b.quantity, 0); }

test('mixed sale and Dégustation load: reserve, give at cost, sell, return unused allocation and reconcile', async () => {
  const f = await setup(), { dispatch } = await f.issue();
  assert.equal((await f.issue()).dispatch.id, dispatch.id);
  assert.equal((await f.s.JournalEntry.list()).length, 0);
  let workspace = await employeeStockAction(f.client, f.actor, { action: 'employeeStockWorkspace' });
  assert.equal(workspace.balances.reduce((n,b)=>n+b.usable_quantity,0), 5);
  assert.equal(workspace.balances.reduce((n,b)=>n+b.degustation_quantity,0), 2);
  const source = await currentSupplyRun(f.client.asServiceRole, 'cashier', dispatch.id, date, true);
  await assert.rejects(assertRunSupplyStock(f.client.asServiceRole, source, [{ product_id: 'product-a', quantity: 6 }]), /exceeds/);
  const catalog = await salesSourceProducts(f.client.asServiceRole, source); assert.equal(catalog.find(p=>p.id==='product-a').available,5);
  const input = f.give(dispatch.id), result = await employeeStockAction(f.client, f.actor, input);
  assert.equal((await employeeStockAction(f.client, f.actor, input)).reused, true);
  assert.equal((await f.s.JournalEntry.list()).length,1);
  assert.equal((await f.s.JournalLine.list()).find(l=>l.account_id==='expense').debit,200);
  assert.equal((await f.s.JournalLine.list()).reduce((n,l)=>n+l.debit-l.credit,0),0);
  assert.equal((await f.s.Invoice.list()).length,0); assert.equal((await f.s.SalesOrder.list()).length,0);
  assert.equal((await f.s.Customer.get('customer-a')).balance,0);
  assert.equal(result.record.cost,undefined); assert.equal(result.record.employee_name,'Cashier');
  const sale = { action: 'employeeRecordSupply', requestKey: crypto.randomUUID(), sourceType:'issued', dispatchId:dispatch.id, customerId:'customer-a', date, paymentType:'cash', receiptReference:'SALE-001', expectedTotal:2500, lines:[{product_id:'product-a',quantity:5,unit_price:500}] };
  await employeeStockAction(f.client,f.actor,sale);
  let recon = await dispatchReconciliationData(f.client.asServiceRole,await f.s.Dispatch.get(dispatch.id));
  assert.equal(recon.hasVariance,false); assert.equal(recon.rows[0].sold,5); assert.equal(recon.rows[0].degustation_given,1); assert.equal(recon.rows[0].degustation_remaining,1); assert.equal(recon.rows[0].actual,1); assert.equal(recon.totalSales,2500); assert.equal(recon.degustationCost,200);
  await dispatchAction(f.client,gm,{action:'returnDispatchStock',dispatchId:dispatch.id,countedLines:[{product_id:'product-a',quantity:1}]});
  recon = await dispatchReconciliationData(f.client.asServiceRole,await f.s.Dispatch.get(dispatch.id));
  assert.equal(recon.hasVariance,false); assert.equal(recon.rows[0].degustation_returned,1); assert.equal(recon.rows[0].degustation_remaining,0);
  assert.equal(await count(f,'factory'),14); assert.equal((await f.s.JournalEntry.list()).length,2);
  await distributionControlAction(f.client,gm,{action:'closeDistributionRun',dispatchId:dispatch.id});
  assert.equal((await employeeStockAction(f.client,f.actor,input)).reused,true);
  await assert.rejects(employeeStockAction(f.client,f.actor,{...input,requestKey:crypto.randomUUID()}),/load|assigned/);
  workspace = await employeeStockAction(f.client,f.actor,{action:'employeeStockWorkspace'}); assert.equal(workspace.degustations.length,1); assert.equal(workspace.degustations[0].cost,undefined);
});

test('giveaway-only load works with or without a vehicle and creates no revenue, debt or cash', async () => {
  for (const vehicle of [false,true]) {
    const f = await setup(undefined,{allocated:3,total:3,vehicle}), {dispatch} = await f.issue();
    const before = Object.fromEntries(await Promise.all(['CashCollection','TreasuryTransaction','Invoice','SalesOrder','FieldSale'].map(async n=>[n,await f.s[n].list()])));
    const workspace = await employeeStockAction(f.client,f.actor,{action:'degustationWorkspace'});
    assert.equal(workspace.balances[0].usable_quantity,0); assert.equal(workspace.balances[0].degustation_quantity,3); assert.ok(workspace.products.length);
    await employeeStockAction(f.client,f.actor,{...f.give(dispatch.id),lines:[{product_id:'product-a',quantity:3}]});
    assert.equal(await count(f,dispatch.vehicle_warehouse_id),0);
    for(const [name,rows] of Object.entries(before))assert.deepEqual(await f.s[name].list(),rows);
    const journal = (await f.s.JournalEntry.list())[0]; assert.equal(journal.total_debit,600); assert.equal(journal.total_credit,600); assert.equal(journal.source_module,'degustation');
    const recon = await dispatchReconciliationData(f.client.asServiceRole,dispatch);assert.equal(recon.hasVariance,false);assert.equal(recon.totalSales,0);assert.equal(recon.cashSales,0);assert.equal(recon.degustationCost,600);
  }
});

test('forged quantities, spending sale stock, changed retries and other employees are rejected',async()=>{
  const f=await setup(),{dispatch}=await f.issue(),input=f.give(dispatch.id);
  for(const quantity of [0,-1,NaN,Infinity,true,null,'',0.0001,3])await assert.rejects(employeeStockAction(f.client,f.actor,{...input,lines:[{product_id:'product-a',quantity}]}));
  await assert.rejects(employeeStockAction(f.client,f.actor,{...input,lines:[...input.lines,...input.lines]}),/distinct/);
  await assert.rejects(employeeStockAction(f.client,f.actor,{...input,customerId:'missing'}),/customer/);
  await assert.rejects(employeeStockAction(f.client,f.actor,{...input,dispatchId:'other'}),/assigned/);
  await employeeStockAction(f.client,f.actor,input);
  await assert.rejects(employeeStockAction(f.client,f.actor,{...input,notes:'changed'}),/different details/);
  await assert.rejects(employeeStockAction(f.client,f.actor,{...input,requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity:2}]}),/exceeds/);
  await f.s.Employee.update('cashier',{role:'hotesse'});await assert.rejects(employeeStockAction(f.client,f.actor,{...input,requestKey:crypto.randomUUID()}),/Not permitted/);
  assert.equal(isReadOnlyFunction('fieldOps','recordDegustation'),false);assert.equal(isReadOnlyFunction('fieldOps','degustationWorkspace'),true);
  const g=await setup();g.issueBody.lines[0].degustation_quantity=8;await assert.rejects(g.issue(),/cannot exceed/);assert.equal((await g.s.StockMovement.list()).length,0);
});

test('marketing account setup and saleable lot checks block invalid giveaway posting',async()=>{
  for(const kind of ['missing','inactive','wrong-type','expired','quarantine']){
    const f=await setup(),{dispatch}=await f.issue();
    if(kind==='missing')await f.s.PostingRule.deleteMany({rule_key:'marketing_degustation_expense'});
    if(kind==='inactive')await f.s.Account.update('expense',{is_active:false});
    if(kind==='wrong-type')await f.s.Account.update('expense',{account_type:'revenue'});
    if(kind==='expired'||kind==='quarantine')for(const b of await f.s.StockBalance.filter({warehouse_id:dispatch.vehicle_warehouse_id}))await f.s.StockBalance.update(b.id,kind==='expired'?{expiry_date:'2000-01-01'}:{qc_status:'quarantine'});
    await assert.rejects(employeeStockAction(f.client,f.actor,f.give(dispatch.id)),/posting rule|account|Insufficient stock/);
    assert.equal(await count(f,dispatch.vehicle_warehouse_id),7);assert.equal((await f.s.JournalEntry.list()).length,0);
  }
});

test('closed period and late audit failure roll back Dégustation stock, journal and balances through the real API transaction',async()=>{
  for(const kind of ['closed-period','audit']){
    const db=new PGlite();
    try{
      const f=await setup(db),{dispatch}=await f.issue(),route=await functionRoute();
      if(kind==='closed-period')await f.s.AccountingPeriod.update('period',{status:'closed'});
      else {const create=f.s.AuditLog.create;f.s.AuditLog.create=async v=>{if(v.action==='record_degustation')throw Error('Simulated audit failure');return create(v);};}
      globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
      const response=await route(request(f.give(dispatch.id)),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,400);assert.match((await response.json()).error,kind==='closed-period'?/period.*closed/:/Simulated audit failure/);
      assert.equal(await count(f,dispatch.vehicle_warehouse_id),7);assert.equal((await f.s.StockMovement.filter({document_type:'Degustation'})).length,0);assert.equal((await f.s.JournalEntry.list()).length,0);assert.equal((await f.s.Account.get('expense')).balance,0);
    }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
  }
});


test('lot carrying costs and product inventory accounts drive P&L rather than selling price',async()=>{
  const f=await setup(undefined,{allocated:2,total:2});
  const lots=await f.s.StockBalance.filter({warehouse_id:'factory',product_id:'product-a'});for(const b of lots)await f.s.StockBalance.update(b.id,{quantity:0,total_value:0});
  await f.s.StockBalance.create({warehouse_id:'factory',product_id:'product-a',quantity:1,unit_cost:125,total_value:125,lot_number:'FIRST',expiry_date:'2098-01-01',qc_status:'approved'});
  await f.s.StockBalance.create({warehouse_id:'factory',product_id:'product-a',quantity:1,unit_cost:275,total_value:275,lot_number:'SECOND',expiry_date:'2099-01-01',qc_status:'approved'});
  const inventory=await f.s.Account.create({account_number:'CUSTOM-INVENTORY',name:'Custom inventory',account_type:'asset',normal_balance:'debit',balance:400,is_active:true,is_posting:true});await f.s.Product.update('product-a',{inventory_account_id:inventory.id});
  const {dispatch}=await f.issue();await employeeStockAction(f.client,f.actor,{...f.give(dispatch.id),lines:[{product_id:'product-a',quantity:2}]});
  const movements=await f.s.StockMovement.filter({document_type:'Degustation'});assert.deepEqual(movements.map(m=>m.lot_number).sort(),['FIRST','SECOND']);assert.equal(movements.reduce((n,m)=>n+m.total_value,0),400);
  const lines=await f.s.JournalLine.list();assert.equal(lines.find(l=>l.account_id===inventory.id).credit,400);assert.equal(lines.find(l=>l.account_id==='expense').debit,400);
  const output=await build({entryPoints:['src/lib/statements.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'rounding-only',setup(b){b.onResolve({filter:/^@\/lib\/posting$/},()=>({path:'rounding',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const round2=n=>Math.round(Number(n||0)*100)/100;'}));}}]});
  const {computeActivity,netProfit,sectionRows}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
  const journals=await f.s.JournalEntry.list(),accounts=await f.s.Account.list(),activity=computeActivity({journalsById:Object.fromEntries(journals.map(j=>[j.id,j])),lines,fromDate:date.slice(0,8)+'01',toDate:date});
  assert.equal(sectionRows(accounts,activity,['expense'],1).find(a=>a.id==='expense').amount,400);assert.equal(netProfit(accounts,activity),-400);
});

test('legacy sale-only loads cannot give away stock and callers cannot use another employee run',async()=>{
  const f=await setup(undefined,{allocated:0}),{dispatch}=await f.issue();
  await assert.rejects(employeeStockAction(f.client,f.actor,f.give(dispatch.id)),/exceeds/);
  assert.equal((await employeeStockAction(f.client,f.actor,{action:'employeeStockWorkspace'})).balances[0].usable_quantity,7);
  const other=await f.s.Employee.create({role:'employee',status:'active',full_name:'Another employee',user_id:'other-login'});f.client.entities.Employee.filter=async()=>[other];
  await assert.rejects(employeeStockAction(f.client,{id:'other-login',role:'user'},f.give(dispatch.id)),/assigned/);
});
