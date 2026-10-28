import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require = createRequire(import.meta.url);
let compiled;
async function renderer() {
  if (compiled) return compiled;
  const mocks = {
    '@/hooks/useCurrentUser': 'export const useCurrentUser=()=>globalThis.__signinUI.session;',
    '@/lib/role-permission-sync': 'export const notifyRoleChanges=()=>globalThis.__signinUI.notified++;',
    '@/components/ui/button': "import React from 'react';export const Button=({children,variant,size,...props})=>{globalThis.__signinUI.capture('button',props,children);return React.createElement('button',props,children);};",
    '@/components/ui/input': "import React from 'react';export const Input=props=>{globalThis.__signinUI.inputs.push(props);return React.createElement('input',props);};",
    '@/components/ui/dialog': "import React from 'react';export const Dialog=({open,children,onOpenChange})=>{globalThis.__signinUI.dialog={open,onOpenChange};return open?children:null;};export const DialogContent=({children,...props})=>React.createElement('div',props,children),DialogHeader=DialogContent,DialogTitle=DialogContent,DialogDescription=DialogContent;",
  };
  const output = await build({ stdin: { contents: "import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Action from './src/components/employees/EmployeeSignInAction.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Action,props));", resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'signin-ui', setup(b) {
    b.onResolve({ filter: /^react$/ }, args => args.importer.endsWith('EmployeeSignInAction.jsx') ? { path: 'hooks', namespace: 'signin-hooks' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'signin-hooks' }, () => ({ contents: "import React from " + JSON.stringify(require.resolve('react')) + ";export default {...React,createElement:(tag,props,...children)=>{globalThis.__signinUI.capture(tag,props,children);if(tag==='form')globalThis.__signinUI.form=props;return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__signinUI.state('signin',v),useRef=v=>globalThis.__signinUI.ref('signin',v),useEffect=(fn,deps)=>globalThis.__signinUI.effect('signin',fn,deps);", resolveDir: process.cwd() }));
    b.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'signin-mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'signin-mock' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd() }));
  } }] });
  const mod = { exports: {} }; new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, mod, mod.exports);
  return compiled = mod.exports.render;
}
const account = { employeeId: 'staff', employeeName: 'Staff', email: 'old@example.test', suggestedEmail: 'old@example.test', revision: 'a'.repeat(64), canChange: true, blockedReason: '' };
async function fixture() {
  const runtime = hookRuntime(), render = await renderer(), saved = [];
  runtime.session = { role: 'admin' }; runtime.notified = 0; runtime.inputs = [];
  globalThis.__signinUI = runtime;
  const draw = () => { runtime.beforeRender(); runtime.inputs = []; return render({ employee: { id: 'staff', full_name: 'Staff' }, onSaved: employee => saved.push(employee) }); };
  const click = label => { const control = runtime.buttons.find(row => row.label === label); assert.ok(control, label); return control.onClick(); };
  const submit = () => runtime.form.onSubmit({ preventDefault() {} });
  const checkbox = () => runtime.controls.find(row => row.type === 'checkbox');
  const edit = () => {
    runtime.inputs.find(row => row.type === 'email').onChange({ target: { value: 'NEW@example.test' } });
    runtime.inputs.find(row => row.minLength === 3).onChange({ target: { value: 'Employee changed email' } });
    draw(); checkbox().onChange({ target: { checked: true } }); draw();
  };
  return { runtime, draw, click, submit, edit, saved };
}

test('sign-in dialog loads current mapping, requires explicit confirmation, and safely retries a failed save', async () => {
  const f = await fixture(), original = globalThis.fetch, calls = []; let resolvePost;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options, body: options.body && JSON.parse(options.body) });
    if (options.method === 'POST') return new Promise(resolve => { resolvePost = resolve; });
    return Response.json(account);
  };
  try {
    f.draw(); assert.equal(calls.length, 0); f.click('Change sign-in'); f.draw(); await f.runtime.flush();
    let html = f.draw(); assert.match(html, /old@example.test/); assert.match(html, /max-w-md/);
    assert.equal(calls[0].options.cache, 'no-store');
    assert.equal(f.runtime.buttons.find(row => row.type === 'submit').disabled, true);
    f.edit(); assert.equal(f.runtime.buttons.find(row => row.type === 'submit').disabled, false);
    const saving = f.submit(); f.submit();
    assert.equal(calls.filter(row => row.body).length, 1);
    assert.equal(calls[1].body.email, 'new@example.test'); assert.equal(calls[1].body.confirmed, true);
    f.runtime.dialog.onOpenChange(false); f.draw(); assert.equal(f.runtime.dialog.open, true);
    resolvePost(Response.json({ error: 'Please retry' }, { status: 503 })); await saving;
    html = f.draw(); assert.match(html, /Please retry/); assert.equal(f.runtime.inputs.find(row => row.type === 'email').value, 'NEW@example.test');
    const retry = f.submit(); assert.equal(calls[2].body.requestKey, calls[1].body.requestKey);
    resolvePost(Response.json({ employee: { id: 'staff', user_id: 'new-login' } })); await retry;
    f.draw(); assert.equal(f.runtime.dialog.open, false); assert.equal(f.runtime.notified, 1); assert.equal(f.saved[0].user_id, 'new-login');
  } finally { f.runtime.cleanup(); globalThis.fetch = original; delete globalThis.__signinUI; }
});

test('blocked mappings have no save form, denied reads can be retried, and staff cannot open the control', async () => {
  const f = await fixture(), original = globalThis.fetch; let deny = true;
  globalThis.fetch = async () => deny ? Response.json({ error: 'Account unavailable' }, { status: 503 }) : Response.json({ ...account, canChange: false, blockedReason: 'Ask another General Manager' });
  try {
    f.draw(); f.click('Change sign-in'); f.draw(); await f.runtime.flush();
    assert.match(f.draw(), /Account unavailable/); assert.equal(f.runtime.inputs.length, 0);
    deny = false; await f.click('Reload account'); assert.match(f.draw(), /Ask another General Manager/);
    assert.equal(f.runtime.buttons.some(row => row.type === 'submit'), false);
    f.runtime.session.role = 'cashier'; assert.equal(f.draw(), '');
  } finally { f.runtime.cleanup(); globalThis.fetch = original; delete globalThis.__signinUI; }
});

test('changing the proposed email clears consent before saving another account', async () => {
  const f = await fixture(), original = globalThis.fetch;
  globalThis.fetch = async () => Response.json(account);
  try {
    f.draw(); f.click('Change sign-in'); f.draw(); await f.runtime.flush(); f.draw(); f.edit();
    f.runtime.inputs.find(row => row.type === 'email').onChange({ target: { value: 'different@example.test' } }); f.draw();
    assert.equal(f.runtime.buttons.find(row => row.type === 'submit').disabled, true);
    assert.equal(f.runtime.controls.find(row => row.type === 'checkbox').checked, false);
  } finally { f.runtime.cleanup(); globalThis.fetch = original; delete globalThis.__signinUI; }
});
