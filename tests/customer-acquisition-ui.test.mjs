import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import { fixture, fieldHandler, request, staff } from './helpers/commercial-supply.mjs';
const require = createRequire(import.meta.url);
async function renderer() {
  const output = await build({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Customer from './src/views/CustomerForm.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Customer));`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'customer-form-ui', setup(b) {
    b.onResolve({ filter: /^react$/ }, args => args.importer.endsWith('CustomerForm.jsx') ? { path: 'hooks', namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{if(tag==='select')globalThis.__customerFormUI.selects.push(props);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__customerFormUI.state('customer',v),useRef=v=>globalThis.__customerFormUI.ref('customer',v),useEffect=(fn,deps)=>globalThis.__customerFormUI.effect('customer',fn,deps);`, resolveDir: process.cwd() }));
    const mocks = {
      '@/api/erpClient': `export const erp=new Proxy({},{get:(_,key)=>globalThis.__customerFormUI.client[key]});`,
      '@/hooks/useCurrentUser': `export const useCurrentUser=()=>({isAdmin:true,loading:false});`,
      '@/lib/router': `export const Navigate=()=>null;export const useParams=()=>globalThis.__customerFormUI.params||({}),useNavigate=()=>path=>globalThis.__customerFormUI.navigation.push(path),useBack=()=>()=>{};`,
      '@/components/ui/button': `import React from 'react';export function Button({children,...props}){globalThis.__customerFormUI.capture('button',props,children);return React.createElement('button',props,children);}`,
      '@/components/ui/input': `import React from 'react';export const Input=props=>{globalThis.__customerFormUI.inputs.push(props);return React.createElement('input',props);};`,
      '@/components/ui/select': `import React from 'react';const Box=({children})=>React.createElement('div',null,children);export const Select=Box,SelectContent=Box,SelectItem=Box,SelectTrigger=Box,SelectValue=()=>null;`,
      '@/components/ui/tabs': `import React from 'react';const Box=({children})=>React.createElement('div',null,children);export const Tabs=Box,TabsContent=Box,TabsList=Box,TabsTrigger=Box;`,
      '@/components/ui/use-toast': `export const useToast=()=>({toast:value=>globalThis.__customerFormUI.notifications.push(value)});`,
      '@/components/customers/DeliverySetupFields': `export default props=>{globalThis.__customerFormUI.delivery=props;return null;};`,
    };
    b.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'leaf' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'leaf' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd() }));
  } }] });
  const module = { exports: {} }; new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports); return module.exports.render;
}
test('GM selects the finder on the real customer form; a failed save retains details and retry key, and duplicate clicks create only one customer', async () => {
  const runtime = hookRuntime(), render = await renderer(), handler = await fieldHandler(), { client, tables } = fixture(), calls = [];
  const previousWindow = globalThis.window; globalThis.window = { location: { search: '' } };
  client.auth.me = async () => ({ id: 'gm-login', role: 'admin', full_name: 'General Manager' }); client.entities.Employee.filter = async () => [];
  let fail = true;
  runtime.client = { entities: client.asServiceRole.entities, functions: { invoke: async (name, body) => {
    calls.push(body); if (body.action === 'registerManagedCustomer' && fail) throw Error('Connection interrupted');
    const response = await handler(request(body)), data = await response.json(); if (!response.ok) throw Error(data.error); return { data };
  } } };
  globalThis.__dailySupplyClient = client; globalThis.__customerFormUI = runtime;
  const draw = () => { runtime.beforeRender(); runtime.inputs = []; runtime.selects = []; return render(); };
  try {
    draw(); await runtime.flush(); draw(); await runtime.flush(); let html = draw();
    assert.match(html, /Acquired by \(employee\)/); assert.match(html, /Agent A/); assert.match(html, /No employee acquisition credit/);
    runtime.inputs[0].onChange({ target: { value: 'Admin registered partner' } }); runtime.inputs[2].onChange({ target: { value: '699123456' } });
    runtime.selects.find(select => select.id === 'customer-acquired-by').onChange({ target: { value: staff.id } }); draw();
    await runtime.buttons.find(button => button.label.trim() === 'Save').onClick();
    html = draw(); assert.match(html, /Connection interrupted/); assert.equal(runtime.inputs[0].value, 'Admin registered partner');
    assert.equal(runtime.selects[0].value, staff.id); assert.equal(tables.Customer.length, 1);
    fail = false; const save = runtime.buttons.find(button => button.label.trim() === 'Save'); await Promise.all([save.onClick(), save.onClick()]);
    assert.deepEqual(runtime.navigation, ['/customers']); assert.equal(tables.Customer.length, 2);
    const writes = calls.filter(body => body.action === 'registerManagedCustomer'); assert.equal(writes.length, 2); assert.equal(writes[0].requestKey, writes[1].requestKey);
    assert.equal(writes[1].acquiredById, staff.id); assert.equal(writes[1].customer.acquired_by_id, undefined);
    assert.equal(tables.Customer[1].registered_by_id, 'gm-login'); assert.equal(tables.Customer[1].acquired_by_id, staff.id);
    assert.equal(tables.Customer[1].acquisition_verified, 'pending'); assert.equal(tables.JournalEntry.length, 0);
  } finally { runtime.cleanup(); globalThis.window = previousWindow; delete globalThis.__customerFormUI; delete globalThis.__dailySupplyClient; }
});
test('editing a customer displays acquisition history without allowing the finder to be overwritten by a routine edit', async () => {
  const runtime = hookRuntime(), render = await renderer(), { client, tables } = fixture();
  Object.assign(tables.Customer[0], { acquired_by_id: staff.id, acquired_by_name: staff.full_name, acquisition_verified: 'verified_unique', registered_by_name: 'Original admin', acquisition_date: '2026-10-21' });
  tables.Invoice = []; client.asServiceRole.entities.Invoice = { filter: async () => [] }; client.asServiceRole.entities.Payment = { filter: async () => [] };
  runtime.params = { id: 'customer-a' }; runtime.client = { entities: client.asServiceRole.entities };
  globalThis.__customerFormUI = runtime;
  const draw = () => { runtime.beforeRender(); runtime.inputs = []; runtime.selects = []; return render(); };
  try {
    draw(); await runtime.flush(); const html = draw(); assert.match(html, /Agent A/); assert.match(html, /Original admin/); assert.match(html, /Acquisition history is preserved/);
    assert.equal(runtime.selects.some(select => select.id === 'customer-acquired-by'), false);
    runtime.inputs[0].onChange({ target: { value: 'Updated business name' } }); draw(); await runtime.buttons.find(button => button.label.trim() === 'Save').onClick();
    assert.equal(tables.Customer[0].acquired_by_id, staff.id); assert.equal(tables.Customer[0].registered_by_name, 'Original admin'); assert.equal(tables.Customer[0].business_name, 'Updated business name');
  } finally { runtime.cleanup(); delete globalThis.__customerFormUI; }
});
