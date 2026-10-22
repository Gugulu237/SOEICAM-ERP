import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

test('catalogue quick-edit actions stay separate from the product navigation button and replace its price only when requested', async () => {
  const output = await build({
    stdin: { contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import ProductCatalog from './src/components/shared/ProductCatalog.jsx';
      export function render(hidePrice, details) {
        return renderToStaticMarkup(React.createElement(ProductCatalog, {
          products: [{ id:'finished', name:'Yogurt', inventory_type:'assembly', selling_price:750, storage_unit:'ea' }],
          onSelect:() => {},
          hidePrice,
          renderDetails:details ? () => React.createElement('form', { 'data-inline-editor':true }, React.createElement('button', { type:'submit' }, 'Save price')) : undefined,
        }));
      }
    `, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true, platform: 'node', format: 'cjs', write: false,
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports);
  const { render } = module.exports;
  const normal = render(false, false);
  assert.match(normal, /750 XAF/);
  assert.doesNotMatch(normal, /data-inline-editor/);
  const edited = render(true, true);
  assert.doesNotMatch(edited, /750 XAF/);
  assert.match(edited, /aria-label="Open Yogurt"/);
  const article = edited.match(/<article\b[\s\S]*?<\/article>/)[0];
  const editorAt = article.indexOf('data-inline-editor');
  const navigationEnd = article.indexOf('</button>');
  assert.ok(editorAt > navigationEnd, 'the editor must not sit inside the card navigation button');
  let depth = 0;
  for (const tag of article.matchAll(/<button\b|<\/button>/g)) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    assert.ok(depth >= 0 && depth <= 1, 'interactive buttons must never be nested');
  }
  assert.equal(depth, 0);
});

let panelRenderer;
async function renderPanel(overrides = {}) {
  panelRenderer ||= build({
    stdin: { contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import QuickItemPanel from './src/components/items/QuickItemPanel.jsx';
      import { quickItemDraft } from './src/lib/item-quick-edit.js';
      const item = {id:'finished', name:'Yogurt', inventory_type:'assembly', selling_price:150, unit_of_measure:'ea', reorder_level:20,
        components:[{quantity:0.5,unit_cost:100},{quantity:0.25,unit_cost:20}]};
      const current = {product_id:'finished',unit:'ea',quantity_on_hand:80,usable_quantity:70,blocked_quantity:10,stock_value:4400,reorder_level:20,below_reorder:false,
        warehouses:[{id:'main',name:'Main warehouse',quantity_on_hand:60,usable_quantity:50},{id:'shop',name:'Shop',quantity_on_hand:20,usable_quantity:20}],as_of:'2026-10-18T12:30:00.000Z',reservations_included:false};
      export function render(overrides) {
        const props = {item,draft:quickItemDraft(item),choices:[{code:'ea',name:'Each'},{code:'kg',name:'Kilogram'}],stock:{status:'ready',data:current,error:''},formId:'edit',dirty:true,...overrides};
        return renderToStaticMarkup(React.createElement(QuickItemPanel, props));
      }
    `, resolveDir: process.cwd(), loader: 'jsx' },
    alias: { '@': process.cwd() + '/src' }, bundle: true, platform: 'node', format: 'cjs', write: false,
  }).then(output => {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports);
    return module.exports.render;
  });
  return (await panelRenderer)(overrides);
}

