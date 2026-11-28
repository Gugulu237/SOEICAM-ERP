import test from 'node:test';
import assert from 'node:assert/strict';
import { cashFlowExportDocument } from '../src/lib/cash-flow-export.js';
import { cashFlowOfficialRows } from '../src/lib/cash-flow-display.js';
import { reportPrintHtml, reportWorkbook } from '../src/lib/report-document.js';

const codes = 'ZA FA FB FC FD FE ZB FF FG FH FI FJ ZC FK FL FM FN ZD FO FP FQ ZE ZF ZG ZH'.split(' ');
const sums = { ZA:1000000, FA:500000, FC:-200000, FD:300000, FE:-250000, ZB:350000, FG:-250000, ZC:-250000,
  FO:800000, FQ:-200000, ZE:600000, ZF:600000, ZG:700000, ZH:1700000 };
function period(year, factor) {
  const byGroup = {
    operating:[['sales','Cash sales','Ventes au comptant',500000],['collections','Collections','Recouvrements',300000],['materials','Materials','Matières',-200000],['bills','Supplier bills','Factures fournisseurs',-150000],['payroll','Payroll','Salaires',-100000]],
    investing:[['equipment','Equipment','Matériel',-250000]],
    equity:[], debt:[['loans','Loans received','Emprunts reçus',800000],['principal','Principal repayment','Remboursement du principal',-200000]],
  };
  const sections = Object.entries(byGroup).map(([key, items]) => {
    const rows = items.map(([id,label,labelFr,v]) => {
      const net=v*factor; return {key:id,label,labelFr,inflow:Math.max(net,0),outflow:Math.min(net,0),net};
    });
    const sum = k => rows.reduce((total,row) => total+row[k],0);
    return {key,rows,inflow:sum('inflow'),outflow:sum('outflow'),net:sum('net')};
  });
  return {from:year+'-11-01',to:year+'-11-30',reconciled:true,issues:[],
    direct:{opening:1000000*factor,operating:350000*factor,investing:-250000*factor,equity:0,debt:600000*factor,
      financing:600000*factor,net:700000*factor,calculatedClosing:1700000*factor,closing:1700000*factor,difference:0,sections},
    official:{lines:codes.map(code=>({code,label:'Line '+code,labelFr:'Ligne '+code,amount:(sums[code]||0)*factor})),difference:0}};
}
const report = () => ({current:period('2026',1),comparison:period('2025',0.5),currency:'XAF',generatedAt:'2026-11-30T18:00:00Z'});
// The ERP XLSX writer stores UTF-8 entries; read the generated worksheet XML
// to verify real typed cells, independent of the browser print representation.
function workbookSheet(bytes, name) {
  const buf=Buffer.from(bytes);
  let i=0;
  while(i+30<buf.length && buf.readUInt32LE(i)===0x04034b50){
    const size=buf.readUInt32LE(i+18), n=buf.readUInt16LE(i+26), extra=buf.readUInt16LE(i+28);
    const path=buf.subarray(i+30,i+30+n).toString(), start=i+30+n+extra;
    if(path===name) return buf.subarray(start,start+size).toString();
    i=start+size;
  }
  throw Error('Missing workbook entry: '+name);
}
test('management export retains signed flow, gross receipts/payments, prior-only categories and both applied periods',()=>{
  const r=report();
  r.current.direct.closingTraces=[
    {date:'2026-10-31',journalId:'opening-history',amount:1000000},
    {date:'2026-11-08',journalNumber:'TRANSFER-1',treasuryAccounts:['cash'],amount:-500000},
    {date:'2026-11-08',journalNumber:'TRANSFER-1',treasuryAccounts:['bank'],amount:500000}];
  const prev=r.comparison.direct.sections[0];
  prev.rows[0]={...prev.rows[0],key:'historicalSales',label:'Former sales channel'};
  const doc=cashFlowExportDocument(r);
  const summary=doc.sections[0];
  assert.deepEqual(summary.rows.map(x=>x.slice(1)),[[1000000,500000],[350000,175000],[-250000,-125000],[600000,300000],[700000,350000],[1700000,850000],[1700000,850000]]);
  const operating=doc.sections[1];
  assert.deepEqual(operating.totals[0],['Total',800000,-450000,350000,400000,-225000,175000]);
  const audit=doc.sections.at(-1);
  assert.deepEqual(audit.rows.map(row=>[row[2],row[7],row[8]]),[['TRANSFER-1','cash',-500000],['TRANSFER-1','bank',500000]]);
  assert.deepEqual(doc.sections.find(s=>s.title==='Financing Cash Flow').rows.map(r=>r[1]),[800000,-200000,600000]);
  assert.deepEqual(operating.rows.find(row=>row[0]==='Former sales channel'),['Former sales channel',0,0,0,250000,0,250000]);
  const first=workbookSheet(reportWorkbook(doc),'xl/worksheets/sheet1.xml');
  for(const value of ['SOEICAM',r.generatedAt,'2026-11-01','2025-11-30','<v>1700000</v>','<v>850000</v>']) assert.ok(first.includes(value));
  const html=reportPrintHtml(doc);
  assert.match(html,/1,700,000.00/); assert.match(html,/850,000.00/);
});
test('French formal PDF and workbook preserve official order and signed N/N−1, ledger discrepancy and reference',()=>{
  const r=report(); r.current.reconciled=false;
  r.current.direct.closing+=12.5; r.current.direct.difference=12.5; r.current.official.difference=12.5;
  r.current.issues=[{message:'Classification needed',messageFr:'Classement à vérifier',amount:12.5,traces:[{journalNumber:'JE-7',reference:'X<5'}]}];
  const doc=cashFlowExportDocument(r,{view:'official',language:'fr'});
  const formal=doc.sections[0];
  assert.deepEqual(formal.rows.map(row=>row[0]).filter(Boolean),codes);
  assert.deepEqual(formal.rows.at(-1),['ZH','Ligne ZH','H',1700000,850000]);
  assert.deepEqual(formal.columns.slice(3).map(column=>column.label),['N','N−1']);
  const index=formal.rows.findIndex(row=>row[0]==='ZB');
  assert.equal(formal.rows[index-1][0],'');assert.deepEqual(formal.rows[index-1].slice(2),['',-150000,-75000]);
  assert.deepEqual(formal.rows.filter(row=>row[2]).map(row=>row[2]),Array.from('ABCDEFGH'));
  assert.deepEqual(doc.sections.at(-1).rows,[['N','Classement à vérifier',12.5,'JE-7 / X<5']]);
  const bytes=reportWorkbook(doc), sheet=workbookSheet(bytes,'xl/worksheets/sheet1.xml'), html=reportPrintHtml(doc);
  assert.match(sheet,/<v>-250000<\/v>/);assert.match(sheet,/<v>-125000<\/v>/);assert.match(sheet,/À vérifier/);
  assert.match(sheet,/Devise: XAF/);assert.match(sheet,/orientation="portrait"/);
  assert.match(html,/<html lang="fr">/);assert.match(html,/Imprimer \/ Enregistrer en PDF/);
  assert.match(html,/Classement à vérifier/);assert.match(html,/X&lt;5/);assert.match(html,/12,50/);
  assert.match(html,/1\s700\s000,00/);assert.match(html,/850\s000,00/);
});
test('single-period report does not imply prior-year zero; missing formal data cannot silently export',()=>{
  const r=report();r.comparison=null;
  let doc=cashFlowExportDocument(r,{view:'official'});assert.equal(doc.sections[0].columns.length,4);
  assert.equal(doc.sections[0].columns.at(-1).label,'N');assert.doesNotMatch(reportPrintHtml(doc),/N−1/);
  r.comparison=period('2025',0.5);r.comparison.official.lines.pop();
  assert.throws(()=>cashFlowExportDocument(r,{view:'official'}),/Incomplete/);
  r.current.direct.closing=NaN;assert.throws(()=>cashFlowExportDocument(r),/Incomplete/);
});
test('working capital subtotal retains original ledger contributions without changing ZB or official line codes',()=>{
  const lines=report().current.official.lines;
  const sources=[['FB',0.1],['FC',0.2],['FD',-0.05],['FE',-0.1]];
  for (const [code,value] of sources) {
    const row=lines.find(r=>r.code===code);row.amount=value;row.traces=[{journalId:code,amount:value}];
  }
  const display=cashFlowOfficialRows(lines), subtotal=display.find(row=>row.key==='workingCapital');
  assert.equal(subtotal.amount,0.15);assert.deepEqual(subtotal.traces.map(t=>t.journalId),sources.map(s=>s[0]));
  assert.equal(display.find(r=>r.code==='ZB').amount,350000);assert.deepEqual(lines.map(r=>r.code),codes);
});
