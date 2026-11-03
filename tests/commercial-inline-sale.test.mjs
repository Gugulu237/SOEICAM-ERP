import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialUI, hookRuntime } from './helpers/commercial-ui.mjs';
import { fixture, fieldHandler, request, staff, date, user, validSupply } from './helpers/commercial-supply.mjs';

async function inlineSupply(role, photo = false, dashboardPending = false, withExchange = false, phone = false) {
  const render = await commercialUI(), handler = await fieldHandler(), { client, tables } = fixture();
  tables.Invoice = [];tables.Vehicle[0].registration='CE 123 AB';
  tables.Product.push({ id: 'not-loaded', name: 'Factory-only finished product', inventory_type: 'assembly', is_active: true, selling_price: 600 });
  tables.StockBalance.push({ id: 'factory-only', warehouse_id: 'factory', product_id: 'not-loaded', quantity: 1000, qc_status: 'approved' },
    { id: 'other-vehicle', warehouse_id: 'another-vehicle', product_id: 'product-a', quantity: 800, qc_status: 'approved' });
  client.asServiceRole.entities.Invoice = { filter: async () => [] };
  client.auth.me = async () => role === 'admin' ? { id: 'gm-login', role: 'admin' } : user;
  client.entities.Employee.filter = async () => role === 'admin' ? [] : [staff];
  globalThis.__dailySupplyClient = client;
  const ui = hookRuntime(), originalWindow = globalThis.window;ui.phone=phone;
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
  if (photo) props.section='pos';
  if (dashboardPending) Object.assign(props, { data:null, actorEmployee:staff, loading:true });
  const draw = () => { ui.beforeRender(); return render(props); };
  try {
    draw(); if (photo) ui.catalog.onQuantityChange(ui.catalog.products[0],4); else ui.buttons.find(button => button.label === 'Record sale').onClick();
    for (let i = 0; i < 6; i++) { draw(); await ui.flush(); }
    const html = draw();
    assert.match(html, /Record sale \/ supply/); assert.match(html, /Agent A/); assert.match(html, /CE 123 AB/);
    assert.deepEqual(ui.navigation, [], 'entry stays in the Commercial section');
    assert.equal(ui.catalog.products[0].quantity, 10);
    assert.deepEqual(ui.catalog.products.map(product => product.id), ['product-a'], 'factory stock and other vehicles never enter this agent catalogue');
    if (photo) { assert.equal(ui.catalog.lines.length, 1); assert.equal(ui.catalog.lines[0].quantity, 4); for (let i=0;i<3;i++) { draw(); await ui.flush(); } assert.equal(ui.catalog.lines[0].quantity, 4); }

    {
      assert.match(draw(),/Step 1 of 3/);assert.equal(ui.buttons.some(b=>b.label==='Record supply'),false);
      ui.buttons.find(b=>b.label==='Continue to products').onClick();assert.match(draw(),/Choose a customer for this sale/);
    }
    ui.customer.onChange('customer-a');draw();await ui.flush();draw();
    {
      ui.buttons.find(b=>b.label==='Continue to products').onClick();assert.match(draw(),/Step 2 of 3/);
      ui.buttons.find(b=>b.label==='Choose products').onClick();draw();assert.equal(ui.catalog.open,true);
      if(!photo)ui.catalog.onQuantityChange(ui.catalog.products[0],'1');draw();ui.catalog.onOpenChange(false);draw();
      assert.equal(ui.buttons.some(b=>b.label==='Record supply'),false);assert.equal(tables.FieldSale.length,0);
      ui.buttons.find(b=>b.label==='Review sale').onClick();assert.match(draw(),/Please answer whether spoiled goods/);
      ui.buttons.find(b=>b.label===(withExchange?'Yes, goods replaced':'No replacements')).onClick();draw();
      if(withExchange){ui.buttons.find(b=>b.label==='Choose replacement products').onClick();draw();assert.equal(ui.replacementCatalog.products[0].available,10-(photo?4:1));ui.replacementCatalog.onQuantityChange(ui.replacementCatalog.products[0],2);ui.replacementCatalog.onOpenChange(false);draw();assert.equal(ui.catalog.products[0].available,8,'commercial paid picker reserves replacement stock');ui.controls.find(c=>c.id==='exchange-reason-0').onChange({target:{value:'damaged'}});draw();}
      ui.buttons.find(b=>b.label==='Review sale').onClick();const reviewHtml=draw();assert.match(reviewHtml,/Step 3 of 3/);assert.equal((reviewHtml.match(/id="qty-0"/g)||[]).length,1,'the review has one quantity control and no hidden duplicate IDs');
      ui.buttons.find(b=>b.label==='Back').onClick();assert.match(draw(),/Step 2 of 3/);assert.equal(Number(ui.catalog.lines[0].quantity),photo?4:1);
      ui.buttons.find(b=>b.label==='Review sale').onClick();draw();
    }
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
    assert.equal(tables.StockBalance[0].quantity, 10-(photo?4:1)-(withExchange?2:0)); assert.equal(tables.JournalEntry.length, withExchange ? 2 : 1); assert.equal(tables.Customer[0].balance, photo?2000:500);
    assert.equal(tables.StockBalance.find(row => row.id === 'factory-only').quantity, 1000); assert.equal(tables.StockBalance.find(row => row.id === 'other-vehicle').quantity, 800);
    client.auth.me = async () => ({ id: 'gm-login', role: 'admin' }); client.entities.Employee.filter = async () => [];
    const response = await handler(request({ action: 'companySales', from: date, to: date })), register = await response.json();
    assert.equal(response.status, 200, register.error); assert.equal(register.rows.length, 1);
    assert.equal(register.rows[0].document_id, tables.FieldSale[0].id); assert.equal(register.rows[0].receipt_count, 1); assert.equal(register.totals.sales, photo?2000:500);
    assert.equal(tables.JournalEntry.length, withExchange ? 2 : 1, 'displaying company sales must not repost the ledger');
    if (withExchange) { assert.equal(tables.SpoilageRecord.length, 1); assert.equal(tables.SpoilageRecord[0].reason, 'damaged_at_store'); assert.equal(tables.SpoilageRecord[0].quantity, 2); assert.equal(tables.SpoilageRecord[0].source_sale_id, tables.FieldSale[0].id); }
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

test('phone checkout records a free damaged-stock replacement with the sale and updates held stock without changing the customer bill', () => inlineSupply('commercial', false, false, true));

test('first dashboard tile starts an own-account sale with cash or credit selected during review', async () => {
  for (const paymentType of ['cash','credit']) {
    const render = await commercialUI(), { client,tables } = fixture(), runtime = hookRuntime();
    const previous = { window: globalThis.window, document: globalThis.document };
    runtime.session = { role: 'commercial', isAdmin: false, employee: staff, loading: false };
    runtime.client = { entities: client.asServiceRole.entities, functions: { invoke: async () => ({ data: { runs: [{id:'run',can_supply:true,vehicle_registration:'CE 123 AB'}], runProducts: [tables.Product[0]], runBalances: [{...tables.StockBalance[0],dispatch_id:'run',usable_quantity:10}] } }) } };
    globalThis.__commercialUI = runtime;
    globalThis.window = { addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const props = { actorEmployee: staff, loading: true };
    const draw = () => { runtime.beforeRender(); return render(props); };
    try {
      draw();assert.equal(runtime.buttons[0]['aria-label'],'Record sale');assert.ok(runtime.buttons.some(button=>button['aria-label']==='Register a new customer'));
      runtime.buttons[0].onClick();
      for (let i=0;i<5;i++) { draw(); await runtime.flush(); }
      const html = draw(); assert.match(html, /Record sale \/ supply/);
      runtime.customer.onChange('customer-a');for(let i=0;i<3;i++){draw();await runtime.flush();}draw();
      runtime.buttons.find(b=>b.label==='Continue to products').onClick();draw();
      runtime.catalog.onQuantityChange(runtime.catalog.products[0],1);draw();
      runtime.buttons.find(b=>b.label==='No replacements').onClick();draw();runtime.buttons.find(b=>b.label==='Review sale').onClick();draw();
      runtime.buttons.find(button => button.label === (paymentType === 'cash' ? 'Cash collected' : 'On credit')).onClick();draw();
      const selected = runtime.buttons.find(button => button.label === (paymentType === 'cash' ? 'Cash collected' : 'On credit'));
      assert.equal(selected['aria-pressed'], true);
      assert.deepEqual(runtime.navigation, []);
    } finally { runtime.cleanup(); globalThis.window = previous.window; globalThis.document = previous.document; delete globalThis.__commercialUI; }
  }
});

test('mobile agent completes customer, product and review screens with own-account stock and receipt checks',()=>inlineSupply('commercial',false,false,false,true));