test('landscape quick edit keeps pricing separate from a fresh warehouse stock report and assembly cost read-only', async () => {
  const markup = await renderPanel();
  assert.match(markup, /lg:grid-cols-\[minmax\(0,1\.05fr\)_minmax\(0,1fr\)\]/);
  assert.match(markup, /aria-labelledby="edit-prices"/);
  assert.match(markup, /aria-labelledby="edit-stock"/);
  assert.match(markup, /Current selling price/);
  assert.match(markup, /150 XAF/);
  assert.match(markup, /Manufacturing cost/);
  assert.match(markup, /55 XAF/);
  assert.match(markup, /readonly=""[^>]*value="55"/i);
  assert.doesNotMatch(markup, /Purchase cost \(XAF/);
  assert.match(markup, /80 ea/);
  assert.match(markup, /70 ea/);
  assert.match(markup, /before order reservations/);
  assert.match(markup, /Main warehouse/);
  assert.match(markup, /Shop/);
  assert.match(markup, /Held or expired stock:/);
  assert.match(markup, /10 ea/);
  assert.match(markup, /Stock checked/);
  assert.match(markup, /aria-label="Refresh current stock"/);
});

test('unconfigured catalogue drafts show missing prices and a real blank U/M choice instead of free each pricing', async () => {
  const markup = await renderPanel({
    item: { id: 'draft', name: 'New product', inventory_type: 'assembly', configuration_status: 'draft', is_active: false, selling_price: null, unit_of_measure: null, components: [] },
    draft: { selling_price: '', purchase_price: '', unit_of_measure: '', reorder_level: '0' },
    stock: { status: 'loading', data: null, error: '' },
  });
  assert.match(markup, /Set selling price/);
  assert.match(markup, /<option value="" selected="">Select U\/M<\/option>/);
  assert.match(markup, /Selling price \(XAF \/ U\/M\)/);
  assert.match(markup, /type="number"[^>]*value=""/);
  assert.doesNotMatch(markup, /0 XAF|per ea|XAF \/ ea/);
});

test('loading and failed stock reports show unknown quantities rather than stale values or fabricated zero', async () => {
  for (const stock of [{ status: 'loading', data: null, error: '' }, { status: 'error', data: null, error: 'Connection interrupted' }]) {
    const markup = await renderPanel({ stock });
    const summary = markup.match(/<dl aria-label="Current item summary"[\s\S]*?<\/dl>/)[0];
    assert.match(summary, /—/);
    assert.doesNotMatch(summary, /80 ea|70 ea|0 ea/);
    assert.doesNotMatch(markup, /No recorded stock at any warehouse/);
    if (stock.status === 'loading') {
      assert.match(markup, /role="status"/);
      assert.match(markup, /Loading current stock/);
    } else {
      assert.match(markup, /role="alert"/);
      assert.match(markup, /Connection interrupted/);
      assert.match(markup, /Retry stock report/);
    }
  }
  const empty = await renderPanel({ stock: { status: 'ready', data: { unit: 'ea', quantity_on_hand: 0, usable_quantity: 0, blocked_quantity: 0, stock_value: 0, reorder_level: 20, below_reorder: true, warehouses: [] } } });
  assert.match(empty, /0 ea/);
  assert.match(empty, /No recorded stock at any warehouse/);
  assert.match(empty, /Below reorder point/);
});

test('changing a draft unit does not relabel recorded stock and legacy purchase/sales units stay explicit', async () => {
  const changed = await renderPanel({ draft: { selling_price: '175', purchase_price: '', unit_of_measure: 'kg', reorder_level: '5' } });
  assert.match(changed, /Selling price \(XAF \/ kg\)/);
  assert.match(changed, /Reorder point \(kg\)/);
  assert.match(changed, /80 ea/);
  assert.match(changed, /stock report still uses the recorded unit \(ea\)/);
  assert.doesNotMatch(changed, /80 kg/);
  const legacy = await renderPanel({ item: { id: 'milk', name: 'Milk', inventory_type: 'raw_material', storage_unit: 'kg', purchase_unit: 'bag', sales_unit: 'pack', purchase_to_storage_factor: 25, current_cost: 1000, selling_price: 900 }, draft: { purchase_price: '25000', selling_price: '900', unit_of_measure: 'kg', reorder_level: '0' }, stock: { status: 'loading', data: null, error: '' } });
  assert.match(legacy, /Purchase cost \(XAF \/ bag\)/);
  assert.doesNotMatch(legacy, /Selling price/);
  assert.match(legacy, /Stock is counted in kg/);
});

test('failed saves retain editable drafts; in-flight saves disable edits and both footer actions', async () => {
  const draft = { selling_price: '175.25', purchase_price: '', unit_of_measure: 'ea', reorder_level: '8' };
  const failed = await renderPanel({ draft, error: 'Unable to save. Your changes are still here.' });
  assert.match(failed, /value="175.25"/);
  assert.match(failed, /value="8"/);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Your changes are still here/);
  const pending = await renderPanel({ draft, saving: true });
  assert.match(pending, /aria-busy="true"/);
  assert.match(pending, /disabled=""[^>]*value="175.25"/);
  for (const button of pending.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)) assert.match(button[0], /disabled=""/, 'refresh, cancel and save must all be disabled during a save');
});

test('services are not presented as zero-stock inventory and have no reorder or stock-refresh control', async () => {
  const markup = await renderPanel({ item: { id: 'delivery', name: 'Delivery', inventory_type: 'service', selling_price: 500, unit_of_measure: 'ea' }, draft: { selling_price: '500', purchase_price: '0', unit_of_measure: 'ea', reorder_level: '0' } });
  assert.match(markup, /Not stocked/);
  assert.match(markup, /Service items are not stocked/);
  assert.doesNotMatch(markup, /Refresh current stock|Reorder point \(/);
  assert.doesNotMatch(markup, /0 ea/);
});

test('quick item writes use the dedicated checked endpoint and return the saved record without read batching', async () => {
  const output = await build({
    entryPoints: ['src/api/erpClient.js'], bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'quick-edit-auth-fixture', setup(builder) {
      builder.onResolve({ filter: /supabase\/browser$/ }, () => ({ path: 'auth', namespace: 'quick-edit-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'quick-edit-fixture' }, () => ({ contents: 'export const supabaseBrowser = () => { throw Error("No auth operation expected"); };' }));
    } }],
  });
  const previous = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, options, body });
    return Response.json({ id: body.id, selling_price: body.changes.selling_price, current_cost: 420 });
  };
  try {
    const { erp } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
    const saved = await erp.items.quickEdit({ id: 'finished', changes: { selling_price: 850 } });
    assert.deepEqual(saved, { id: 'finished', selling_price: 850, current_cost: 420 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/items/quick-edit');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.credentials, 'same-origin');
    assert.deepEqual(requests[0].body, { id: 'finished', changes: { selling_price: 850 } });
    globalThis.fetch = async () => Response.json({ error: 'Cannot change the Unit of Measure of an item with stock history' }, { status: 400 });
    await assert.rejects(erp.items.quickEdit({ id: 'finished', changes: { unit_of_measure: 'box' } }), /stock history/);
  } finally { globalThis.fetch = previous; }
});
