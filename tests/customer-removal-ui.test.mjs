import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require = createRequire(import.meta.url);

async function renderer() {
  const output = await build({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Removal from './src/components/customers/CustomerRemoval.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Removal,props));`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'customer-removal-fixture', setup(b) {
    b.onResolve({ filter: /^react$/ }, args => args.importer.endsWith('CustomerRemoval.jsx') ? { path: 'hooks', namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{if(tag==='form')globalThis.__removalUI.submit=props.onSubmit;return React.createElement(tag,props,...children);}};export const useState=value=>globalThis.__removalUI.state('removal',value),useRef=value=>globalThis.__removalUI.ref('removal',value);`, resolveDir: process.cwd() }));
    const mocks = {
      '@/api/erpClient': `export const invalidateERPReads=()=>globalThis.__removalUI.invalidations++;`,
      '@/components/ui/button': `import React from 'react';export const Button=({children,...props})=>{globalThis.__removalUI.capture('button',props,children);return React.createElement('button',props,children);};`,
      '@/components/ui/textarea': `import React from 'react';export const Textarea=props=>{globalThis.__removalUI.reason=props;return React.createElement('textarea',props);};`,
      '@/components/ui/dialog': `import React from 'react';export const Dialog=({open,children})=>open?children:null;export const DialogContent=({children})=>React.createElement('div',null,children);export const DialogHeader=DialogContent,DialogFooter=DialogContent;export const DialogTitle=({children})=>React.createElement('h2',null,children);export const DialogDescription=({children})=>React.createElement('p',null,children);`,
    };
    b.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks,args.path) ? { path: args.path, namespace: 'leaf' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'leaf' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd() }));
  } }] });
  const module = { exports: {} };new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);return module.exports.render;
}

test('customer edit deletion requires a reason, blocks duplicate submissions, and retries with the same confirmation key', async () => {
  const render=await renderer(),runtime=hookRuntime(),previousFetch=globalThis.fetch;
  globalThis.__removalUI=runtime;runtime.invalidations=0;
  const calls=[],completed=[],customer={id:'sample-customer',business_name:'Sample customer',customer_lifecycle_revision:2};
  let fail=true,release;
  globalThis.fetch=async(url,options)=>{calls.push({url,...JSON.parse(options.body)});await new Promise(done=>{release=done;});return {ok:!fail,json:async()=>fail?{error:'Connection interrupted'}:{customer:{...customer,customer_removed_at:'2026-10-24T12:00:00Z'}}};};
  const draw=()=>{runtime.beforeRender();return render({customer,onDone:value=>completed.push(value)});};
  try {
    draw();runtime.buttons.find(b=>b.label==='Delete customer').onClick();let html=draw();
    assert.match(html,/records are retained/);assert.equal(runtime.buttons.find(b=>b.type==='submit').disabled,true);
    await runtime.submit({preventDefault(){}});assert.equal(calls.length,0);
    runtime.reason.onChange({target:{value:'Duplicate customer'}});draw();
    const pending=runtime.submit({preventDefault(){}});await runtime.submit({preventDefault(){}});assert.equal(calls.length,1);
    draw();assert.equal(runtime.buttons.find(b=>b.label==='Cancel').disabled,true);
    release();await pending;html=draw();assert.match(html,/Connection interrupted/);assert.equal(runtime.reason.value,'Duplicate customer');assert.equal(completed.length,0);
    fail=false;const retry=runtime.submit({preventDefault(){}});release();await retry;draw();
    assert.equal(calls.length,2);assert.equal(calls[0].requestKey,calls[1].requestKey);assert.equal(calls[1].revision,2);assert.equal(calls[1].action,'remove');
    assert.equal(completed.length,1);assert.ok(completed[0].customer_removed_at);assert.equal(runtime.invalidations,1);
  } finally {runtime.cleanup();globalThis.fetch=previousFetch;delete globalThis.__removalUI;}
});
