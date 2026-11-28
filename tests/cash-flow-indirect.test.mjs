import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndirectCashFlow } from '../src/lib/cash-flow-indirect.js';

// Independent direct schedule: only observations of receipts/payments enter
// expectedCash; the indirect function must derive operations from every GL line.
function ledger(opening = 0) {
  const types = {
    cash:'asset', bank:'asset', receivable:'asset', inventory:'asset', finished:'asset', tangible:'asset', accumulated_depreciation:'asset',
    hao_asset:'asset', vat_receivable:'asset', interest_payable:'liability', tax_payable:'liability', supplier_payable:'liability', loan:'liability',
    capital:'equity', cogs:'cogs', provision:'liability', rent_payable:'liability', sales:'revenue', salary:'expense', rent:'expense',
    interest:'expense', depreciation:'expense', provision_charge:'expense', grant_release:'other_income', grant:'equity',
    disposal_gain:'other_income', dividends:'liability', suspense:'asset', expense:'expense',
  };
  const roles = {cash:'treasury',bank:'treasury',finished:'inventory',provision_charge:'provision',rent_payable:'rent',expense:'other_operating'};
  const input = { accounts: Object.entries(types).map(([id, account_type]) => ({
    id, account_number:'R-'+id,name:id, account_type, normal_balance: account_type === 'liability' || account_type === 'equity' || id === 'accumulated_depreciation' ? 'credit' : 'debit',
    cash_flow_role: id==='suspense' ? undefined : roles[id] || id,
  })), journals:[],periodLines:[],from:'2026-11-01',to:'2026-11-30',evidence:{} };
  const sections = ['operating','investing','equity','debt'].map(key => ({key,rows:[]}));
  const direct = {opening, openingTraces:opening ? [{journalId:'previous',amount:opening}] : [], closing:opening, closingTraces:[], sections, operating:0};
  function post(id, amounts, metadata = {}) {
    input.journals.push({id,journal_number:'JV-'+id,entry_date:'2026-11-14',status:'posted',...metadata});
    for(const [account_id,value] of Object.entries(amounts)) input.periodLines.push({journal_id:id,account_id,debit:Math.max(value,0),credit:Math.max(-value,0)});
  }
  function expectedCash(id, section, amount, code) {
    sections.find(s=>s.key===section).rows.push({key:id,net:amount,inflow:Math.max(amount,0),outflow:Math.min(amount,0),code,traces:[{journalId:id,amount}]});
    direct.closing = Math.round((direct.closing+amount)*100)/100;
    if(section==='operating') direct.operating += amount;
  }
  function read() {
    const report = buildIndirectCashFlow(input,direct);
    const amount = Object.fromEntries(report.lines.map(r=>[r.code,r.amount]));
    for(const l of report.lines) assert.equal(Math.round(100*l.amount), l.traces.reduce((s,t)=>s+Math.round(100*t.amount),0), 'trace total for '+l.code);
    return {...report,amount};
  }
  return {input,direct,post,expectedCash,read};
}

