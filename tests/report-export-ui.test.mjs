import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
async function renderer(kind) {
  const component=kind==='controls'?'./src/components/shared/ReportExport.jsx':kind==='table'?'./src/components/shared/DataTable.jsx':kind==='position'?'./src/components/accounting/AccountPosition.jsx':'./src/components/accounting/IncomeStatement.jsx';
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Component from ${JSON.stringify(component)};export const render=props=>renderToStaticMarkup(React.createElement(Component,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'export-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>a.importer.endsWith('ReportExport.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__reportUI.state('export',v),useRef=v=>globalThis.__reportUI.ref('export',v);`,resolveDir:process.cwd()}));
    const mocks={
      '@/lib/report-document':`export const downloadWorkbook=r=>globalThis.__reportUI.download(r);export const showPrintReport=(p,r)=>globalThis.__reportUI.print(p,r);`,
      '@/lib/navigation-context':`export const usePageState=(key,initial)=>globalThis.__reportUI.state(key,initial);`,
      '@/components/ui/button':`import React from 'react';export const Button=({children,onClick,variant,size,...props})=>{globalThis.__reportUI.capture('button',{...props,onClick},children);return React.createElement('button',props,children);};`,
      '@/components/ui/input':`import React from 'react';export const Input=props=>{globalThis.__reportUI.capture('input',props,[]);return React.createElement('input',props);};`,
    };
    if(kind!=='controls') mocks['@/components/shared/ReportExport']=`import React from 'react';export default props=>{globalThis.__reportUI.exportProps=props;return React.createElement('span',null,'Document controls');};`;
    b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);return module.exports.render;
}
function runtime(){const r=hookRuntime(),before=r.beforeRender.bind(r);r.elements=[];r.capture=(tag,props,children)=>r.elements.push({tag,props:props||{},children});r.beforeRender=()=>{before();r.elements=[];};return r;}
const button=(r,label)=>r.elements.find(e=>e.tag==='button'&&JSON.stringify(e.children).includes(label))?.props;
test('PDF opens before asynchronous fetching, rejects concurrent clicks, and Excel uses the same report without a popup',async()=>{
  const render=await renderer('controls'),r=runtime(),events=[],previousWindow=globalThis.window;globalThis.__reportUI=r;
  const popup={document:{body:{}},close(){events.push('closed');}};globalThis.window={open(){events.push('open');return popup;}};
  let finish,loads=0;const report={title:'Verified report'},props={getReport:()=>{events.push('fetch');loads++;return new Promise(resolve=>{finish=resolve;});}};
  const draw=()=>{r.beforeRender();return render(props);};r.print=(p,data)=>{assert.equal(p,popup);assert.equal(data,report);events.push('print');};r.download=data=>{assert.equal(data,report);events.push('excel');};
  try {draw();const action=button(r,'Print / save PDF').onClick,work=action();assert.deepEqual(events,['open','fetch']);await action();assert.equal(loads,1);draw();assert.equal(button(r,'Excel (.xlsx)').disabled,true);finish(report);await work;assert.equal(popup.opener,null);assert.deepEqual(events,['open','fetch','print']);draw();const excel=button(r,'Excel (.xlsx)').onClick();finish(report);await excel;assert.deepEqual(events,['open','fetch','print','fetch','excel']);}
  finally {r.cleanup();globalThis.window=previousWindow;delete globalThis.__reportUI;}
});
test('blocked popups, failed requests and disabled controls provide safe, retryable behavior',async()=>{
  const render=await renderer('controls'),r=runtime(),previousWindow=globalThis.window;globalThis.__reportUI=r;let calls=0,closed=0;
  const props={getReport:async()=>{calls++;throw Error('Connection interrupted');}};const draw=()=>{r.beforeRender();return render(props);};
  try {globalThis.window={open:()=>null};draw();await button(r,'Print / save PDF').onClick();assert.match(draw(),/Allow pop-ups/);assert.equal(calls,0);globalThis.window={open:()=>({document:{body:{}},close(){closed++;}})};await button(r,'Print / save PDF').onClick();assert.match(draw(),/Connection interrupted/);assert.equal(closed,1);props.disabled=true;draw();await button(r,'Excel (.xlsx)').onClick();assert.equal(calls,1);}
  finally {r.cleanup();globalThis.window=previousWindow;delete globalThis.__reportUI;}
});
test('DataTable exports all searched rows beyond the current page, including computed statuses and excluding buttons',async()=>{
  const render=await renderer('table'),r=runtime();globalThis.__reportUI=r;
  const props={exportTitle:'Customer invoices',pageSize:15,columns:[{key:'name',label:'Customer'},{key:'amount',label:'Amount',exportType:'money'},{key:'status',label:'Status',exportValue:row=>row.verified?'posted':'Accounting review'},{key:'actions',label:'Edit',render:()=>null}],searchFields:['name'],data:Array.from({length:61},(_,i)=>({id:`INV${i}`,name:i<41?`Client A ${i}`:`Client B ${i}`,amount:i+0.25,verified:i!==40}))};
  const draw=()=>{r.beforeRender();return render(props);};
  try {draw();r.elements.find(e=>e.tag==='input').props.onChange({target:{value:'Client A'}});const html=draw(),report=r.exportProps.getReport();assert.match(html,/Page 1 of 3/);assert.doesNotMatch(html,/Client A 40/);assert.equal(report.sections[0].rows.length,41);assert.deepEqual(report.sections[0].rows.at(-1),['Client A 40',40.25,'Accounting review']);assert.ok(report.metadata.some(([k,v])=>k==='Search'&&v==='Client A'));}
  finally {r.cleanup();delete globalThis.__reportUI;}
});
test('balance sheet export retains contra assets, earnings and exact reconciliation from the rendered financial position',async()=>{
  const render=await renderer('position'),r=runtime();globalThis.__reportUI=r;
  try {r.beforeRender();const html=render({date:'2026-10-20',accounts:[{id:'cash',account_number:'1000',name:'Cash',account_type:'asset'},{id:'dep',account_number:'1501',name:'Accumulated depreciation',account_type:'asset'},{id:'ap',account_number:'2000',name:'Payable',account_type:'liability'},{id:'equity',account_number:'3000',name:'Capital',account_type:'equity'},{id:'rev',account_number:'7000',name:'Revenue',account_type:'revenue'}],balances:{cash:{debit:160.5},dep:{credit:10.25},ap:{credit:50},equity:{credit:60},rev:{credit:40.25}}});const doc=r.exportProps.report;assert.match(html,/Assets equal liabilities plus equity/);assert.ok(doc.sections[0].rows.some(row=>row[1]==='Accumulated depreciation'&&row[2]===-10.25));assert.equal(doc.sections[0].totals[0][2],150.25);assert.equal(doc.sections[2].totals[0][2],100.25);assert.deepEqual(doc.sections[3].rows.at(-1),['Difference',0]);}
  finally {r.cleanup();delete globalThis.__reportUI;}
});
test('income statement export follows posted period activity, preserves account detail and does not include opening income',async()=>{
  const render=await renderer('income'),r=runtime();globalThis.__reportUI=r;
  try {r.beforeRender();render({fromDate:'2026-10-01',toDate:'2026-10-21',accounts:[{id:'rev',account_number:'7000',name:'Sales',account_type:'revenue'},{id:'cogs',account_number:'6000',name:'COGS',account_type:'cogs'},{id:'expense',account_number:'6100',name:'Expense',account_type:'expense'},{id:'other',account_number:'7100',name:'Other income',account_type:'other_income'}],activity:{rev:{opening:-200,period:-100.5,closing:-300.5},cogs:{period:30.25},expense:{period:15},other:{period:-5}}});const doc=r.exportProps.report;assert.deepEqual(doc.metadata.slice(0,2),[['From','2026-10-01'],['To','2026-10-21']]);assert.deepEqual(doc.sections[0].rows,[['7000','Sales',100.5]]);assert.deepEqual(doc.sections.at(-1).rows.at(-1),['Net profit / loss',60.25]);}
  finally {r.cleanup();delete globalThis.__reportUI;}
});
