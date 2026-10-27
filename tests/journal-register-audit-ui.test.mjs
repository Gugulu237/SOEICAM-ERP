import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
async function compiled(){
 const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Register from './src/components/accounting/JournalRegister.jsx';export * from './src/lib/journal-register.js';export const render=()=>renderToStaticMarkup(React.createElement(Register));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'register',setup(b){
 b.onResolve({filter:/^react$/},a=>/(JournalRegister|JournalActivityFeed|AccountingIntegrityCheck)\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
 b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:'import React from '+JSON.stringify(require.resolve('react'))+';const key='+JSON.stringify(a.path)+';export default React;export const useState=v=>globalThis.__register.state(key,v),useRef=v=>globalThis.__register.ref(key,v),useEffect=(fn,d)=>globalThis.__register.effect(key,fn,d);',resolveDir:process.cwd()}));
 const mocks={
 '@/api/erpClient':'export const invalidateERPReads=()=>{};export const erp=new Proxy({},{get:(_,key)=>globalThis.__register.client[key]});',
 '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({user:{id:"gm"},isAdmin:true,role:"admin"});',
 '@/lib/router':'import React from "react";export const useNavigate=()=>p=>globalThis.__register.navigation.push(p),Link=({to,children})=>React.createElement("a",{href:to},children);',
 '@/components/ui/use-toast':'export const useToast=()=>({toast:v=>globalThis.__register.notifications.push(v)});',
 '@/components/ui/button':'import React from "react";export const Button=({children,...p})=>{globalThis.__register.capture("button",p,children);return React.createElement("button",p,children);};',
 '@/components/shared/ReportExport':'export default ()=>null;',
 '@/components/ui/select':'import React from "react";export const Select=({children})=>React.createElement("div",null,children),SelectContent=Select,SelectTrigger=Select,SelectValue=()=>null,SelectItem=({children,value})=>React.createElement("span",{"data-value":value},children);'
 };
 b.onResolve({filter:new RegExp('^@/')},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});const m={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);return m.exports;
}
const journal={id:'journal',journal_number:'JV-API',entry_date:'2026-10-01',description:'Verified entry',source_module:'manual',status:'posted',total_debit:100.01,total_credit:100.01};
function runtime(){const r=hookRuntime();r.requests=[];r.client={entities:{
 JournalEntry:{
 aggregate:async options=>{r.requests.push(options);return options.groupBy==='source_module'?{rows:[{source_module:'manual',count:1},{source_module:'opening_balances',count:1},{source_module:null,count:1}]}:{rows:[{status:'posted',count:2,sum_total_debit:'200.02',sum_total_credit:'200.02'},{status:'draft',count:1,sum_total_debit:'50',sum_total_credit:'0'}]};},
 filter:async()=>({items:[journal],has_more:false,next_cursor:null}),
 list:async()=>assert.fail('Unsupported distinct list must not be used')
 },
 AuditLog:{filter:async()=>({items:[{id:'event',action:'post_journal',description:'Recorded entry',entity_type:'JournalEntry',entity_id:'journal',audit_source:'server_verified'}],has_more:false})}
 },functions:{invoke:async()=>({data:{balances:{cash:{debit:100.01,credit:0},capital:{debit:0,credit:100}}}})}};return r;}
test('Accounting journal register renders actual paginated API shapes and typed source groups without a refresh fallback',async()=>{
 const ui=await compiled(),r=runtime();globalThis.__register=r;const draw=()=>{r.beforeRender();return ui.render();};
 try{draw();await r.flush();const html=draw();assert.match(html,/JV-API/);assert.match(html,/Verified entry/);assert.match(html,/manual/);assert.match(html,/opening balances/);assert.match(html,/0.01 XAF/);assert.match(html,/Out by/);assert.match(html,/Recorded entry/);assert.ok(r.requests.some(v=>v.groupBy==='source_module'));assert.deepEqual(await ui.loadJournalSources(),['manual','opening_balances']);
 const report=await ui.loadJournalReport({});assert.equal(report.debit,200.02);assert.equal(report.credit,200.02);assert.equal(report.total,3);
 }finally{r.cleanup();delete globalThis.__register;}
});
test('source and activity failures stay inside the journal view and recover through retry',async()=>{
 const ui=await compiled(),r=runtime(),aggregate=r.client.entities.JournalEntry.aggregate;let fail=true;
 r.client.entities.JournalEntry.aggregate=async o=>{if(fail&&o.groupBy==='source_module')throw Error('Source options unavailable');return aggregate(o);};
 r.client.entities.AuditLog.filter=async()=>{if(fail)throw Error('Activity unavailable');return {items:[],has_more:false};};globalThis.__register=r;
 const draw=()=>{r.beforeRender();return ui.render();};
 try{draw();await r.flush();assert.match(draw(),/Source options unavailable/);assert.match(draw(),/Activity unavailable/);assert.match(draw(),/JV-API/);fail=false;r.buttons.find(b=>b.label==='Retry journal loading').onClick();r.buttons.find(b=>b.label==='Retry activity').onClick();draw();await r.flush();const html=draw();assert.doesNotMatch(html,/Source options unavailable|Activity unavailable/);assert.match(html,/JV-API/);}finally{r.cleanup();delete globalThis.__register;}
});
test('CSV journal export treats descriptive formula text as text rather than executable spreadsheet input',async()=>{
 const ui=await compiled(),r=runtime(),oldDocument=globalThis.document,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;let blob;
 r.client.entities.JournalEntry.filter=async()=>({items:[{...journal,description:'=HYPERLINK("https://example.test")'}],has_more:false});globalThis.__register=r;
 globalThis.document={createElement:()=>({click(){}})};URL.createObjectURL=b=>{blob=b;return 'blob:fixture';};URL.revokeObjectURL=()=>{};
 try{assert.equal(await ui.exportJournalsCsv({}),1);const csv=await blob.text();assert.match(csv,/'=HYPERLINK/);assert.match(csv,/100.01/);}finally{globalThis.document=oldDocument;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;r.cleanup();delete globalThis.__register;}
});
