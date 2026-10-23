import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {canViewAllCommercialReports} from '../src/lib/operations-access.js';
const require=createRequire(import.meta.url);

async function uiBundle() {
  const result=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
    import Driver from './src/components/home/DriverDashboard.jsx';import Hotesse from './src/components/outlets/HotesseWorkspace.jsx';
    import Manager from './src/components/home/ManagerHome.jsx';import Reports from './src/components/home/ManagementQuickReports.jsx';
    import Form from './src/views/FieldSaleForm.jsx';import {modulesForRole} from './src/lib/appModules.js';import Notice from './src/components/home/ReadOnlyWorkspaceNotice.jsx';
    export {modulesForRole};export const render=(kind,props={})=>renderToStaticMarkup(React.createElement({driver:Driver,hotesse:Hotesse,manager:Manager,reports:Reports,form:Form,notice:Notice}[kind],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'management-fixtures',setup(b){
      const mocks={
        '@/api/erpClient':`export const erp={};`,
        '@/lib/router':`import React from 'react';export const Navigate=()=>null;export const useNavigate=()=>()=>{};export const useParams=()=>({});export const useSearchParams=()=>[new URLSearchParams(globalThis.__reportParams||''),()=>{}];export const Link=({to,children,...props})=>React.createElement('a',{href:to,...props},children);`,
        '@/hooks/useCurrentUser':`export const useCurrentUser=()=>({role:'admin',isAdmin:true,employee:null,loading:false});`,
        '@/components/ui/use-toast':`export const useToast=()=>({toast(){}});`,
        'next/dynamic':`export default ()=>()=>null;`,
      };
      b.onResolve({filter:/^react$/},args=>args.importer.endsWith('DriverDashboard.jsx')?{path:'driver-hooks',namespace:'report-hooks'}:undefined);
      b.onLoad({filter:/.*/,namespace:'report-hooks'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=value=>[globalThis.__driverState++===0?'run-a':value,()=>{}];`,resolveDir:process.cwd()}));
      b.onResolve({filter:/./},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'report-mocks'}:undefined);
      b.onLoad({filter:/.*/,namespace:'report-mocks'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
    }}]});
  const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);return module.exports;
}

test('only explicitly authorized Supply Chain management gains the cross-agent report scope',()=>{
  assert.equal(canViewAllCommercialReports('admin'),true);
  assert.equal(canViewAllCommercialReports('production_manager'),true);
  assert.equal(canViewAllCommercialReports('warehouse_manager'),false);
  assert.equal(canViewAllCommercialReports('warehouse_manager',{assigned_role:'supply_chain_manager',allowed_modules:[]}),false);
  assert.equal(canViewAllCommercialReports('warehouse_manager',{assigned_role:'warehouse_manager',allowed_modules:['sales_reports']}),false);
  assert.equal(canViewAllCommercialReports('warehouse_manager',{assigned_role:'supply_chain_manager',allowed_modules:['sales_reports']}),true);
});

test('shared role previews distinguish department figures from individual employee reporting',async()=>{
  const ui=await uiBundle();
  const shared=ui.render('notice',{sharedDepartment:true});
  assert.match(shared,/Shared department figures/);
  assert.match(shared,/not an individual employee/);
  assert.doesNotMatch(shared,/work recorded by this employee/);
  const individual=ui.render('notice',{employeeName:'Original reporting employee'});
  assert.match(individual,/Original reporting employee/);
  assert.match(individual,/Employee operations must be submitted from their own account/);
  assert.doesNotMatch(individual,/Shared department figures/);
});

test('manager launcher omits personal Commercial tools and exposes a separate Quick reports section',async()=>{
  const ui=await uiBundle();
  try {
    for(const role of ['admin','production_manager','warehouse_manager'])assert.equal(ui.modulesForRole(role).some(row=>row.key==='commercial_workspace'),false);
    assert.equal(ui.modulesForRole('commercial').some(row=>row.key==='commercial_workspace'),true);
    globalThis.__reportParams='';
    const overview=ui.render('manager',{data:{date:'2026-10-21'}});
    assert.doesNotMatch(overview,/aria-label="Management roles"/);
    assert.match(overview,/View employee dashboards/);
    globalThis.__reportParams='section=quick-reports';
    const report=ui.render('manager',{data:{date:'2026-10-21'}});
    assert.match(report,/Employee reports/);
    assert.match(report,/href="\/team-workspaces\?section=reports"/);
    assert.doesNotMatch(report,/Field POS|Record sale/);
  }finally{delete globalThis.__reportParams;}
});

test('driver management detail keeps recorded runs and outcomes but removes all submission controls',async()=>{
  const ui=await uiBundle();
  const props={preview:true,data:{employee:{id:'driver-a'},date:'2026-10-21',dispatches:[{id:'run-a',status:'in_transit',route_name:'Verified route',vehicle_name:'Van A'}],stops:[{id:'stop',dispatch_id:'run-a',customer_name:'Reported customer',order_number:'SO-1'}],activities:[{id:'report',dispatch_id:'run-a',driver_id:'driver-a',order_id:'stop',type:'delivery_attempted',recorded_at:'2026-10-21T10:00:00Z',notes:'Original driver note'}]}};
  try {
    globalThis.__driverState=0;
    const report=ui.render('driver',props);
    assert.match(report,/Verified route/);assert.match(report,/Reported customer/);assert.match(report,/Original driver note/);
    assert.doesNotMatch(report,/Start run|Report an issue|>Back at base<|Record delivery outcome|Record another delivery attempt/);
    globalThis.__driverState=0;
    const own=ui.render('driver',{...props,preview:false});
    assert.match(own,/Report an issue/);assert.match(own,/Record another delivery attempt/);
  }finally{delete globalThis.__driverState;}
});

test('Hotesse management preview preserves shelf facts without daily-report or product-entry controls',async()=>{
  const ui=await uiBundle();
  const data={date:'2026-10-21',locations:[{id:'outlet',customer_name:'Recorded outlet',name:'Main shelf'}],outletProducts:{outlet:[{id:'product',name:'YOLA stock',display_quantity:7,opening_quantity:7,supplied_quantity:9}]}};
  const report=ui.render('hotesse',{data,preview:true});
  assert.match(report,/Recorded outlet/);assert.match(report,/YOLA stock/);assert.match(report,/View reported stock for/);
  assert.doesNotMatch(report,/Record daily report|Record daily report for|<form/);
  assert.match(ui.render('hotesse',{data,preview:false}),/Record daily report/);
});
