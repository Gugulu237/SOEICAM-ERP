import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const output=await build({entryPoints:['src/lib/income-statement-basis.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'book-rounding',setup(b){b.onResolve({filter:/^@\/lib\/posting$/},()=>({path:'rounding',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const round2=value=>Math.round(Number(value||0)*100)/100;'}));}}]});
const {salesVatForIncomeStatement,applyIncomeVatBasis}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
function fixture(){
 const accounts=[['cash','asset'],['ar','asset'],['stock','asset'],['ap','liability'],['vat','liability'],['old-vat','liability'],['sales','revenue'],['cogs','cogs'],['other','other_income']].map(([id,account_type])=>({id,account_type,normal_balance:['liability','revenue','other_income'].includes(account_type)?'credit':'debit',currency:'XAF'}));
 return {accounts,postingRules:[{id:'vat-rule',rule_key:'tax_payable',account_id:'vat',is_active:true}],journalsById:{},lines:[],fromDate:'2026-11-01',toDate:'2026-11-30'};
}
function entry(f,id,rows,{date='2026-11-05',status='posted',...meta}={}){
 f.journalsById[id]={id,status,entry_date:date,source_module:'sales',source_document_type:'Invoice',...meta};
 f.lines.push(...rows.map(([account_id,debit,credit],i)=>({id:id+'-'+i,journal_id:id,account_id,debit,credit,status})));
}
function sale(f,id,{account='cash',taxAccount='vat',...meta}={}){entry(f,id,[[account,1192.5,0],['sales',0,1000],[taxAccount,0,192.5],['cogs',650,0],['stock',0,650]],meta);}
const book=()=>({revenue:[{id:'sales',amount:1000}],cogs:[{id:'cogs',amount:650}],expenses:[{id:'expense',amount:100}],otherIncome:[],otherExpenses:[],totalRevenue:1000,totalCogs:650,grossProfit:350,totalExpenses:100,operatingProfit:250,net:250});

