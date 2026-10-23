import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialUI, hookRuntime } from './helpers/commercial-ui.mjs';
import { fixture, fieldHandler, request, staff, date, user, validSupply } from './helpers/commercial-supply.mjs';

async function inlineSupply(role, photo = false, dashboardPending = false) {
  const render = await commercialUI(), handler = await fieldHandler(), { client, tables } = fixture();
  tables.Invoice = [];
  tables.Product.push({ id: 'not-loaded', name: 'Factory-only finished product', inventory_type: 'assembly', is_active: true, selling_price: 600 });
  tables.StockBalance.push({ id: 'factory-only', warehouse_id: 'factory', product_id: 'not-loaded', quantity: 1000, qc_status: 'approved' },
    { id: 'other-vehicle', warehouse_id: 'another-vehicle', product_id: 'product-a', quantity: 800, qc_status: 'approved' });
  client.asServiceRole.entities.Invoice = { filter: async () => [] };
  client.auth.me = async () => role === 'admin' ? { id: 'gm-login', role: 'admin' } : user;
  client.entities.Employee.filter = async () => role === 'admin' ? [] : [staff];
  globalThis.__dailySupplyClient = client;
  const ui = hookRuntime(), originalWindow = globalThis.window;
  ui.session = { role, isAdmin: role === 'admin', employee: role === 'admin' ? null : staff, loading: false };
  ui.client = { entities: client.asServiceRole.entities, functions: { invoke: async (name, body) => {
    const response = await handler(request(body)), data = await response.json();
    if (!response.ok) throw Error(data.error); return { data };
  } } };
  globalThis.__commercialUI = ui;
  globalThis.window = { addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
  const originalDocument = globalThis.document;
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const originalRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => callback();
  let refreshed = 0;
  const props = { data: { employee: staff, date, monthStart: date.slice(0, 8) + '01', products: [tables.Product[0]], balances: [tables.StockBalance[0]] }, managing: role === 'admin', onRefresh: () => { refreshed++; } };
  if (dashboardPending) Object.assign(props, { data:null, actorEmployee:staff, loading:true });
  const draw = () => { ui.beforeRender(); return render(props); };
  try {
    draw(); if (photo) ui.catalog.onSelect(ui.catalog.products[0]); else ui.buttons.find(button => button.label === 'Record sale').onClick();
    for (let i = 0; i < 6; i++) { draw(); await ui.flush(); }
    const html = draw();
    assert.match(html, /Record sale \/ supply/); assert.match(html, /Agent A/); assert.match(html, /Driver A/);
    assert.deepEqual(ui.navigation, [], 'entry stays in the Commercial section');
    assert.equal(ui.catalog.products[0].quantity, 10);
    assert.deepEqual(ui.catalog.products.map(product => product.id), ['product-a'], 'factory stock and other vehicles never enter this agent catalogue');
    if (photo) { assert.equal(ui.catalog.lines.length, 1); assert.equal(ui.catalog.lines[0].quantity, 1); for (let i=0;i<3;i++) { draw(); await ui.flush(); } assert.equal(ui.catalog.lines[0].quantity, 1); }
    else ui.catalog.onSelect(ui.catalog.products[0]);
    ui.customer.onChange('customer-a'); draw(); await ui.flush();
    ui.buttons.find(button => button.label === 'On credit').onClick(); draw();
    ui.receipt.onReferenceChange('INLINE-PROOF'); draw();
    await ui.buttons.find(button => button.label === 'Record supply').onClick();
    assert.match(draw(), /Attach a clear supply receipt photo/); assert.equal(tables.FieldSale.length, 0);
    ui.receipt.onChange(['private/fixture.jpg']); draw();
    const save = ui.buttons.find(button => button.label === 'Record supply');
    assert.equal(save.disabled, false);
    await Promise.all([save.onClick(), save.onClick()]);
    assert.match(draw(), /Posted to company Sales/); assert.deepEqual(ui.navigation, []); assert.equal(refreshed, 1);
    assert.equal(tables.FieldSale.length, 1); assert.equal(tables.FieldSale[0].status, 'approved_posted');
    assert.equal(tables.FieldSale[0].commercial_id, staff.id); assert.equal(tables.FieldSale[0].recorded_by, role === 'admin' ? 'gm-login' : user.id);
    assert.equal(tables.StockBalance[0].quantity, 9); assert.equal(tables.JournalEntry.length, 1); assert.equal(tables.Customer[0].balance, 500);
    assert.equal(tables.StockBalance.find(row => row.id === 'factory-only').quantity, 1000); assert.equal(tables.StockBalance.find(row => row.id === 'other-vehicle').quantity, 800);
    client.auth.me = async () => ({ id: 'gm-login', role: 'admin' }); client.entities.Employee.filter = async () => [];
    const response = await handler(request({ action: 'companySales', from: date, to: date })), register = await response.json();
    assert.equal(response.status, 200, register.error); assert.equal(register.rows.length, 1);
    assert.equal(register.rows[0].document_id, tables.FieldSale[0].id); assert.equal(register.rows[0].receipt_count, 1); assert.equal(register.totals.sales, 500);
    assert.equal(tables.JournalEntry.length, 1, 'displaying company sales must not repost the ledger');
  } finally {
    ui.cleanup(); globalThis.window = originalWindow; globalThis.document = originalDocument; globalThis.requestAnimationFrame = originalRAF; delete globalThis.__commercialUI; delete globalThis.__dailySupplyClient;
  }
}
test('GM viewing a selected employee remains in reports even when an old link requests inline POS', async () => {
  const render=await commercialUI(), handler=await fieldHandler(), {client,tables}=fixture();
  const manager={id:'gm-login',role:'admin',full_name:'General Manager'};
  client.auth.me=async()=>manager;client.entities.Employee.filter=async()=>[];
  const runtime=hookRuntime(),previous={window:globalThis.window,document:globalThis.document};
  runtime.session={role:'admin',isAdmin:true,employee:null,loading:false};
  let mutationCalls=0;
  runtime.client={entities:client.asServiceRole.entities,functions:{invoke:async(name,body)=>{mutationCalls++;throw Error('Report invoked '+body.action);}}};
  globalThis.__commercialUI=runtime;globalThis.__dailySupplyClient=client;
  globalThis.window={addEventListener(){},removeEventListener(){},setInterval:()=>1,clearInterval(){}};
  globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  const before=structuredClone(tables);
  try {
    const props={data:{employee:staff,date,monthStart:date.slice(0,8)+'01',customers:[{id:'known-customer',business_name:'Known customer',acquisition_verified:'pending'}]},managing:true,section:'pos',openFromLink:true,initialCustomerId:'known-customer'};
    for(const activeTab of ['supplies','customers','stock','returns']){
      runtime.beforeRender();const html=render({...props,activeTab});await runtime.flush();
      assert.match(html,/Commercial activity report/);
      assert.doesNotMatch(html,/Record sale|Register customer|Record supply|Collect expired goods|Report cash deposit/);
      assert.equal(runtime.buttons.some(button=>/Record sale|Register customer|Record supply/.test(button.label)),false);
    }
    assert.equal(mutationCalls,0);
    const response=await handler(request(validSupply({commercialId:staff.id})));
    assert.ok([400,403].includes(response.status));
    assert.match((await response.json()).error,/Commercial|own|read.only|employee/i);
    assert.deepEqual(tables,before,'GM report and a forged POS submission cannot change employee data');
  } finally {
    runtime.cleanup();globalThis.window=previous.window;globalThis.document=previous.document;delete globalThis.__commercialUI;delete globalThis.__dailySupplyClient;
  }
});
test('Commercial records a receipt-backed sale inside their own dashboard and it appears once in company Sales', () => inlineSupply('commercial'));

test('Commercial records a customer sale even while the dashboard report is unavailable', () => inlineSupply('commercial', false, true));

test('tapping a dashboard product photo carries that product into the sale once, without duplication on refresh', () => inlineSupply('commercial', true));
