import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import { driverLoadSnapshot } from '../src/lib/driver-deliveries.js';
const require = createRequire(import.meta.url);
let compiled;
async function renderer() {
  compiled ||= build({ stdin: { contents: "import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Planner,{DriverLoadReceipt} from './src/components/home/DriverDeliveryPlanner.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement(kind==='receipt'?DriverLoadReceipt:Planner,props));", resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'driver-ui-fixture', setup(b) {
      b.onResolve({ filter: /^react$/ }, args => args.importer.endsWith('DriverDeliveryPlanner.jsx') ? { path: 'hooks', namespace: 'mock-hooks' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'mock-hooks' }, () => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__driverUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__driverUI.state('driver',v),useRef=v=>globalThis.__driverUI.ref('driver',v);`, resolveDir: process.cwd() }));
      const mocks = {
        '@/components/ui/button': "import React from 'react';export const Button=({children,variant,size,...props})=>{globalThis.__driverUI.capture('button',props,children);return React.createElement('button',props,children);};",
        '@/components/customers/CustomerMapLinks': "export default ()=>null;",
        '@/lib/field-ops': "export const errorMessage=e=>e.message;export const invokeFieldOps=body=>globalThis.__driverUI.invoke(body);",
      };
      b.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'mock' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd() }));
    } }] }).then(output => { const module = { exports: {} }; new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports); return module.exports.render; });
  return compiled;
}
const run = { id: 'run', dispatch_number: 'RUN-1', status: 'loaded', vehicle_name: 'Van', vehicle_warehouse_id: 'van-stock' };
const data = { dispatches: [run], activities: [], manifest: [{ id: 'line', dispatch_id: 'run', product_id: 'yogurt', loaded_quantity: 10 }], deliveryCustomers: [
  { dispatch_id: 'run', customer_id: 'a', customer_name: 'Damas Shop', location_id: '', address: 'Damas' },
  { dispatch_id: 'run', customer_id: 'b', customer_name: 'Mvogt Shop', location_id: 'branch', name: 'Branch' },
] };

test('receipt UI requires quantity acknowledgement and sends the displayed load snapshot', async () => {
  const render = await renderer(), runtime = hookRuntime(), calls = []; globalThis.__driverUI = runtime;
  runtime.invoke = async body => { calls.push(body); return { data: {} }; };
  try {
    const props = { data, run, onRefresh() {} };
    runtime.beforeRender(); render('receipt', props);
    assert.equal(runtime.buttons.find(row => row.label === 'Confirm load receipt').disabled, true);
    runtime.controls.find(row => row.type === 'checkbox').onChange({ target: { checked: true } });
    runtime.beforeRender(); render('receipt', props);
    assert.equal(runtime.buttons.find(row => row.label === 'Confirm load receipt').disabled, false);
    await runtime.buttons.find(row => row.label === 'Confirm load receipt').onClick();
    assert.equal(calls[0].action, 'driverReceiveLoad'); assert.equal(calls[0].loadSnapshot, driverLoadSnapshot(run, data.manifest));
    runtime.beforeRender(); const received = render('receipt', { ...props, data: { ...data, activities: [{ type: 'stock_received', dispatch_id: run.id, load_snapshot: calls[0].loadSnapshot }] } });
    assert.match(received, /Load receipt confirmed/); assert.equal(runtime.buttons.length, 0);
  } finally { runtime.cleanup(); delete globalThis.__driverUI; }
});

test('planner callbacks select customers, reorder stops and persist the driver plan without sales fields', async () => {
  const render = await renderer(), runtime = hookRuntime(), calls = []; globalThis.__driverUI = runtime;
  runtime.invoke = async body => { calls.push(body); return { data: {} }; };
  try {
    runtime.beforeRender(); const html = render('plan', { data });
    assert.match(html, /Damas Shop/); assert.match(html, /Mvogt Shop/); assert.doesNotMatch(html, /Issue goods|Record sale/);
    runtime.controls.filter(row => row.type === 'checkbox')[0].onChange();
    runtime.beforeRender(); render('plan', { data });
    runtime.controls.filter(row => row.type === 'checkbox')[1].onChange();
    runtime.beforeRender(); render('plan', { data });
    runtime.buttons.find(row => row['aria-label'] === 'Move stop down' && !row.disabled).onClick();
    runtime.beforeRender(); render('plan', { data });
    await runtime.buttons.find(row => row.label === 'Save delivery plan').onClick();
    assert.equal(calls[0].action, 'driverSaveDeliveryPlan');
    assert.deepEqual(calls[0].stops, [{ customer_id: 'b', location_id: 'branch' }, { customer_id: 'a', location_id: '' }]);
    assert.equal(calls[0].commercialId, undefined); assert.equal(calls[0].lines, undefined);
    runtime.beforeRender(); const saved = render('plan', { data }); assert.match(saved, /Delivery plan saved/);
  } finally { runtime.cleanup(); delete globalThis.__driverUI; }
});
