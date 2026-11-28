import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashFlowReport } from '../src/lib/cash-flow-report.js';

// Synthetic chart and ledger only. Changing a translated account's name must
// not change a classification. Signs in the fixture are debit-positive.
function books() {
  const accounts = [
    ['till','asset','treasury'],['bank','asset','treasury'],['overdraft','liability','treasury'],
    ['ar','asset','receivable'],['vat','liability','tax_payable'],['ap','liability','supplier_payable'],
    ['raw','asset','inventory'],['fg','asset','inventory'],['asset','asset','tangible'],
    ['assetAP','liability','investment_payable'],['depAcc','asset','accumulated_depreciation'],
    ['sales','revenue','sales'],['salary','expense','salary'],['dep','expense','depreciation'],
    ['rent','expense','rent'],['rentDue','liability','rent'],['payrollDue','liability','salary_payable'],
    ['cogs','cogs','cogs'],['tastings','expense','marketing'],['loan','liability','loan'],
    ['capital','equity','capital'],['interest','expense','interest'],['interestDue','liability','interest_payable'],
    ['opening','equity','retained'],['unknown','liability',undefined],
  ].map(([id,account_type,cash_flow_role],i)=>({id,account_type,cash_flow_role,account_number:'X'+i,
    name:'Control '+String(i),normal_balance:['liability','equity','revenue'].includes(account_type)||id==='depAcc'?'credit':'debit',
    balance:0,is_posting:true,currency:'XAF'}));
  const journals=[], lines=[], evidence={};
  function post(id,date,legs,header={}) {
    const journal={id,entry_date:date,journal_number:'J-'+id,description:'Posting '+id,status:'posted',...header};
    journals.push(journal);
    for (const [account_id,n] of legs) {
      lines.push({id:id+'-'+lines.length,journal_id:id,account_id,debit:Math.max(0,n),credit:Math.max(0,-n),status:journal.status});
      const a=accounts.find(a=>a.id===account_id);
      if (['posted','reversed'].includes(journal.status)) a.balance+=n*(a.normal_balance==='debit'?1:-1);
    }
    return journal;
  }
  function input(from='2026-11-01',to='2026-11-30',compare=false) {
    return {accounts,journals,evidence,postingRules:[],treasury:[],from,to,compare,
      cashLines:lines.filter(l=>['till','bank','overdraft'].includes(l.account_id)),periodLines:lines};
  }
  return {accounts,post,input,evidence,run:(...args)=>buildCashFlowReport(input(...args))};
}
const formal=period=>Object.fromEntries(period.official.lines.map(l=>[l.code,l.amount]));
const sum=rows=>Math.round(rows.reduce((n,r)=>n+Math.round(r.amount*100),0))/100;
const invoice={source_module:'sales',source_document_type:'Invoice'};

test('November management and indirect statements agree on the specified 1,700,000 FCFA close, with different operating evidence',()=>{
  const b=books(),p=b.post;
  p('opening','2026-10-31',[['till',1000000],['ar',300000],['raw',150000],['ap',-150000],['opening',-1300000]],{source_module:'opening_balances'});
  p('cash-sale','2026-11-01',[['till',500000],['sales',-500000]],invoice);
  p('collection','2026-11-04',[['bank',300000],['ar',-300000]]);
  b.evidence.collection={party:'Customer A',reference:'RCPT-123 / INV-001'};
  p('milk','2026-11-06',[['raw',200000],['bank',-200000]]);
  p('bill','2026-11-07',[['ap',150000],['till',-150000]]);
  p('salary','2026-11-09',[['salary',100000],['till',-100000]]);
  p('freezer','2026-11-11',[['asset',250000],['bank',-250000]]);
  p('draw-loan','2026-11-15',[['bank',800000],['loan',-800000]]);
  p('principal','2026-11-30',[['loan',200000],['bank',-200000]]);
  const r=b.run().current,d=r.direct,f=formal(r);
  assert.deepEqual([d.opening,d.operating,d.investing,d.financing,d.net,d.closing,d.calculatedClosing],
    [1000000,350000,-250000,600000,700000,1700000,1700000]);
  assert.deepEqual([f.ZA,f.FA,f.FC,f.FD,f.FE,f.ZB,f.FG,f.ZC,f.FO,f.FQ,f.ZE,f.ZG,f.ZH],
    [1000000,400000,-200000,300000,-150000,350000,-250000,-250000,800000,-200000,600000,700000,1700000]);
  const op=d.sections.find(s=>s.key==='operating');
  assert.deepEqual([op.inflow,op.outflow,op.net],[800000,-450000,350000]);
  const trace=op.rows.find(r=>r.key==='customer_collections').traces[0];
  assert.deepEqual([trace.journalId,trace.date,trace.party,trace.reference,trace.amount],['collection','2026-11-04','Customer A','RCPT-123 / INV-001',300000]);
  assert.equal(trace.treasuryAccounts.length,1);
  for(const l of r.official.lines) assert.equal(sum(l.traces),l.amount,'Unexplained formal line '+l.code);
  assert.equal(r.reconciled,true,JSON.stringify(r.issues));
});

