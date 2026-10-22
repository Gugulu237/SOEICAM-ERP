import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
let compiled;
async function loaders(){
  if(compiled)return compiled;
  const result=await build({stdin:{contents:`export {loadJournalExport} from './src/lib/journal-register.js';export {buildPaymentQuery,paymentRegisterDocument} from './src/lib/payment-register.js';export {expenseReportDocument,loadExpenseReport} from './src/lib/expense-register.js';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'data-fixture',setup(b){
    b.onResolve({filter:/^@\/api\/erpClient$/},()=>({path:'api',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const erp={entities:new Proxy({}, {get:(_,name)=>({filter:(query,options)=>globalThis.__registerDocuments(name,query,options)})})};'}));
  }}]});const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);compiled=module.exports;return compiled;
}
function paged(rows,check){return async(name,query,options)=>{check?.(name,query,options);const start=Number(options.cursor||0),items=rows.slice(start,start+options.limit);return{items,has_more:start+items.length<rows.length,next_cursor:start+items.length<rows.length?String(start+items.length):null};};}
test('journal exports pass server filters through and include every matching record beyond 5000',async()=>{
  const api=await loaders(),rows=Array.from({length:5201},(_,i)=>({id:String(i),journal_number:`JV-${i}`,total_debit:i+0.25,total_credit:i+0.25,status:'posted'}));let calls=0;
  globalThis.__registerDocuments=paged(rows,(name,q,options)=>{calls++;assert.equal(name,'JournalEntry');assert.equal(q.status,'posted');assert.equal(q.source_module,'sales');assert.deepEqual(q.entry_date,{$gte:'2026-10-01',$lte:'2026-10-21'});assert.equal(options.sort,'-created_date');});
  try {const result=await api.loadJournalExport({status:'posted',source:'sales',q:'JV-',from:'2026-10-01',to:'2026-10-21'});assert.equal(result.length,5201);assert.equal(result.at(-1).total_debit,5200.25);assert.ok(calls>25);}
  finally {delete globalThis.__registerDocuments;}
});
test('payments use the on-screen query, preserve pending/rejected status and do not stop at the visible page',async()=>{
  const api=await loaders(),filters={type:'customer_payment',status:'pending',q:'Client (A)'};
  const query=api.buildPaymentQuery(filters);assert.deepEqual(query.status,{$in:['pending_approval','approved']});assert.equal(query.$or[0].payment_number.$regex,'Client \\(A\\)');
  globalThis.__registerDocuments=paged(Array.from({length:421},(_,i)=>({id:String(i),payment_number:`RC${i}`,amount:10.25,status:'pending_approval',receipt_allocations:[{invoice_number:'INV1'}]})),(name,q)=>{assert.equal(name,'Payment');assert.deepEqual(q,query);});
  try {const report=await api.paymentRegisterDocument(filters);assert.equal(report.sections[0].rows.length,421);assert.equal(report.sections[0].rows[0][4],'INV1');assert.equal(report.sections[0].rows[0][5],10.25);assert.ok(report.sections[0].rows[0].includes('pending_approval'));}
  finally {delete globalThis.__registerDocuments;}
});
test('expense summary and exported detail include more than 2000 matches and reconcile to each other',async()=>{
  const api=await loaders(),rows=Array.from({length:2401},(_,i)=>({id:String(i),amount:0.25,transaction_date:'2026-10-21',category:'packaging',department_name:'Warehouse',treasury_account_name:'Cash'})),query={transaction_type:'expense'};
  globalThis.__registerDocuments=paged(rows,(name,q)=>{assert.equal(name,'TreasuryTransaction');assert.deepEqual(q,query);});
  try {const summary=await api.loadExpenseReport(query),report=await api.expenseReportDocument(query,{from:'2026-10-01',to:'2026-10-21'});assert.equal(summary.count,2401);assert.equal(summary.total,600.25);assert.equal(report.sections[0].rows.length,2401);assert.equal(report.sections[0].totals[0][8],600.25);assert.deepEqual(report.sections[1].rows,[['packaging',2401,600.25]]);}
  finally {delete globalThis.__registerDocuments;}
});
test('a repeating server cursor fails instead of downloading incomplete journal or payment documents',async()=>{
  const api=await loaders();globalThis.__registerDocuments=async()=>({items:[{id:'x'}],has_more:true,next_cursor:'stuck'});
  try {await assert.rejects(api.loadJournalExport({}),/fully loaded/);await assert.rejects(api.paymentRegisterDocument({type:'all',status:'all',q:''}),/fully loaded/);}
  finally {delete globalThis.__registerDocuments;}
});
