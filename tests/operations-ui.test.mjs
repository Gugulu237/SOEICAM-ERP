import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { dashboardPreview } from '../src/lib/dashboard-preview.js';
const require = createRequire(import.meta.url);

test('Operations dashboard and sidebar expose the requested features, and sales stays a read-only register', async () => {
  const output = await build({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Home from './src/components/home/ProductionHome.jsx';import Sidebar from './src/components/layout/AppSidebar.jsx';import Sales from './src/views/Sales.jsx';import {modulesForRole} from './src/lib/appModules.js';export const modules=modulesForRole('production_manager');export const render=(name,props)=>renderToStaticMarkup(React.createElement({home:Home,sidebar:Sidebar,sales:Sales}[name],props));`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, format: 'cjs', platform: 'node', write: false, plugins: [{ name: 'operations-ui', setup(b) {
    b.onResolve({ filter: /^react$/ }, args => args.importer.endsWith('CompanySalesRegister.jsx') ? { path: 'hooks', namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /^hooks$/, namespace: 'fixture' }, () => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=initial=>[initial===null?globalThis.__operationsUI.sales:typeof initial==='function'?initial():initial,()=>{}];export const useEffect=()=>{};`, resolveDir: process.cwd() }));
    const mocks = {
      '@/hooks/useCurrentUser': "export const useCurrentUser=()=>({role:'production_manager',isAdmin:false,loading:false});",
      '@/lib/AuthContext': "export const useAuth=()=>({logout:()=>{}});",
      '@/lib/router': `import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{href:to,...props},children);export const useNavigate=()=>()=>{};export const useLocation=()=>({pathname:'/'});export const useSearchParams=()=>[new URLSearchParams(),()=>{}];`,
      '@/components/shared/DataTable': `import React from 'react';export default props=>{globalThis.__operationsUI.table=props;return React.createElement('div',null,'Posted company sales register');};`,
      '@/api/erpClient': "export const erp={entities:new Proxy({},{get:()=>{throw Error('Sales view attempted a raw table read');}})};",
    };
    b.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks,args.path) ? { path: args.path, namespace: 'leaf' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'leaf' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd() }));
  } }] });
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
  globalThis.__operationsUI={sales:{totals:{count:1,net:1000,tax:0,sales:1000},rows:[{id:'sale',document_number:'INV-01',sales_order_id:'order'}]}};
  try {
    const paths=['/sales','/inventory','/manufacturing','/distribution'];
    const {render,modules}=module.exports;
    const home=render('home',{data:dashboardPreview('production_manager'),preview:false});
    for(const title of ['Company sales','Warehouse','Production board','Quality control']) assert.ok(home.includes(title),title);
    for(const path of paths.filter(path=>!path.startsWith('/commercial'))) assert.ok(modules.some(m=>m.path===path),path);
    assert.equal(modules.some(module=>module.key==='commercial_workspace'),false,'management uses reports rather than the Commercial main widget');
    const sidebar=render('sidebar');for(const path of paths)assert.ok(sidebar.includes(`href="${path}"`),path);
    assert.doesNotMatch(sidebar,/Commercial reports/);
    assert.equal(sidebar.includes('href="/commercial"'),false,'management links open reports rather than an employee operational workspace');
    assert.equal(sidebar.includes('href="/commercial-performance"'),false);
    assert.equal(sidebar.includes('href="/field-sales"'),false);
    assert.equal(modules.filter(m=>['/quality','/expiry','/traceability'].includes(m.path)).length,0);
    assert.equal(sidebar.includes('href="/expiry"'),false);assert.equal(sidebar.includes('href="/traceability"'),false);
    assert.equal(sidebar.includes('href="/team-workspaces"'),false);assert.equal(sidebar.includes('href="/payroll"'),false);
    const sales=render('sales');assert.match(sales,/Posted company sales register/);assert.equal(sales.includes('New Sale'),false);
    assert.equal(globalThis.__operationsUI.table.onRowClick,undefined,'read-only rows cannot open sale editing or GM approval pages');
  } finally {delete globalThis.__operationsUI;}
});