test('credit, VAT, partial payments, mixed cash/credit sales, refunds and remittances record only settled money',()=>{
  const b=books(),p=b.post;
  p('ob','2026-10-31',[['bank',5000],['opening',-5000]],{source_module:'opening_balances'});
  p('invoice','2026-11-02',[['ar',11925],['sales',-10000],['vat',-1925]],invoice);
  p('supplier-credit','2026-11-02',[['raw',5000],['ap',-5000]]);
  p('accrue-payroll','2026-11-02',[['salary',4000],['payrollDue',-4000]]);
  p('accrue-rent','2026-11-02',[['rent',7000],['rentDue',-7000]]);
  let current=b.run().current;
  assert.equal(current.direct.operating,0);assert.equal(formal(current).ZB,0);assert.deepEqual(current.issues,[]);
  p('partial-collection','2026-11-04',[['bank',4000],['ar',-4000]]);
  p('partial-bill','2026-11-05',[['ap',2000],['bank',-2000]]);
  p('partial-payroll','2026-11-05',[['payrollDue',1000],['bank',-1000]]);
  p('mixed-sale','2026-11-06',[['ar',9925],['till',2000],['sales',-10000],['vat',-1925],['cogs',7000],['fg',-7000]],invoice);
  p('cash-refund','2026-11-07',[['till',-119.25],['sales',100],['vat',19.25]],invoice);
  p('remit','2026-11-08',[['vat',500],['bank',-500]]);
  current=b.run().current;
  const op=current.direct.sections[0];
  assert.deepEqual([op.inflow,op.outflow,op.net,formal(current).ZB],[6000,-3619.25,2380.75,2380.75]);
  assert.deepEqual(Object.fromEntries(op.rows.map(r=>[r.key,r.net])),
    {cash_sales:2000,customer_collections:4000,refunds:-119.25,suppliers:-2000,salary:-1000,taxes:-500});
  assert.equal(current.reconciled,true,JSON.stringify(current.issues));
});

test('inventory production, spoilage and degustation, depreciation, fixed asset credit and internal transfers leave no external cash',()=>{
  const b=books(),p=b.post;
  p('ob','2026-10-31',[['till',1000000],['opening',-1000000]],{source_module:'opening_balances'});
  p('move','2026-11-01',[['bank',500000],['till',-500000]]);
  p('make','2026-11-02',[['fg',200],['raw',-200]]);
  p('spoil','2026-11-03',[['cogs',50],['fg',-50]]);
  p('taste','2026-11-03',[['tastings',25],['fg',-25]]);
  p('depreciate','2026-11-04',[['dep',1000],['depAcc',-1000]]);
  p('purchase-equipment','2026-11-05',[['asset',250000],['assetAP',-250000]]);
  let r=b.run().current;
  assert.equal(r.direct.internalTransfers,500000);assert.equal(r.direct.net,0);
  assert.equal(formal(r).FA,-75);assert.equal(formal(r).FC,75);assert.equal(formal(r).ZB,0);
  assert.equal(r.direct.closing,1000000);assert.deepEqual(r.issues,[]);
  p('pay-equipment','2026-11-10',[['assetAP',50000],['bank',-50000]]);
  b.evidence['pay-equipment']={paymentPurpose:'tangible'};
  r=b.run().current;
  assert.deepEqual([r.direct.operating,r.direct.investing,formal(r).FG,r.direct.closing],[0,-50000,-50000,950000]);
  assert.deepEqual(r.issues,[]);
});

