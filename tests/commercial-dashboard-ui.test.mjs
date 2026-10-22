import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

test('own Commercial dashboard exposes entry while management reports remain read-only, including POS bookmarks', async () => {
  const output = await build({ stdin: { contents: `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import CommercialDashboard from './src/components/home/CommercialDashboard.jsx';
    export const render = props => renderToStaticMarkup(React.createElement(CommercialDashboard, props));
  `, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'commercial-ui', setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/router$/ }, () => ({ path: 'router', namespace: 'commercial-ui' }));
      builder.onResolve({ filter: /^@\/api\/erpClient$/ }, () => ({ path: 'client', namespace: 'commercial-ui' }));
      builder.onResolve({ filter: /^@\/components\/ui\/button$/ }, () => ({ path: 'button', namespace: 'commercial-ui' }));
      builder.onResolve({ filter: /^@\/views\/FieldSaleForm$/ }, () => ({ path: 'form', namespace: 'commercial-ui' }));
      builder.onLoad({ filter: /.*/, namespace: 'commercial-ui' }, ({ path }) => ({ contents: {
        router: 'export const useNavigate = () => path => { globalThis.__commercialNavigation = path; }; export const useSearchParams = () => [new URLSearchParams(), () => {}];',
        client: 'export const erp = {}; export const invalidateERPReads = () => {};',
        form: 'export default function Form(){return null;}',
        button: `import React from 'react'; export function Button({children,onClick,...props}) { globalThis.__commercialButtons.push({children,onClick,...props}); return React.createElement('button', props, children); }`,
      }[path], resolveDir: process.cwd() }));
    } }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const data = { employee: { id: 'agent-a', full_name: 'Agent A' }, date: '2026-10-18', monthStart: '2026-10-01', runs: [{ id: 'run-a', driver_name: 'Driver A', vehicle_name: 'Van A', dispatch_number: 'RUN-A', dispatch_date: '2026-10-17', status: 'in_transit', can_supply: true }] };
  const label = children => (Array.isArray(children) ? children : [children]).filter(child => typeof child === 'string').join('');
  try {
    globalThis.__commercialButtons = [];
    const own = module.exports.render({ data, managing:false });
    assert.match(own, /Record sale/); assert.match(own, /Customers/);
    assert.match(own, /Exchanges/); assert.match(own, /Performance &amp; rewards/); assert.doesNotMatch(own, /Commission estimate this month|Cash awaiting clearance|Your day in the field/);
    assert.match(own, /Driver A/); assert.match(own, /Van A/);
    const sale = globalThis.__commercialButtons.find(button => label(button.children) === 'Record sale');
    assert.equal(sale.disabled,false); sale.onClick();
    assert.equal(globalThis.__commercialNavigation,undefined,'own sale stays inside the dashboard');
    for(const section of ['workspace','pos']) {
      globalThis.__commercialButtons = [];
      const report=module.exports.render({data,managing:true,section,openFromLink:true,initialCustomerId:'forged'});
      assert.match(report,/Read-only management view/);assert.match(report,/Agent A/);
      assert.match(report,/Daily supplies/);assert.match(report,/Supply date/);
      assert.doesNotMatch(report,/Record sale|Register customer|Mark cash as deposited|credited to this agent/);
      assert.equal(globalThis.__commercialButtons.some(button => label(button.children)==='Record sale'),false);
    }
    globalThis.__commercialButtons = [];
    module.exports.render({ data, preview: true });
    assert.equal(globalThis.__commercialButtons.find(button => label(button.children) === 'Record sale').disabled, true);
    const posData = { ...data, products: [
      { id: 'finished', name: 'YOLA finished', inventory_type: 'assembly', is_active: true, selling_price: 500, unit_of_measure: 'ea' },
      { id: 'raw', name: 'Raw material', inventory_type: 'raw_material', is_active: true, selling_price: 100 },
    ], balances: [{ product_id: 'finished', quantity: 8, qc_status: 'approved' }, { product_id: 'raw', quantity: 12, qc_status: 'approved' }] };
    globalThis.__commercialButtons = [];
    const pos = module.exports.render({ data: posData, section: 'pos' });
    assert.match(pos, /Tap a product/);
    assert.match(pos, /YOLA finished/); assert.match(pos, /8 units left/);
    assert.doesNotMatch(pos, /Raw material/);
    assert.match(pos, /Sales history/); assert.doesNotMatch(pos, /Monthly goals|Daily supplies/);
    assert.equal(globalThis.__commercialButtons.find(button => label(button.children) === 'Record sale').disabled, false);
  } finally { delete globalThis.__commercialButtons; delete globalThis.__commercialNavigation; }
});
