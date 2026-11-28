import test from 'node:test';
import assert from 'node:assert/strict';
import { cashFlowReport, readCashFlowInputs } from '../src/server/domain/cash-flow.js';
import { fixture } from './helpers/cashier.mjs';

const user={id:'gm',role:'admin'};
const dates={from:'2026-10-01',to:'2026-10-31'};

async function ledgerFixture() {
  const env = await fixture();
  env.rows.Account.splice(0,env.rows.Account.length,...[
    ['cash','asset','treasury'],['equity','equity','capital'],['stock','asset','inventory'],
    ['cogs','cogs','cogs'],['revenue','revenue','sales'],['ar','asset','receivable'],
  ].map(([id,account_type,cash_flow_role])=>({id,account_number:'X-'+id,name:id,account_type,cash_flow_role,
    normal_balance:['equity','revenue'].includes(account_type)?'credit':'debit',balance:0})));
  env.rows.JournalEntry.length=0;env.rows.JournalLine.length=0;env.rows.TreasuryAccount.length=0;
  const add=(id,date,legs,header={})=>{
    const j={id,journal_number:id,entry_date:date,status:'posted',...header};
    env.rows.JournalEntry.push(j);
    for(const [account_id,value] of legs) {
      env.rows.JournalLine.push({id:id+'-'+env.rows.JournalLine.length,journal_id:id,account_id,debit:Math.max(0,value),credit:Math.max(0,-value)});
      const a=env.rows.Account.find(a=>a.id===account_id);
      if(['posted','reversed'].includes(j.status))a.balance+=value*(a.normal_balance==='debit'?1:-1);
    }
  };
  const reads=[];
  for(const name of ['JournalEntry','JournalLine']) {
    const base=env.entities[name].filter;
    env.entities[name].filter=async (filter,sort,limit,offset)=>{
      reads.push({name,filter,sort,limit,offset});
      return base(filter,sort,limit,offset);
    };
  }
  return {...env,add,reads};
}

test('loader reads complete noncash journals inside the selected periods; other years supply only treasury or linked reversal history',async ()=>{
  const e=await ledgerFixture(),p=e.add;
  p('opening','2024-12-31',[['cash',100],['equity',-100]]);
  p('prior-sale','2025-10-01',[['cash',20],['revenue',-20]]);
  p('prior-credit','2025-10-02',[['ar',10],['revenue',-10]]);
  p('opening-credit','2026-09-30',[['ar',25],['revenue',-25]],{status:'reversed'});
  p('reversal','2026-10-04',[['ar',-25],['revenue',25]],{reversal_of:'opening-credit'});
  p('deposit','2026-10-05',[['cash',15],['ar',-15]]);
  p('draft','2026-10-06',[['cash',999],['revenue',-999]],{status:'draft'});
  p('future','2026-11-01',[['cash',50],['revenue',-50]]);
  for(let i=0;i<600;i++)p('irrelevant-'+i,'2026-08-01',[['cogs',1],['stock',-1]]);
  const args={...dates,compare:true},snapshot=await readCashFlowInputs(e.client,args);
  assert.deepEqual(snapshot.journals.map(j=>j.id).sort(),['opening','prior-sale','prior-credit','opening-credit','reversal','deposit','future'].sort());
  assert.deepEqual([...new Set(snapshot.periodLines.map(l=>l.journal_id))].sort(),['prior-sale','prior-credit','reversal','deposit'].sort());
  const report=await cashFlowReport(e.client,user,args),c=report.current,prior=report.comparison;
  assert.deepEqual([c.direct.opening,c.direct.operating,c.direct.closing],[120,15,135]);
  const prev=Object.fromEntries(prior.official.lines.map(l=>[l.code,l.amount]));
  assert.deepEqual([prev.ZA,prev.FA,prev.FD,prev.ZB,prev.ZH],[100,30,-10,20,120]);
  assert.deepEqual(c.issues,[]);
});

test('hundreds of in-period noncash journals are paged, with complete counterpart rows loaded in bounded ID sets',async()=>{
  const e=await ledgerFixture();
  e.add('opening','2026-09-30',[['cash',10],['equity',-10]]);
  for(let i=0;i<405;i++)e.add('issued-'+i,'2026-10-02',[['ar',1],['revenue',-1]]);
  e.add('paid','2026-10-31',[['cash',100],['ar',-100]]);
  const report=await cashFlowReport(e.client,user,dates),lines=Object.fromEntries(report.current.official.lines.map(l=>[l.code,l]));
  assert.deepEqual([lines.FA.amount,lines.FD.amount,lines.ZB.amount,lines.ZH.amount],[405,-305,100,110]);
  assert.equal(lines.FA.traces.length,405);
  assert.deepEqual(report.current.issues,[]);
  assert.ok(e.reads.some(r=>r.name==='JournalEntry'&&r.offset>=400));
  const ids=e.reads.filter(r=>r.name==='JournalLine'&&r.filter.journal_id?.$in);
  assert.ok(ids.length>=5);
  assert.ok(ids.every(r=>r.filter.journal_id.$in.length<=100&&r.limit<=200));
  assert.ok(e.reads.every(r=>Object.keys(r.filter).length),'No full-ledger scan for an arbitrary date range');
});

