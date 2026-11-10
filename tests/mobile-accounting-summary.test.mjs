import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
let load;
async function helper(){
 if(load)return load;
 const mocks={
  '@/api/erpClient':"export const erp={entities:{JournalEntry:'journals',JournalLine:'lines',TreasuryAccount:'treasury',Bill:'bills'},functions:{invoke:async(_,body)=>{const f=globalThis.__mobileAccountingFixture;f.actions.push(body);return {data:body.action==='accountPosition'?f.position:f.sales};}}};",
  '@/lib/field-pos':"export const readAll=async(store,filter)=>{const f=globalThis.__mobileAccountingFixture;f.reads.push({store,filter});if(f.denied?.includes(store))throw Error('Reader unavailable');return f[store];};",
  '@/lib/business-date':"export const businessDate=()=> '2026-11-10';",
 };
 const out=await build({stdin:{contents:"export {loadMobileAccountingSummary} from './src/components/accounting/loadMobileAccountingSummary.js';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'summary-fixtures',setup(b){b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));}}]});
 const module={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,module,module.exports);load=module.exports.loadMobileAccountingSummary;return load;
}
function fixture(){return {actions:[],reads:[],position:{accounts:[{id:'cash',account_type:'asset'},{id:'revenue',account_type:'revenue',account_number:'701',name:'Sales'},{id:'expense',account_type:'expense',account_number:'626',name:'Internet'}],balances:{}},journals:[{id:'sale',status:'posted',entry_date:'2026-11-10',total_debit:1000,total_credit:1000},{id:'cost',status:'posted',entry_date:'2026-11-10',total_debit:400,total_credit:400}],lines:[{journal_id:'sale',account_id:'cash',debit:1000},{journal_id:'sale',account_id:'revenue',credit:1000},{journal_id:'cost',account_id:'expense',debit:400},{journal_id:'cost',account_id:'cash',credit:400}],treasury:[{balance:90}],bills:[{status:'open',balance:120},{status:'cancelled',balance:500}],sales:{totals:{sales:1120},overview:{pending_amount:345}}};}
test('mobile accounting overview uses balanced posted ledger profit and authoritative operational totals',async()=>{
 const f=globalThis.__mobileAccountingFixture=fixture(),run=await helper();
 try{const result=await run({monthStart:'2026-11-10',date:'2026-11-10'});assert.equal(result.netProfit,600);assert.equal(result.sales,1120);assert.equal(result.receivables,345);assert.equal(result.payables,120);assert.equal(result.treasury,90);assert.deepEqual(f.actions.map(a=>a.action),['accountPosition','companySales']);assert.ok(f.reads.every(r=>['journals','lines','treasury','bills'].includes(r.store)));assert.equal(f.actions[1].from,'2026-11-10');}finally{delete globalThis.__mobileAccountingFixture;}
});
test('unavailable operational readers stay unavailable and incomplete ledger is rejected',async()=>{
 const f=globalThis.__mobileAccountingFixture=fixture(),run=await helper();
 try{f.denied=['treasury','bills'];f.sales={error:'Scope denied'};const result=await run();assert.equal(result.netProfit,600);assert.equal(result.treasury,null);assert.equal(result.payables,null);assert.equal(result.receivables,null);f.lines=f.lines.filter(l=>!(l.journal_id==='cost'&&l.account_id==='cash'));await assert.rejects(()=>run(),/incomplete|balance/);}finally{delete globalThis.__mobileAccountingFixture;}
});