test('indirect method reproduces the 1,700,000 FCFA closing balance from accruals, VAT, stocks and settlement timing',()=>{
  const l=ledger(1_000_000);
  l.post('cash-sale',{cash:500000,sales:-419287.21,tax_payable:-80712.79}); l.expectedCash('cash-sale','operating',500000);
  l.post('collection',{cash:300000,receivable:-300000}); l.expectedCash('collection','operating',300000);
  l.post('materials',{inventory:200000,cash:-200000}); l.expectedCash('materials','operating',-200000);
  l.post('credit-inventory',{inventory:200000,supplier_payable:-200000});
  l.post('partial-supplier',{supplier_payable:150000,cash:-150000}); l.expectedCash('partial-supplier','operating',-150000);
  l.post('payroll',{salary:100000,cash:-100000}); l.expectedCash('payroll','operating',-100000);
  l.post('machine',{tangible:250000,cash:-250000}); l.expectedCash('machine','investing',-250000,'FG');
  l.post('borrow',{cash:800000,loan:-800000}); l.expectedCash('borrow','debt',800000,'FO');
  l.post('repay',{loan:200000,cash:-200000}); l.expectedCash('repay','debt',-200000,'FQ');
  l.post('credit-sale',{receivable:119250,sales:-100000,tax_payable:-19250});
  l.post('factory',{inventory:-50000,finished:50000});
  l.post('depreciate',{depreciation:25000,accumulated_depreciation:-25000});
  l.post('cash-to-bank',{cash:-180000,bank:180000});
  l.post('contribution-in-kind',{inventory:22000,capital:-22000});
  const r=l.read();
  assert.deepEqual(Object.fromEntries(['ZA','FA','FB','FC','FD','FE','ZB','ZC','ZD','ZE','ZF','ZG','ZH'].map(k=>[k,r.amount[k]])),{
    ZA:1000000,FA:419287.21,FB:0,FC:-400000,FD:180750,FE:149962.79,ZB:350000,ZC:-250000,ZD:0,ZE:600000,ZF:600000,ZG:700000,ZH:1700000,
  });
  assert.equal(r.lines.find(x=>x.code==='FA').traces.filter(t=>t.journalId==='depreciate').length,2);
  assert.equal(r.lines.find(x=>x.code==='ZB').traces.some(t=>t.journalId==='credit-sale'),false);
  assert.equal(r.difference,0);assert.deepEqual(r.issues,[]);
});

test('asset supplier credit, disposals, long-term provisions, grant releases, dividends and interest follow their own sections',()=>{
  const l=ledger(10000);
  l.post('credit-asset',{tangible:5000,cash:-1000,supplier_payable:-4000}); l.expectedCash('credit-asset','investing',-1000,'FG');
  l.post('settle-asset',{supplier_payable:300,cash:-300}); l.input.evidence['settle-asset']={paymentPurpose:'tangible'}; l.expectedCash('settle-asset','investing',-300,'FG');
  l.post('dispose',{cash:1200,accumulated_depreciation:500,tangible:-1000,disposal_gain:-700}); l.expectedCash('dispose','investing',1200,'FI');
  l.post('reserve',{provision_charge:90,provision:-90});
  l.post('rent',{rent:500,rent_payable:-500});
  l.post('pay-rent',{rent_payable:150,cash:-150});l.expectedCash('pay-rent','operating',-150);
  l.post('accrue-interest',{interest:140,interest_payable:-140});
  l.post('mixed-repayment',{interest_payable:50,loan:200,cash:-250}); l.expectedCash('mixed-repayment','operating',-50);l.expectedCash('mixed-repayment','debt',-200,'FQ');
  l.post('grant',{cash:2500,grant:-2500}); l.expectedCash('grant','equity',2500,'FL');
  l.post('release-grant',{grant:400,grant_release:-400});
  l.post('declare-dividend',{capital:15,dividends:-15});
  l.post('pay-dividend',{dividends:10,cash:-10}); l.expectedCash('pay-dividend','equity',-10,'FN');
  const r=l.read(); assert.deepEqual(r.issues,[]); assert.equal(r.difference,0);
  assert.deepEqual([r.amount.FA,r.amount.FE,r.amount.ZB,r.amount.ZC,r.amount.ZD,r.amount.ZE,r.amount.ZH],[-640,440,-200,-100,2490,-200,11990]);
});

test('dates and real reversal dates determine the historical operating bridge; opposite mapping gaps remain separately actionable',()=>{
  const l=ledger(100);
  l.post('original',{cash:55,sales:-55},{status:'reversed',entry_date:'2026-10-31'});
  l.post('reversal',{cash:-55,sales:55},{reversal_of:'original'});l.expectedCash('reversal','operating',-55);
  l.post('draft',{cash:900,sales:-900},{status:'draft'});
  l.post('later',{cash:600,sales:-600},{entry_date:'2026-12-01'});
  l.post('hao',{hao_asset:30,cash:-30});l.expectedCash('hao','operating',-30);
  l.post('unmapped-debit',{suspense:20,cash:-20});l.expectedCash('unmapped-debit','operating',-20);
  l.post('unmapped-credit',{suspense:-20,cash:20});l.expectedCash('unmapped-credit','operating',20);
  const r=l.read();
  assert.equal(r.amount.FA,-55);assert.equal(r.amount.FB,-30);assert.equal(r.amount.ZH,15);assert.equal(r.difference,0);
  assert.deepEqual(r.issues.filter(i=>i.key.startsWith('official-operating-difference')).map(i=>i.amount),[-20,20]);
  assert.ok(r.issues.every(i=>i.messageFr && i.traces[0].journalId));
});

