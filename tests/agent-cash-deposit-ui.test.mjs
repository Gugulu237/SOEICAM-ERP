import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import { fixture, date } from './helpers/cashier.mjs';
import { commercialAction } from '../src/server/domain/commercial-workspace.js';
import { employeeWorkspaceAction } from '../src/server/domain/employee-workspace.js';

test('inline agent deposit form retains a failed report and shows pending confirmation without settling cash', async () => {
  const require = createRequire(import.meta.url);
  const output = await build({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Panel from './src/components/field/CommercialCashSettlement.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Panel,props));`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'agent-deposit-ui', setup(b) {
      b.onResolve({ filter: /^react$/ }, args => /(?:CommercialCashSettlement|AgentCashDepositDialog)\.jsx$/.test(args.importer) ? { path: args.importer, namespace: 'hooks' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'hooks' }, args => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(args.path)};export default {...React,createElement:(tag,props,...children)=>{globalThis.__depositUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__depositUI.state(key,v);export const useRef=v=>globalThis.__depositUI.ref(key,v);export const useEffect=(fn,deps)=>globalThis.__depositUI.effect(key,fn,deps);`, resolveDir: process.cwd() }));
      const mocks = {
        '@/api/erpClient': 'export const erp={functions:{invoke:(name,body)=>globalThis.__depositUI.invoke(name,body)}};',
        '@/components/ui/button': `import React from 'react';export function Button({children,...props}){globalThis.__depositUI.capture('button',props,children);return React.createElement('button',props,children);}`,
        '@/components/ui/input': `import React from 'react';export function Input(props){globalThis.__depositUI.capture('input',props,[]);return React.createElement('input',props);}`,
        '@/components/ui/dialog': `import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogFooter=Dialog;`,
      };
      b.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'leaf' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'leaf' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd() }));
    } }] });
  const module = { exports: {} }; new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports);
  const f = await fixture(), s = f.entities;
  const agent = await s.Employee.create({ role: 'commercial', status: 'active', full_name: 'Agent UI', user_id: 'agent-ui-login' });
  await s.CashCollection.create({ commercial_id: agent.id, commercial_name: agent.full_name, collection_date: date, method: 'cash', status: 'held_by_commercial', amount_collected: 1500, received_amount: 0, outstanding_amount: 1500 });
  const user = { id: 'agent-ui-login', role: 'user' }, client = { ...f.client, entities: { Employee: { filter: async () => [agent] } } };
  const r = hookRuntime(), capture = r.capture.bind(r); r.inputs = []; r.selects = [];
  r.capture = (tag, props, children) => { capture(tag, props, children); if (tag === 'input') r.inputs.push(props); if (tag === 'select') r.selects.push(props); if (tag === 'form') r.submit = props.onSubmit; };
  let fail = true, refreshes = 0; const calls = [];
  r.invoke = async (name, body) => { if (body.action === 'commercialDepositCash') { calls.push(body); if (fail) throw Error('Temporary connection error'); } return { data: await commercialAction(client, user, body) }; };
  globalThis.__depositUI = r;
  const props = { days: (await employeeWorkspaceAction(client, user, { action: 'employeeDashboard' })).cashDays, ready: true, commercialId: agent.id, commercialName: agent.full_name, onRefresh: () => refreshes++ };
  const draw = () => { r.beforeRender(); r.inputs = []; r.selects = []; return module.exports.render(props); };
  try {
    draw(); r.buttons.find(b => b.label === 'Mark cash as deposited').onClick(); draw(); await r.flush(); draw();
    r.inputs.find(i => i.type === 'checkbox').onChange({ target: { checked: true } });
    draw(); await r.submit({ preventDefault() {} }); assert.match(draw(), /Temporary connection error/); assert.equal(refreshes, 0);
    fail = false; await r.submit({ preventDefault() {} });
    props.days = (await employeeWorkspaceAction(client, user, { action: 'employeeDashboard' })).cashDays;
    const html = draw(); assert.match(html, /Awaiting cashier confirmation/); assert.match(html, /Deposit reported; awaiting cashier/);
    assert.equal(refreshes, 1); assert.equal(calls[0].requestKey, calls[1].requestKey); assert.equal(calls[1].amount, 1500);
    assert.equal((await s.TreasuryAccount.get('till')).balance, 100000); assert.equal((await s.JournalEntry.list()).length, 0);
    props.days = [{ ...props.days[0], depositable: 1500, status: 'outstanding' }]; props.preview = true; draw();
    assert.equal(r.buttons.find(b => b.label === 'Mark cash as deposited').disabled, true);
  } finally { r.cleanup(); delete globalThis.__depositUI; }
});