test('VAT-inclusive management totals add actual sales VAT to revenue and profit while retaining book figures',()=>{
 const f=fixture();sale(f,'cash');const before=structuredClone(f),base=book(),original=structuredClone(base),vat=salesVatForIncomeStatement(f),result=applyIncomeVatBasis(base,vat);
 assert.equal(vat.amount,192.5);assert.equal(result.totalRevenue,1192.5);assert.equal(result.grossProfit,542.5);assert.equal(result.operatingProfit,442.5);assert.equal(result.net,442.5);
 assert.equal(result.bookRevenue,1000);assert.equal(result.bookNet,250);assert.equal(result.totalCogs,650);assert.deepEqual(result.revenue,base.revenue);
 const accounting=applyIncomeVatBasis(base,vat,'accounting');assert.equal(accounting.totalRevenue,1000);assert.equal(accounting.net,250);assert.equal(accounting.salesVat,192.5);
 assert.deepEqual(base,original);assert.deepEqual(f,before);
});
test('credit and cash sales contribute the same accrual sales VAT, independent of collection',()=>{
 const f=fixture();sale(f,'cash');sale(f,'credit',{account:'ar',source_module:'field_sales',source_document_type:'FieldSale'});
 assert.equal(salesVatForIncomeStatement(f).amount,385);
});
test('input VAT on purchases and tax remittances cannot inflate VAT-inclusive sales',()=>{
 const f=fixture();sale(f,'sale');entry(f,'payment',[['vat',100,0],['cash',0,100]],{source_module:'manual',source_document_type:'manual_journal'});
 entry(f,'purchase',[['stock',500,0],['vat',96.25,0],['ap',0,596.25]],{source_module:'purchases',source_document_type:'Bill'});
 assert.equal(salesVatForIncomeStatement(f).amount,192.5);assert.deepEqual(salesVatForIncomeStatement(f).journalIds,['sale']);
});
test('original inclusive revenue and a later VAT correction contribute the VAT delta exactly once',()=>{
 const f=fixture();entry(f,'legacy',[['cash',1192.5,0],['sales',0,1192.5]],{status:'reversed'});
 entry(f,'correction',[['sales',192.5,0],['vat',0,192.5]],{source_document_type:'InvoiceVatCorrection'});
 assert.equal(salesVatForIncomeStatement(f).amount,192.5);
 entry(f,'reversal',[['sales',1000,0],['vat',192.5,0],['cash',0,1192.5]],{source_document_type:'SaleReversal'});
 assert.equal(salesVatForIncomeStatement(f).amount,0);
});
test('a reversal in the selected period reduces included VAT even when the original sale was earlier',()=>{
 const f=fixture();sale(f,'old',{date:'2026-10-25',status:'reversed'});
 entry(f,'reversal',[['sales',1000,0],['vat',192.5,0],['cash',0,1192.5]],{source_document_type:'SaleReversal'});
 assert.equal(salesVatForIncomeStatement(f).amount,-192.5);
 const result=applyIncomeVatBasis({...book(),totalRevenue:-1000,grossProfit:-350,operatingProfit:-350,net:-350},salesVatForIncomeStatement(f));assert.equal(result.totalRevenue,-1192.5);assert.equal(result.net,-542.5);
});
test('date boundaries, future journals and draft sales follow the same ledger selection as the P&L',()=>{
 const f=fixture();sale(f,'old',{date:'2026-10-31'});sale(f,'in');sale(f,'future',{date:'2026-12-01'});sale(f,'draft',{status:'draft'});
 f.lines.push({journal_id:'missing',account_id:'vat',debit:0,credit:999});assert.equal(salesVatForIncomeStatement(f).amount,192.5);
});
test('historical inactive VAT mappings remain recognised and repeated rule IDs cannot double count',()=>{
 const f=fixture();sale(f,'old-account',{taxAccount:'old-vat'});sale(f,'new-account');
 f.postingRules.push({id:'old',rule_key:'tax_payable',account_id:'old-vat',is_active:false},{id:'duplicate',rule_key:'tax_payable',account_id:'vat',is_active:true});
 assert.equal(salesVatForIncomeStatement(f).amount,385);
});
test('missing historical VAT mappings prevent an understated management result and keep accounting totals available',()=>{
 const f=fixture();sale(f,'old-account',{taxAccount:'old-vat'});const evidence=salesVatForIncomeStatement(f);assert.equal(evidence.available,false);assert.match(evidence.error,/unmapped/);
 const inclusive=applyIncomeVatBasis(book(),evidence);for(const key of ['totalRevenue','grossProfit','operatingProfit','net','salesVat'])assert.equal(inclusive[key],null);
 assert.equal(applyIncomeVatBasis(book(),evidence,'accounting').net,250);
});
test('invalid mapping, incomplete journals and missing tax-bearing snapshots are unavailable instead of showing zero VAT',()=>{
 const wrong=fixture();sale(wrong,'sale');wrong.postingRules[0].account_id='cash';assert.equal(salesVatForIncomeStatement(wrong).available,false);
 const incomplete=fixture();sale(incomplete,'sale');incomplete.lines.pop();assert.equal(salesVatForIncomeStatement(incomplete).available,false);
 const missing=fixture();delete missing.lines;assert.equal(salesVatForIncomeStatement(missing).available,false);
 const unreadable=fixture();sale(unreadable,'sale');unreadable.postingRules=null;const evidence=salesVatForIncomeStatement(unreadable);assert.equal(evidence.available,false);assert.match(evidence.error,/could not be loaded/);assert.equal(applyIncomeVatBasis(book(),evidence,'accounting').net,250);
});
test('VAT-bearing other-income classifications require review rather than moving their VAT into gross sales',()=>{
 const f=fixture();entry(f,'other',[['cash',1192.5,0],['other',0,1000],['vat',0,192.5]]);
 assert.equal(salesVatForIncomeStatement(f).available,false);assert.match(salesVatForIncomeStatement(f).error,/other-income/);
 f.postingRules=[];assert.equal(salesVatForIncomeStatement(f).available,false);
});
test('zero-tax sales and an empty dated ledger do not invent VAT from the standard rate',()=>{
 const f=fixture();entry(f,'zero',[['cash',1000,0],['sales',0,1000]]);assert.equal(salesVatForIncomeStatement(f).amount,0);
 assert.equal(salesVatForIncomeStatement(fixture()).amount,0);assert.throws(()=>applyIncomeVatBasis(book(),{available:true,amount:0},'unknown'),/basis/);
});