test('correcting a paid invoice to credit retains sales and the outstanding receivable without reporting gross cash churn',()=>{
  const l=ledger(800);
  l.post('paid',{cash:119.25,sales:-100,tax_payable:-19.25});
  l.post('terms',{cash:-119.25,receivable:119.25},{source_document_type:'InvoicePaymentTypeCorrection',original_journal_id:'paid'});
  l.direct.correctionTraces = [{journalId:'paid',amount:119.25},{journalId:'terms',amount:-119.25}];
  const r=l.read(); assert.deepEqual(r.issues,[]);
  assert.deepEqual([r.amount.FA,r.amount.FD,r.amount.FE,r.amount.ZB,r.amount.ZH],[100,-119.25,19.25,0,800]);
});

test('separately posted VAT on fully settled asset acquisitions and disposals moves through operating working capital exactly once',()=>{
  const l=ledger(1000);
  l.post('buy-taxed-asset',{tangible:100,vat_receivable:19.25,cash:-119.25},{source_module:'assets',source_document_type:'FixedAsset'});
  l.expectedCash('buy-taxed-asset','investing',-100,'FG');l.expectedCash('buy-taxed-asset','operating',-19.25);
  l.post('sell-taxed-asset',{cash:238.50,tangible:-100,disposal_gain:-100,tax_payable:-38.50},{source_module:'assets',source_document_type:'AssetDisposal'});
  l.expectedCash('sell-taxed-asset','investing',200,'FI');l.expectedCash('sell-taxed-asset','operating',38.50);
  const r=l.read();assert.deepEqual(r.issues,[]);
  assert.deepEqual([r.amount.FA,r.amount.FD,r.amount.FE,r.amount.FG,r.amount.FI,r.amount.ZH],[0,-19.25,38.50,-100,200,1119.25]);
});

test('opening-lot COGS corrections require matching verified proof and two exact noncash lines; ordinary COGS is retained',()=>{
  const fixture = () => {
    const l=ledger();
    const audit='OCC-' + 'e'.repeat(64), journal='opening-correction';
    l.post(journal,{capital:123.45,cogs:-123.45},{source_module:'accounting_corrections',source_document_type:'OpeningLotCostCorrection',source_document_id:audit,is_immutable:true});
    l.input.evidence[journal]={openingCostCorrection:{id:audit,journal_id:journal,opening_account_id:'capital',cogs_account_id:'cogs',cost_reduction:123.45,policy:'owner-confirmed-opening-lot-cost-v1'}};
    l.post('sold-stock',{cogs:45,inventory:-45});
    return l;
  };
  const valid=fixture(),r=valid.read();
  assert.equal(r.amount.FA,-45);assert.equal(r.amount.FC,45);assert.equal(r.amount.ZB,0);assert.deepEqual(r.issues,[]);
  assert.deepEqual(r.lines.find(x=>x.code==='FA').traces.filter(t=>t.journalId==='opening-correction').map(t=>t.amount),[123.45,-123.45]);
  valid.post('reverse-correction',{capital:-123.45,cogs:123.45},{reversal_of:'opening-correction'});
  assert.deepEqual(valid.read().issues,[]);
  for (const change of [
    l=>{l.input.evidence={};},
    l=>{l.input.evidence['opening-correction'].openingCostCorrection.cost_reduction=125;},
    l=>{l.input.evidence['opening-correction'].openingCostCorrection.cogs_account_id='another';},
    l=>{l.input.journals[0].source_module='manual';},
    l=>{l.input.journals[0].is_immutable=false;},
    l=>{l.input.periodLines.find(r=>r.account_id==='capital').account_id='cash';},
  ]) {
    const l=fixture();change(l);const result=l.read();assert.equal(result.amount.FA,78.45);assert.ok(result.issues.length>0);
  }
});
