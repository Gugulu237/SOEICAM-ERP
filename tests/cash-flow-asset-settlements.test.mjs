import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCashFlowReport} from '../src/lib/cash-flow-report.js';

function report(legs,doc={},e={}){
  const fixture={treasury:'asset',tangible:'asset',financial_asset:'asset',supplier_payable:'liability',disposal_receivable:'asset',
    vat_receivable:'asset',tax_payable:'liability',disposal_gain:'other_income',accumulated_depreciation:'asset',
    receivable:'asset',loan:'liability',retained:'equity'};
  const accounts=Object.entries(fixture).map(([id,account_type])=>({id,account_type,account_number:id,name:id,cash_flow_role:id,
    normal_balance:['liability','other_income'].includes(account_type)||id==='accumulated_depreciation'?'credit':'debit'}));
  const j={id:'transaction',entry_date:'2026-11-03',status:'posted',...doc};
  const lines=legs.map(([account_id,n],i)=>({id:String(i),journal_id:j.id,account_id,debit:Math.max(0,n),credit:Math.max(0,-n)}));
  return buildCashFlowReport({from:'2026-11-01',to:'2026-11-30',accounts,journals:[j],cashLines:lines.filter(l=>l.account_id==='treasury'),
    periodLines:lines,evidence:{transaction:e}}).current;
}
const code=(r,id)=>r.official.lines.find(l=>l.code===id).amount;
test('a missing Payment source falls back to ledger roles, never a default customer receipt or refund',()=>{
  const payment={source_module:'payments',source_document_type:'Payment'};
  const loan=report([['treasury',200],['loan',-200]],payment);
  assert.deepEqual([loan.direct.operating,code(loan,'FO'),loan.direct.financing],[0,200,200]);
  const supplier=report([['supplier_payable',50],['treasury',-50]],payment);
  assert.deepEqual(supplier.direct.sections[0].rows.map(r=>[r.key,r.net]),[['suppliers',-50]]);
  const customer=report([['treasury',40],['receivable',-40]],payment);
  assert.deepEqual(customer.direct.sections[0].rows.map(r=>[r.key,r.net]),[['customer_collections',40]]);
  const ambiguous=report([['treasury',40],['retained',-40]],payment);
  assert.equal(ambiguous.direct.difference,40);assert.ok(ambiguous.issues.some(i=>i.key==='unclassified'));
});
test('manually booked machine financed partly on credit reports only the amount paid for it',()=>{
  const r=report([['tangible',1000],['supplier_payable',-700],['treasury',-300]]);
  assert.deepEqual([r.direct.investing,r.direct.operating,code(r,'FG'),code(r,'FE'),r.direct.closing],[-300,0,-300,0,-300]);
  assert.deepEqual(r.issues,[]);
});
test('separately posted recoverable VAT on a cash asset purchase reconciles to the entire treasury payment',()=>{
  const r=report([['tangible',1000],['vat_receivable',192.5],['treasury',-1192.5]],{source_module:'assets',source_document_type:'FixedAsset'});
  assert.deepEqual([r.direct.closing,code(r,'FD'),code(r,'FG'),r.direct.operating,r.direct.investing],[-1192.5,-192.5,-1000,-192.5,-1000]);
  assert.deepEqual(r.issues,[]);
});
test('disposal proceeds exclude separately posted tax when computing FI; VAT remains in FE',()=>{
  for(const doc of [{source_module:'assets',source_document_type:'AssetDisposal'},{}]){
    const r=report([['treasury',1192.5],['accumulated_depreciation',20],['tangible',-900],['disposal_gain',-120],['tax_payable',-192.5]],doc);
    assert.deepEqual([r.direct.closing,code(r,'FI'),code(r,'FE'),r.direct.operating],[1192.5,1000,192.5,192.5]);
    assert.deepEqual(r.issues,[]);
  }
});
test('receivable from an asset disposal retains its origin when paid later, or triggers review if unknown',()=>{
  const legs=[['treasury',300],['disposal_receivable',-300]];
  for(const [assetRole,id] of [['tangible','FI'],['intangible','FI'],['financial_asset','FJ']]){
    const r=report(legs,{}, {assetRole});assert.equal(code(r,id),300);assert.equal(r.direct.investing,300);assert.deepEqual(r.issues,[]);
  }
  const r=report(legs);
  assert.equal(r.direct.difference,300);assert.ok(r.issues.some(i=>i.key.startsWith('unclassified')));
});
test('a mixture of recoverable VAT, cash and unpaid equipment is flagged if the document gives no settlement split',()=>{
  const r=report([['tangible',1000],['vat_receivable',192.5],['treasury',-300],['supplier_payable',-892.5]],{source_module:'assets',source_document_type:'FixedAsset'});
  assert.equal(r.direct.investing,0);assert.equal(r.direct.closing,-300);assert.ok(r.issues.some(i=>i.key.startsWith('asset_tax_split')));
});
