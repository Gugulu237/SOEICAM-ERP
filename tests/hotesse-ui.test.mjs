import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('Hotesse UI shows informational shelf stock, delivery batch quantities and price-optional daily reporting', async () => {
  const output = await build({ stdin: { contents: `
    import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
    import Workspace from './src/components/outlets/HotesseWorkspace.jsx';
    import History from './src/components/outlets/OutletDeliveryHistory.jsx';
    import Daily from './src/components/outlets/OutletDailyReportForm.jsx';
    import Check from './src/components/outlets/OutletShelfCheckForm.jsx';
    export function render(mode,props) {return renderToStaticMarkup(React.createElement({workspace:Workspace,history:History,daily:Daily,check:Check}[mode],props));}
  `, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'hotesse-ui', setup(b) {
      b.onResolve({ filter: /^@\/api\/erpClient$/ }, () => ({ path: 'erp', namespace: 'mock' }));
      b.onResolve({ filter: /^@\/components\/ui\/dialog$/ }, () => ({ path: 'dialog', namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: path === 'erp' ? 'export const erp={};' : `import React from 'react'; const Box=({children})=>React.createElement('div',{},children); export const Dialog=Box,DialogContent=Box,DialogHeader=Box,DialogTitle=Box,DialogDescription=Box;`, resolveDir: process.cwd() }));
    } }] });
  const module = { exports: {} }; new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports);
  const location = { id: 'point', customer_name: 'Registered supermarket', name: 'Main shop' };
  const product = { id: 'p', name: 'YOLA', storage_unit: 'ea', inventory_type: 'assembly', opening_quantity: 20, display_quantity: 0, supplied_quantity: 20, cumulative_supplied: 20 };
  const delivery = { key: 'delivery', document_number: 'FS-001', date: '2026-10-18', lines: [{ product_id: 'p', product_name: 'YOLA', unit: 'ea', quantity: 20, lot_number: 'BATCH-20261018', expiry_date: '2026-11-18' }] };
  const markup = module.exports.render('workspace', { data: { date: '2026-10-18', locations: [location], outletProducts: { point: [product] }, outletDeliveries: { point: [delivery] } } });
  assert.match(markup, /My point of sale/); assert.match(markup, /Performance &amp; rewards/); assert.doesNotMatch(markup, /Your shelves, your daily report|Estimated rewards/); assert.match(markup, /Stock-out/); assert.match(markup, /Record daily report/); assert.match(markup, /Supplies &amp; batches/);
  const history = module.exports.render('history', { deliveries: [delivery], onCount() {} });
  assert.match(history, /BATCH-20261018/); assert.match(history, /20 ea/); assert.match(history, /Count shelves after delivery/);
  const formProps = { location, products: [product], snapshotKey: 'snapshot', onClose() {}, onDone() {} };
  const daily = module.exports.render('daily', formProps);
  assert.match(daily, /Units sold/); assert.match(daily, /Closing stock count/); assert.match(daily, /Retail price \(optional\)/);
  assert.match(daily, /Quantities only/); assert.match(daily, /no company sale, invoice, warehouse movement or accounting entry/);
  const retailInput = daily.match(/Retail price \(optional\)[\s\S]*?(<input[^>]+>)/)?.[1];
  assert.ok(retailInput); assert.doesNotMatch(retailInput, /required/);
  const check = module.exports.render('check', { ...formProps, delivery });
  assert.match(check, /Shelf count after delivery/); assert.match(check, /BATCH-20261018/); assert.match(check, /Total remaining on shelves/);
  assert.match(check, /does not create a sale/); assert.doesNotMatch(check, /selling price/i);
});