test('overdraft, equity, interest and debt service retain separate roles even for combined settlements',()=>{
  const b=books(),p=b.post;
  p('opening','2026-10-31',[['bank',2000],['overdraft',-400],['opening',-1600]]);
  p('debt','2026-11-03',[['bank',300],['loan',-300]]);
  p('new-capital','2026-11-05',[['till',250],['capital',-250]]);
  p('accrue','2026-11-07',[['interest',35],['interestDue',-35]]);
  p('pay','2026-11-20',[['loan',200],['interestDue',20],['bank',-220]]);
  p('repay-overdraft','2026-11-23',[['overdraft',100],['bank',-100]]);
  const r=b.run().current,d=r.direct,f=formal(r);
  assert.deepEqual([d.opening,d.internalTransfers,d.operating,d.equity,d.debt,d.net,d.closing],[1600,100,-20,250,100,330,1930]);
  assert.deepEqual([f.FA,f.FE,f.ZB,f.FK,f.FO,f.FQ,f.ZH],[-35,15,-20,250,300,-200,1930]);
  assert.deepEqual(r.issues,[]);
});

test('historical boundaries and prior-year evaluation respect dated reversals, drafts, later receipts and legitimate backdated corrections',()=>{
  const b=books(),p=b.post;
  p('prior','2025-11-18',[['bank',10],['sales',-10]],invoice);
  p('oct','2026-10-28',[['bank',200],['sales',-200]],{...invoice,status:'reversed',reversed_by_journal:'reverse'});
  p('reverse','2026-11-02',[['bank',-200],['sales',200]],{reversal_of:'oct'});
  p('nov-sale','2026-11-30',[['till',30],['sales',-30]],invoice);
  p('draft','2026-11-30',[['till',700],['sales',-700]],{status:'draft'});
  p('future','2026-12-01',[['till',500],['sales',-500]],invoice);
  const history=()=>b.run('2026-11-01','2026-11-30',true),oct=()=>b.run('2026-10-01','2026-10-31').current;
  const before=history();
  assert.deepEqual([oct().direct.closing,before.current.direct.opening,before.current.direct.net,before.current.direct.closing],[210,210,-170,40]);
  assert.deepEqual([before.comparison.from,before.comparison.to,before.comparison.direct.opening,formal(before.comparison).ZH],['2025-11-01','2025-11-30',0,10]);
  p('later-posted','2026-10-31',[['till',15],['sales',-15]],invoice);
  const after=history();
  assert.deepEqual([oct().direct.closing,after.current.direct.opening,after.current.direct.net,formal(after.current).ZH],[225,225,-170,55]);
  assert.deepEqual(after.current.issues,[]);
});

test('unknown cash factors and in-period opening imports show quantified differences without a plug or amendment to the books',()=>{
  const b=books(),p=b.post;
  p('unknown','2026-11-01',[['bank',45],['unknown',-45]]);
  p('import','2026-11-02',[['bank',80],['opening',-80]],{source_module:'opening_balances'});
  const input=b.input(),before=structuredClone(input),r=buildCashFlowReport(input).current;
  assert.equal(r.reconciled,false);
  assert.deepEqual([r.direct.closing,r.direct.calculatedClosing,r.direct.difference,formal(r).ZH],[125,0,125,0]);
  for(const [id,amt] of [['unknown',45],['import',80]]) assert.ok(r.issues.some(w=>w.amount===amt&&w.traces.some(t=>t.journalId===id)));
  assert.deepEqual(input,before);
});
