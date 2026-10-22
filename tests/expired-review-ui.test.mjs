import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require = createRequire(import.meta.url);
async function renderer() {
  const output = await build({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Review from './src/components/field/ExpiredExchangeReview.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Review));`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'review-ui', setup(b) {
    b.onResolve({ filter: /^react$/ }, args => args.importer.endsWith('ExpiredExchangeReview.jsx') ? { path: 'hooks', namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__reviewUI.state('review',v),useRef=v=>globalThis.__reviewUI.ref('review',v),useEffect=(fn,deps)=>globalThis.__reviewUI.effect('review',fn,deps);`, resolveDir: process.cwd() }));
    const mocks = {
      '@/lib/field-ops': `export const invokeFieldOps=body=>globalThis.__reviewUI.invoke(body),errorMessage=e=>e.message,receiptUrl=async uri=>uri;`,
      '@/components/ui/button': `import React from 'react';export const Button=({children,...props})=>{globalThis.__reviewUI.capture('button',props,children);return React.createElement('button',props,children);};`,
      '@/components/ui/textarea': `import React from 'react';export const Textarea=props=>{globalThis.__reviewUI.textarea=props;return React.createElement('textarea',props);};`,
    };
    b.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'leaf' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'leaf' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd() }));
  } }] });
  const module = { exports: {} }; new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports); return module.exports.render;
}
const row = { id: 'request', record_number: 'ER-1', customer_name: 'Partner', product_name: 'YOLA', quantity: 2, unit: 'ea', replace_now: true, commercial_name: 'Original agent', reported_date: '2026-10-21', returned_expiry_date: '2026-10-01', receipt_file_uris: ['private/proof'], receipt_reference: 'SIGNED-1' };
test('review retains evidence and notes after a failure and suppresses duplicate approval clicks', async () => {
  const runtime = hookRuntime(), render = await renderer(), calls = []; globalThis.__reviewUI = runtime;
  let fail = true;
  runtime.invoke = async body => { calls.push(body); if (body.action === 'expiredReturnReviewQueue') return { data: { requests: [row] } }; await new Promise(resolve => setImmediate(resolve)); if (fail) throw Error('Accounting unavailable'); return { data: { request: { status: 'verified' } } }; };
  const draw = () => { runtime.beforeRender(); return render(); };
  try {
    draw(); await runtime.flush(); assert.match(draw(), /Original agent|Evidence photo/);
    runtime.textarea.onChange({ target: { value: 'Quantity and signed receipt match.' } }); draw();
    await runtime.buttons.find(button => button.label === 'Verify & post').onClick();
    assert.match(draw(), /Accounting unavailable/); assert.equal(runtime.textarea.value, 'Quantity and signed receipt match.');
    assert.match(draw(), /SIGNED-1/);
    fail = false; const approve = runtime.buttons.find(button => button.label === 'Verify & post'); await Promise.all([approve.onClick(), approve.onClick()]);
    const html = draw(); assert.match(html, /updated once/); assert.doesNotMatch(html, /SIGNED-1/);
    const writes = calls.filter(body => body.action === 'verifyExpiredReturn'); assert.equal(writes.length, 2); assert.equal(writes[1].requestId, 'request'); assert.equal(writes[1].reviewNote, 'Quantity and signed receipt match.');
  } finally { runtime.cleanup(); delete globalThis.__reviewUI; }
});
test('rejection requires a reason before any request is sent and removes only the reviewed request', async () => {
  const runtime = hookRuntime(), render = await renderer(), calls = []; globalThis.__reviewUI = runtime;
  runtime.invoke = async body => { calls.push(body); return { data: body.action === 'expiredReturnReviewQueue' ? { requests: [row] } : { request: { status: 'rejected' } } }; };
  const draw = () => { runtime.beforeRender(); return render(); };
  try {
    draw(); await runtime.flush(); draw(); await runtime.buttons.find(button => button.label === 'Reject request').onClick();
    assert.match(draw(), /Enter a reason/); assert.equal(calls.length, 1);
    runtime.textarea.onChange({ target: { value: 'Wrong expiry photo.' } }); draw(); await runtime.buttons.find(button => button.label === 'Reject request').onClick();
    assert.equal(calls[1].action, 'rejectExpiredReturn'); assert.equal(calls[1].reviewNote, 'Wrong expiry photo.');
    assert.match(draw(), /Stock and accounting are unchanged/);
  } finally { runtime.cleanup(); delete globalThis.__reviewUI; }
});
