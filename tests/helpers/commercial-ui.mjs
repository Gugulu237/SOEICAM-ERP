import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);

// Run real dashboard/form callbacks and async loading effects without a browser.
// Only platform hooks, session/transport and leaf input widgets are fixtures.
export async function commercialUI() {
  const output = await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Dashboard from './src/components/home/CommercialDashboard.jsx'; import Hotesse from './src/components/outlets/HotesseWorkspace.jsx'; export const render = (props,kind='dashboard') => renderToStaticMarkup(React.createElement(kind==='hotesse'?Hotesse:Dashboard, props));`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'commercial-flow', setup(b) {
      b.onResolve({ filter: /^react$/ }, args => /(?:CommercialDashboard|FieldSaleForm|HotesseWorkspace)\.jsx$/.test(args.importer) ? { path: args.importer.endsWith('FieldSaleForm.jsx') ? 'form' : args.importer.endsWith('HotesseWorkspace.jsx') ? 'hotesse' : 'dashboard', namespace: 'flow-hooks' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'flow-hooks' }, ({ path: key }) => ({ contents: `
        import React from ${JSON.stringify(require.resolve('react'))};
        export default {...React,createElement:(tag,props,...children)=>{globalThis.__commercialUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};
        export const useState = value => globalThis.__commercialUI.state(${JSON.stringify(key)},value);
        export const useRef = value => globalThis.__commercialUI.ref(${JSON.stringify(key)},value);
        export const useEffect = (fn,deps) => globalThis.__commercialUI.effect(${JSON.stringify(key)},fn,deps);
        export const useMemo = fn => fn();
      `, resolveDir: process.cwd() }));
      const mocks = {
        '@/lib/router': `export const useNavigate=()=>path=>globalThis.__commercialUI.navigation.push(path); export const useParams=()=>({}); export const useSearchParams=()=>[new URLSearchParams()];`,
        '@/hooks/useCurrentUser': 'export const useCurrentUser=()=>globalThis.__commercialUI.session;',
        '@/api/erpClient': 'export const erp=new Proxy({}, {get:(_,key)=>globalThis.__commercialUI.client[key]});',
        '@/components/ui/use-toast': 'export const useToast=()=>({toast:value=>globalThis.__commercialUI.notifications.push(value)});',
        '@/components/ui/button': `import React from 'react';export function Button({children,onClick,...props}){globalThis.__commercialUI.capture('button',{...props,onClick},children);return React.createElement('button',props,children);}`,
        '@/components/shared/ProductCatalog': 'export default function Catalog(props){globalThis.__commercialUI.catalog=props;return null;}',
        '@/components/field/ReceiptUploader': 'export default function Receipt(props){globalThis.__commercialUI.receipt=props;return null;}',
        '@/components/field/CustomerPicker': 'export default function Customer(props){globalThis.__commercialUI.customer=props;return null;}',
      };
      b.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'flow-mock' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'flow-mock' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd() }));
      // Relative imports use the same leaf widgets as the aliased imports.
      b.onResolve({ filter: /^\.\/ReceiptUploader$/ }, () => ({ path: '@/components/field/ReceiptUploader', namespace: 'flow-mock' }));
    } }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports);
  return module.exports.render;
}

export function hookRuntime() {
  const slots = {}, cursors = {}, effects = [];
  const next = key => { const index = cursors[key] || 0; cursors[key] = index + 1; slots[key] ||= []; return [slots[key], index]; };
  const text = value => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' ? value : '';
  return {
    buttons: [], navigation: [], notifications: [],
    capture(tag, props, children) { if (tag === 'button') this.buttons.push({ ...props, label: text(children) }); },
    state(key, initial) { const [rows, i] = next(key); rows[i] ||= { value: typeof initial === 'function' ? initial() : initial }; return [rows[i].value, value => { rows[i].value = typeof value === 'function' ? value(rows[i].value) : value; }]; },
    ref(key, initial) { const [rows, i] = next(key); return rows[i] ||= { current: initial }; },
    effect(key, callback, deps) { const [rows, i] = next(key); if (!rows[i] || !deps || deps.some((value, j) => !Object.is(value, rows[i].deps?.[j]))) { rows[i]?.cleanup?.(); rows[i] = { deps }; effects.push(() => { rows[i].cleanup = callback(); }); } },
    beforeRender() { Object.keys(cursors).forEach(key => { cursors[key] = 0; }); this.buttons = []; },
    async flush() { for (const callback of effects.splice(0)) callback(); await new Promise(resolve => setImmediate(resolve)); },
    cleanup() { for (const rows of Object.values(slots)) for (const row of rows) row?.cleanup?.(); },
  };
}
