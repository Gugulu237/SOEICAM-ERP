import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { reportSnapshot, reportPrintHtml, reportWorkbook, showPrintReport } from '../src/lib/report-document.js';
import { tableReport, cashFlowDocument, companySalesDocument, auditDocument, stockDocument, warehouseAdjustmentDocument, salesInvoiceDocument } from '../src/lib/report-models.js';
import { loadReportPages } from '../src/lib/report-pages.js';

const fixture=()=>({title:'Balance sheet',generatedAt:'2026-10-21T12:00:00.000Z',metadata:[['As at','2026-10-20']],notes:['Difference: 25.25 XAF. Review before relying on these figures.'],sections:[{title:'Assets',columns:['Account','Name',{label:'Amount',type:'money'}],rows:[['0010','Lait & café',150.75],['0011','=HYPERLINK("https://example.test")',-25.5]],totals:[['','Total assets',125.25]]},{title:'Equity',columns:['Description',{label:'Amount',type:'money'}],rows:[['Current earnings',100]]}]});
function inspectWorkbook(bytes) {
  const check=spawnSync('python',['-c',`
import sys,zipfile,io,json,xml.etree.ElementTree as E
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
for file in z.namelist(): E.fromstring(z.read(file))
w=E.fromstring(z.read('xl/workbook.xml'));sheets=[]
for i,sheet in enumerate(w.find('s:sheets',ns)):
 root=E.fromstring(z.read('xl/worksheets/sheet%d.xml'%(i+1)));cells={}
 for c in root.findall('.//s:sheetData/s:row/s:c',ns):
  v=c.find('s:v',ns); t=c.find('s:is/s:t',ns)
  cells[c.attrib['r']]={'type':c.attrib.get('t','n'),'value':t.text if t is not None else float(v.text) if v is not None else None}
 assert not root.findall('.//s:f',ns)
 sheets.append({'name':sheet.attrib['name'],'cells':cells,'filter':root.find('s:autoFilter',ns).attrib['ref']})
print(json.dumps({'sheets':sheets,'files':z.namelist()}))
`],{input:bytes,encoding:null,maxBuffer:20*1024*1024});
  assert.equal(check.status,0,check.stderr.toString());return JSON.parse(check.stdout.toString());
}
test('Excel is a valid OOXML ZIP with typed amounts, leading-zero codes, safe formula-like text, metadata and totals',()=>{
  const inspected=inspectWorkbook(reportWorkbook(fixture()));
  assert.equal(inspected.sheets.length,2);
  const cells=Object.values(inspected.sheets[0].cells);
  assert.ok(cells.some(c=>c.type==='inlineStr'&&c.value==='0010'));
  assert.ok(cells.some(c=>c.type==='n'&&c.value===150.75));
  assert.ok(cells.some(c=>c.type==='n'&&c.value===-25.5));
  assert.ok(cells.some(c=>c.type==='n'&&c.value===125.25));
  assert.ok(cells.some(c=>c.type==='inlineStr'&&c.value.startsWith('=HYPERLINK')));
  assert.ok(cells.some(c=>c.value==='Lait & café'));
  assert.ok(cells.some(c=>c.value==='As at: 2026-10-20'));
  assert.ok(cells.some(c=>c.value.includes?.('Difference: 25.25')));
  assert.ok(!inspected.files.some(f=>/externalLink|vbaProject/i.test(f)));
});
test('sheet names remain valid and unique, including duplicate translated or long names',()=>{
  const r=fixture();r.sections=[...Array.from({length:3},()=>({...r.sections[0],title:"'Assets / liabilities:*? [company] very long title'"})),{...r.sections[1],title:"ASSETS   LIABILITIES      COMPANY"}];
  const names=inspectWorkbook(reportWorkbook(r)).sheets.map(s=>s.name);
  assert.equal(new Set(names.map(n=>n.toLowerCase())).size,4);
  names.forEach(n=>{assert.ok(n.length<=31);assert.doesNotMatch(n,/[\\/?*\[\]:]/);assert.ok(!n.startsWith("'")&&!n.endsWith("'"));});
});
test('print document contains report data and warnings, escapes user content, repeats table headers and offers Save PDF',()=>{
  const r=fixture();r.sections[0].rows.push(['@bad','<img src=x onerror=alert(1)>',0]);
  const html=reportPrintHtml(r);
  assert.match(html,/Print \/ save PDF/);assert.match(html,/As at/);assert.match(html,/2026-10-20/);assert.match(html,/Difference: 25.25/);assert.match(html,/Total assets/);
  assert.match(html,/thead\{display:table-header-group\}/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/<img|<script|onclick=/);
});
test('exports reject invalid financial values and unsupported cells instead of producing misleading files',()=>{
  for(const value of [NaN,Infinity,-Infinity,{}]){const r=fixture();r.sections[0].rows[0][2]=value;assert.throws(()=>reportWorkbook(r),/invalid|text or numbers/);assert.throws(()=>reportPrintHtml(r));}
  const r=fixture();r.sections[0].rows[0][1]='x'.repeat(32768);assert.throws(()=>reportWorkbook(r),/text limit/);
  assert.throws(()=>reportWorkbook({title:'Missing report',sections:[]}),/No report/);
});
test('large exports contain every row beyond UI pages and the former journal export cap',()=>{
  const r=fixture();r.sections=[{title:'Journal register',columns:['Journal',{label:'Debit',type:'money'}],rows:Array.from({length:6001},(_,i)=>[`JV-${i}`,i+0.25])}];
  const before=performance.now(), result=inspectWorkbook(reportWorkbook(r)), cells=Object.values(result.sheets[0].cells);
  assert.equal(cells.filter(c=>c.type==='n').length,6001);assert.ok(cells.some(c=>c.value==='JV-6000'));assert.ok(cells.some(c=>c.value===6000.25));
  assert.ok(performance.now()-before<15000,'6001-row serialization and independent ZIP/XML verification should complete without excessive delay');
});
test('the export snapshot cannot change when source state is later edited',()=>{
  const r=fixture(),saved=reportSnapshot(r);r.sections[0].rows[0][2]=999;assert.equal(saved.sections[0].rows[0][2],150.75);
});
test('print lifecycle leaves a manual print button and uses the supplied popup without opening another window',()=>{
  let printed=0,html='',listener;const popup={closed:false,document:{open(){},write(s){html=s;},close(){},getElementById(){return{addEventListener(event,fn){assert.equal(event,'click');listener=fn;}};}},requestAnimationFrame:fn=>fn(),focus(){},print(){printed++;}};
  showPrintReport(popup,fixture());assert.equal(printed,1);listener();assert.equal(printed,2);assert.match(html,/report-print/);assert.throws(()=>showPrintReport(null,fixture()),/pop-ups/);
});
test('filtered table exports preserve values and exclude UI actions, while supporting calculated fields',()=>{
  const report=tableReport('Invoices',[{key:'number',label:'Invoice'},{key:'total',label:'Total',exportType:'money'},{key:'status',label:'Status',exportValue:r=>r.verified?r.status:'Accounting review'},{key:'actions',label:'Edit'},{key:'id',label:''}], [{number:'INV-1',total:22.25,status:'posted',verified:false,actions:'hidden'}],[['Search','Client A']]);
  assert.deepEqual(report.sections[0].rows,[['INV-1',22.25,'Accounting review']]);assert.equal(report.sections[0].columns.length,3);
});
test('cash flow export preserves reconciliation, all review issues, unfiltered history and internal transfer markers',()=>{
  const r=cashFlowDocument({from:'2026-10-01',to:'2026-10-21',generated_at:'2026-10-21T12:00:00Z',opening:100,inflow:50,outflow:25,net:25,closing:125,reconciliation_difference:0,issues:Array.from({length:23},(_,i)=>`Review ${i}`),activities:[],components:[],history:[{date:'2026-10-21',journal_number:'JV1',cash_accounts:['Cash'],counterpart_accounts:['Bank'],inflow:20,outflow:0,internal_transfer:20,review:'Check reference'}]});
  assert.equal(r.notes.filter(n=>n.startsWith('Review')).length,23);assert.ok(r.sections[0].rows.some(row=>row[0]==='Closing cash'&&row[1]===125));assert.equal(r.sections[3].rows[0][9],20);reportWorkbook(r);
});
test('sales report keeps selected-period figures separate from current all-date unpaid balances',()=>{
  const r=companySalesDocument({totals:{sales:105,net:100,tax:5,count:1},unverified_documents:2,overview:{cash_sales:20,credit_sales:85,pending_amount:500,overdue_amount:200,pending:[{document_number:'Old unpaid',balance:500}]},rows:[{document_number:'INV1',total:105}]},{from:'2026-10-01',to:'2026-10-21'});
  assert.deepEqual(r.metadata.slice(0,2),[['From','2026-10-01'],['To','2026-10-21']]);assert.match(r.notes[0],/^2 documents/);assert.equal(r.sections[1].rows[0][7],'posted');assert.equal(r.sections[2].rows[0][0],'Old unpaid');reportWorkbook(r);
});
test('inventory count exports distinguish blank counts from zero, retain review warnings, audit actors and posting status',()=>{
  const r=auditDocument({title:'Weekly',status:'submitted',revision:2,rows:[{product_name:'Milk',book_quantity:5,counted_quantity:null},{product_name:'Sugar',book_quantity:5,counted_quantity:0,difference:-5,value_difference:-25}]},[{action:'inventoryAuditSubmit',user_name:'Accountant',revision:2}],['Stock changed after snapshot']);
  assert.equal(r.sections[0].rows[0][7],'');assert.equal(r.sections[0].rows[1][7],0);assert.ok(r.metadata.some(([k,v])=>k==='Status'&&v==='submitted'));assert.ok(r.notes.includes('Stock changed after snapshot'));assert.equal(r.sections[1].rows[0][2],'Accountant');reportWorkbook(r);
});
test('stock audit includes all filtered lots with quantities, condition, expiry and exact total value',()=>{
  const r=stockDocument([{product_name:'YOLA',book_quantity:2,book_value:10.25,qc_status:'expired',expiry_date:'2026-10-01'},{product_name:'YOLA',book_quantity:3,book_value:15.25}], 'Main','YOLA');
  assert.equal(r.sections[0].rows.length,2);assert.equal(r.sections[0].totals[0][9],25.5);assert.equal(r.sections[0].rows[0][6],'expired');reportWorkbook(r);
});
test('posted adjustment receipt contains server-confirmed quantities, values, reference and journal',()=>{
  const r=warehouseAdjustmentDocument({id:'WA1',reference:'COUNT1',date:'2026-10-21',journal_number:'JV1',value_difference:-15.25,rows:[{product_name:'Cup',book_quantity:10,counted_quantity:5,difference:-5,book_value:30.5,value_after:15.25,value_difference:-15.25}]},{warehouse:'Main',reason:'Broken packaging',account:'Inventory loss'});
  assert.ok(r.metadata.some(([k,v])=>k==='Status'&&v==='Posted'));assert.ok(r.metadata.some(([k,v])=>k==='Journal'&&v==='JV1'));assert.equal(r.sections[0].rows[0][6],5);reportWorkbook(r);
});
test('invoice export includes saved client terms, line amounts, paid amount and customer balance',()=>{
  const r=salesInvoiceDocument({invoice:{invoice_number:'INV1',subtotal:100,tax_total:5,total:105,customer_paid:40,customer_balance:65,status:'posted'},lines:[{product_name:'YOLA',quantity:2,unit:'ea',unit_price:50,discount_amount:0,tax_amount:5,total:105}],company:{company_name:'SOEICAM'},options:{bill_to_name:'Client',terms:'Agreed 30 days'}});
  assert.equal(r.sections[1].rows.at(-1)[1],65);assert.ok(r.notes.includes('Agreed 30 days'));reportWorkbook(r);
});
test('page-based exports fetch every page and reject changing totals, duplicate IDs or broken pagination',async()=>{
  const calls=[],r=await loadReportPages(async page=>{calls.push(page);return{rows:[{id:String(page)}],total:3,has_more:page<3};},'rows');assert.deepEqual(calls,[1,2,3]);assert.equal(r.length,3);
  await assert.rejects(loadReportPages(async page=>({rows:[{id:String(page)}],total:page===1?3:4,has_more:true}),'rows'),/changed/);
  await assert.rejects(loadReportPages(async()=>({rows:[{id:'same'}],has_more:true}),'rows'),/changed/);
  await assert.rejects(loadReportPages(async()=>({rows:[],has_more:true}),'rows'),/fully loaded/);
  await assert.rejects(loadReportPages(async()=>({rows:[{id:'1'}],total:3,has_more:false}),'rows'),/changed/);
});