test('payment and treasury source rows reconcile to a single posted receipt; missing or mismatched receipts are visible without altering ledger cash',async()=>{
  const e=await ledgerFixture();
  e.add('opening','2026-09-30',[['cash',100],['equity',-100]]);
  e.add('paid','2026-10-08',[['cash',60],['ar',-60]],{source_module:'payments',source_document_type:'Payment'});
  e.rows.TreasuryAccount.push({id:'till',gl_account_id:'cash',name:'Demo till',balance:160});
  e.rows.Payment.push({id:'p',journal_id:'paid',payment_type:'customer_payment',status:'posted',payment_date:'2026-10-08',treasury_account_id:'till',amount:60,payment_number:'R1',party_name:'Customer A'});
  e.rows.TreasuryTransaction.push({id:'t',journal_id:'paid',transaction_type:'receipt',transaction_date:'2026-10-08',treasury_account_id:'till',amount:60,transaction_number:'T1'});
  const run=async ()=>(await cashFlowReport(e.client,user,dates)).current;
  let r=await run();
  assert.equal(r.direct.operating,60);assert.deepEqual(r.issues,[]);assert.equal(r.direct.closing,160);
  const trace=r.direct.sections[0].rows[0].traces[0];assert.equal(trace.party,'Customer A');assert.match(trace.reference,/R1/);
  const j=e.rows.JournalEntry.find(h=>h.id==='paid');j.source_document_id='different-payment';
  assert.ok((await run()).issues.some(w=>w.key==='source-link-paid'));
  delete j.source_document_id;
  e.rows.Payment[0].payment_date='2026-10-09';
  assert.ok((await run()).issues.some(w=>w.date==='2026-10-09'&&w.relatedDate==='2026-10-08'&&w.amount===60));
  e.rows.Payment[0].payment_date='2026-10-08';
  e.rows.TreasuryTransaction[0].amount=55;
  e.rows.Payment.push({id:'orphan',payment_type:'customer_payment',status:'posted',payment_date:'2026-10-09',treasury_account_id:'till',amount:30,payment_number:'R2'});
  r=await run();
  assert.equal(r.reconciled,false);assert.equal(r.direct.operating,60);assert.equal(r.direct.closing,160);
  assert.ok(r.issues.some(w=>w.amount===-5&&w.traces.some(t=>t.journalId==='paid')));
  assert.ok(r.issues.some(w=>w.amount===30&&w.traces.some(t=>t.reference==='R2')));
});

test('bad historical cash dates are detected; an entirely empty treasury history cannot be certified',async()=>{
  const e=await ledgerFixture();
  e.add('bad-history','invalid-date',[['cash',1],['equity',-1]]);
  await assert.rejects(cashFlowReport(e.client,user,dates),/valid.*date/i);
  const empty=await ledgerFixture(),report=await cashFlowReport(empty.client,user,dates);
  assert.equal(report.current.direct.closing,0);assert.equal(report.current.reconciled,false);
});

test('historical invoice evidence follows an actual chain of posted sale edits, not the latest invoice balance',async()=>{
  const e=await ledgerFixture(), source={source_module:'sales',source_document_type:'Invoice',source_document_id:'invoice'};
  e.add('old','2026-10-15',[['cash',80],['revenue',-80]],{...source,status:'reversed',reversed_by_journal:'undo'});
  e.add('undo','2026-11-02',[['cash',-80],['revenue',80]],{source_document_type:'PostedSaleEditReversal',reversal_of:'old'});
  e.add('middle','2026-11-02',[['ar',90],['revenue',-90]],{...source,previous_journal_id:'old',status:'reversed'});
  e.add('latest','2026-12-02',[['ar',75],['revenue',-75]],{...source,previous_journal_id:'middle'});
  e.rows.Invoice.push({id:'invoice',journal_id:'latest',invoice_number:'INV-TEST',payment_type:'credit',total:75,balance:75});
  const run=()=>readCashFlowInputs(e.client,dates);
  assert.deepEqual((await run()).sourceWarnings,[]);
  e.rows.JournalEntry.find(j=>j.id==='middle').source_document_id='unrelated';
  assert.ok((await run()).sourceWarnings.some(w=>w.key==='source-link-old'));
});
