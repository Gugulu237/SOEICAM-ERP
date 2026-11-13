import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {catalogueFromStored, decorateEmployee, validateRoleProfile} from '../src/server/domain/role-catalogue.js';
import {customerInvoiceDetailPath} from '../src/lib/customer-mobile-summary.js';
import {invoiceEmail,invoiceHtml,invoiceText} from '../src/lib/invoice-documents.js';
import {postJournal} from '../src/server/domain/field-ops.js';
import {loadInvoiceDocument} from '../src/server/domain/sales-invoices.js';
import {fixture, user, date} from './helpers/cashier.mjs';

const routeRoot = 'src/app/api/customers/[id]/invoices/[invoiceId]';
const fixturePlugin = {
  name:'customer-invoice-fixture',
  setup(b) {
    const mocks = {
      auth: `export async function authenticateRequest(){const context=globalThis.__customerPrint.context;if(!context)throw Object.assign(Error('Please sign in.'),{status:401});return context;}
        export const apiError=error=>Response.json({error:error.message},{status:error.status||400,headers:{'Cache-Control':'private, no-store'}});`,
      db: 'export const transaction=fn=>fn();export const database=()=>{throw Error("Unexpected database call");};',
      files: 'export const validateReceiptPhotos=()=>{},validateExpenseReceipt=()=>{};',
      entities: 'export const serviceEntities=new Proxy({},{get:(_,name)=>globalThis.__customerPrint.stores[name]});export const entityStore=name=>serviceEntities[name];',
      'server-only': '',
    };
    b.onResolve({filter:/^(?:@\/server\/auth|\.\/(?:auth|entities|db|files)\.js|server-only)$/}, args => {
      if (args.path.startsWith('./') && !args.importer.includes('/src/server/')) return;
      const name = args.path.split('/').at(-1).replace(/\.js$/,'');
      return {path:name, namespace:'customer-invoice-fixture'};
    });
    b.onLoad({filter:/.*/, namespace:'customer-invoice-fixture'}, args => ({contents:mocks[args.path]}));
  },
};
async function invoiceHandler(path) {
  const output = await build({entryPoints:[path], bundle:true, format:'esm', platform:'node', write:false, plugins:[fixturePlugin]});
  const {GET} = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
  return GET;
}
const [printInvoice,readInvoice] = await Promise.all([
  invoiceHandler(routeRoot+'/print/route.js'),
  invoiceHandler(routeRoot+'/route.js'),
]);

function staffContext(modules, {template='employee', status='active', fullAccess=true}={}) {
  const role = validateRoleProfile({key:'print_clerk', label:'Print clerk', category:'Operations', template_role:template, modules});
  if (!fullAccess) role.module_permissions_version=4;
  const roleCatalogue = catalogueFromStored({roles:{print_clerk:role}});
  const account = {...user, preferred_language:'en'};
  const employee = decorateEmployee(account, {id:'clerk', role:'print_clerk', status}, roleCatalogue);
  return {user:account, employee, roleCatalogue, role:template};
}

const print = (id, invoiceId, headers, query='') => printInvoice(new Request('http://localhost/'+query, {headers}), {params:Promise.resolve({id,invoiceId})});
const read = (id, invoiceId, query='') => readInvoice(new Request('http://localhost/'+query), {params:Promise.resolve({id,invoiceId})});

async function setup(t) {
  const {entities, rows} = await fixture();
  rows.Customer.push({id:'east', parent_id:'customer-a', business_name:'East branch'}, {id:'west', parent_id:'customer-a', business_name:'West branch'}, {id:'unrelated', business_name:'Outside customer'});
  rows.Invoice.push({id:'posted-invoice', invoice_number:'INV-123', status:'posted', customer_id:'customer-a', location_id:'east', invoice_date:date, due_date:date, journal_id:'sale-journal', total:1200, subtotal:1000, tax_total:200, balance:1200,
    invoice_document:{company:{company_name:'Saved SOEICAM letterhead', logo_url:'/brand/logos/yola.png'}, options:{language:'fr', bill_to_name:'<Client A>'}}});
  rows.InvoiceLine.push({id:'line', invoice_id:'posted-invoice', product_name:'Saved Yoghurt Line', quantity:1, unit_price:1200, total:1200});
  rows.JournalEntry.push({id:'sale-journal', status:'posted', source_document_id:'posted-invoice', source_document_type:'Invoice'});
  globalThis.__customerPrint={stores:entities, context:staffContext(['customers'])};
  t.after(() => { delete globalThis.__customerPrint; });
  return rows;
}

test('Customers-only staff can print their recent posted invoice and exact headquarters-billed branch invoice', async t => {
  await setup(t);
  for (const id of ['customer-a','east']) {
    const response=await print(id,'posted-invoice');
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    const html=await response.text();
    assert.match(html, /INV-123|Facture/);
    assert.match(html, /Saved SOEICAM letterhead/);
    assert.match(html, /\/brand\/logos\/yola\.png/);
    assert.match(html, /Saved Yoghurt Line/);
    assert.match(html, /&lt;Client A&gt;/);
    const handler=html.match(/onclick="([^"]+)"/)?.[1];
    assert.equal(handler,'window.print()');
    assert.ok(response.headers.get('content-security-policy').includes(`'sha256-${createHash('sha256').update(handler).digest('base64')}'`));
  }
  globalThis.__customerPrint.context=staffContext(['customers','sales'],{fullAccess:false});
  assert.equal((await print('customer-a','posted-invoice')).status,200);
});

test('print route checks authentication, invoice access, customer relation and printable status', async t => {
  const rows=await setup(t);
  for (const id of ['west','unrelated','missing']) {
    const response=await print(id,'posted-invoice');
    assert.equal(response.status,404);
    assert.doesNotMatch(await response.text(), /Saved SOEICAM|Saved Yoghurt/);
  }
  for (const [context, status] of [[null,401],[staffContext(['sales']),403],[staffContext(['customers'],{status:'inactive'}),403],[staffContext(['customers'],{template:'commercial'}),403]]) {
    globalThis.__customerPrint.context=context;
    assert.equal((await print('customer-a','posted-invoice')).status,status);
  }
  globalThis.__customerPrint.context=staffContext(['customers']);
  const [invoice]=rows.Invoice;
  invoice.status='credited';
  assert.equal((await print('customer-a','posted-invoice')).status,404);
  invoice.status='posted';
  invoice.opening_batch_id='historical';
  assert.equal((await print('customer-a','posted-invoice')).status,404);
  delete invoice.opening_batch_id;
  rows.JournalEntry[0].source_document_id='different-invoice';
  assert.equal((await print('customer-a','posted-invoice')).status,409);
});

test('the in-app invoice document uses the authenticated customer and branch scope', async t => {
  const rows=await setup(t);
  for (const id of ['customer-a','east']) {
    const response=await read(id,'posted-invoice');
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/^application\/json/);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    const document=await response.json();
    assert.equal(document.invoice.invoice_number,'INV-123');
    assert.equal(document.company.company_name,'Saved SOEICAM letterhead');
    assert.equal(document.lines[0].product_name,'Saved Yoghurt Line');
  }
  for (const id of ['west','unrelated','missing']) {
    const response=await read(id,'posted-invoice');
    assert.equal(response.status,404);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.deepEqual(await response.json(),{error:'Invoice not found.'});
  }
  for (const [context,status] of [[null,401],[staffContext(['sales']),403],[staffContext(['customers'],{status:'inactive'}),403],[staffContext(['customers'],{template:'commercial'}),403]]) {
    globalThis.__customerPrint.context=context;
    assert.equal((await read('east','posted-invoice')).status,status);
  }
  globalThis.__customerPrint.context=staffContext(['customers']);
  rows.Invoice[0].opening_batch_id='historical';
  assert.equal((await read('east','posted-invoice')).status,404);
  delete rows.Invoice[0].opening_batch_id;
  rows.JournalEntry[0].source_document_id='different-invoice';
  assert.equal((await read('east','posted-invoice')).status,409);
});

test('the recent invoice link is encoded and excluded from opening or reversed entries', () => {
  const row={id:'invoice/id',status:'paid'};
  const path='/customers/branch%20%26%20town/invoices/invoice%2Fid';
  assert.equal(customerInvoiceDetailPath('branch & town',row),path);
  assert.equal(customerInvoiceDetailPath('branch & town',row,{fromSales:true}),path+'?from=sales');
  assert.equal(customerInvoiceDetailPath('branch',{...row,opening_batch_id:'history'}),null);
  assert.equal(customerInvoiceDetailPath('branch',{...row,sale_reversal:{}}),null);
});

test('historical invoice shows the posted VAT correction and keeps the original printable through the same scope', async t => {
  const rows=await setup(t), stores=globalThis.__customerPrint.stores;
  const invoice=rows.Invoice[0], first=rows.InvoiceLine[0];
  const entryDate=date.slice(0,4)+'-01-01';
  const recordedAt=date+'T12:00:00.000Z';
  Object.assign(invoice,{sales_order_id:'legacy-order',invoice_date:entryDate,price_includes_vat:true,total:2385,subtotal:2192.5,tax_total:192.5,amount_paid:500,balance:1885,payment_type:'credit',status:'partially_paid'});
  Object.assign(first,{unit_price:1192.5,total:1192.5,tax_rate:19.25,tax_amount:192.5,price_includes_vat:true});
  rows.InvoiceLine.push({id:'previously-untaxed',invoice_id:invoice.id,product_name:'Other Yoghurt',quantity:1,unit_price:1292.5,discount_amount:100,total:1192.5,tax_rate:0,tax_amount:0,price_includes_vat:true});
  rows.JournalEntry.length=0;
  const post=(sourceDocumentType,lines)=>postJournal({entities:stores},{entryDate,description:sourceDocumentType,sourceModule:'sales',sourceDocumentType,sourceDocumentId:invoice.id,userId:'staff',lines});
  const {journal:original}=await post('Invoice',[{account_id:'receivable',debit:2385},{account_id:'revenue',credit:2192.5},{account_id:'tax',credit:192.5}]);
  const {journal:correction}=await post('InvoiceVatCorrection',[{account_id:'revenue',debit:192.5},{account_id:'tax',credit:192.5}]);
  invoice.journal_id=original.id;
  const marker={version:1,journal_id:correction.id,journal_number:correction.journal_number,original_journal_id:original.id,tax_account_id:'tax',date:entryDate,recorded_at:recordedAt,subtotal:2000,tax_total:385,original_subtotal:2192.5,original_tax_total:192.5,lines:[{id:first.id,tax_amount:192.5},{id:'previously-untaxed',tax_amount:192.5}]};
  invoice.invoice_vat_correction=marker;
  const snapshot=structuredClone({invoices:rows.Invoice,lines:rows.InvoiceLine,journals:rows.JournalEntry,journalLines:rows.JournalLine});

  const document=await loadInvoiceDocument(stores,invoice.id);
  assert.deepEqual(document.vat_correction,{number:'VAT-INV-123',issued_date:date,accounting_date:entryDate,journal_number:correction.journal_number});
  assert.deepEqual([document.invoice.subtotal,document.invoice.tax_total,document.invoice.total,document.invoice.customer_paid,document.invoice.customer_balance],[2000,385,2385,500,1885]);
  assert.deepEqual(document.lines.map(line=>[line.tax_rate,line.tax_amount,line.total]),[[19.25,192.5,1192.5],[19.25,192.5,1192.5]]);
  assert.equal(document.lines[1].discount_amount,100);
  assert.match(invoiceText(document),/Rectificatif de TVA VAT-INV-123/);
  assert.match(decodeURIComponent(invoiceEmail(document)),/Rectificatif de TVA VAT-INV-123/);
  assert.doesNotMatch(invoiceHtml(document), /\?version=original/);
  const corrected=await print('east',invoice.id);
  assert.equal(corrected.status,200);
  const html=await corrected.text();
  assert.match(html, /<title>VAT-INV-123<\/title>/);
  assert.ok(html.includes(`Facture originale INV-123 du ${entryDate}`));
  assert.ok(html.includes(`Écriture de correction ${correction.journal_number}`));
  assert.match(html,/Voir la facture originale/);
  assert.match(html,/href="\?version=original"/);
  assert.match(html,/<span>385 XAF<\/span>/);

  const originalDocument=await loadInvoiceDocument(stores,invoice.id,undefined,{original:true});
  assert.equal(originalDocument.invoice.tax_total,192.5);
  assert.equal(originalDocument.lines[1].tax_amount,0);
  for (const [query,expected] of [['',document],['?version=original',originalDocument]]) {
    const response=await read('east',invoice.id,query);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),JSON.parse(JSON.stringify(expected)));
    assert.equal((await read('west',invoice.id,query)).status,404);
  }
  const originalPrint=await print('customer-a',invoice.id,undefined,'?version=original');
  assert.equal(originalPrint.status,200);
  const originalHtml=await originalPrint.text();
  assert.match(originalHtml,/<title>INV-123<\/title>/);
  assert.match(originalHtml,/Voir la TVA corrigée/);
  assert.doesNotMatch(originalHtml,/VAT-INV-123|<span>385 XAF<\/span>/);
  assert.equal((await print('west',invoice.id,undefined,'?version=original')).status,404);
  assert.deepEqual({invoices:rows.Invoice,lines:rows.InvoiceLine,journals:rows.JournalEntry,journalLines:rows.JournalLine},snapshot);

  marker.lines[0].tax_amount=190;
  marker.lines[1].tax_amount=195;
  assert.equal((await print('east',invoice.id)).status,409);
  assert.equal((await print('east',invoice.id,undefined,'?version=original')).status,200);
  assert.equal((await read('east',invoice.id)).status,409);
  assert.equal((await read('east',invoice.id,'?version=original')).status,200);
  invoice.invoice_vat_correction=structuredClone(snapshot.invoices[0].invoice_vat_correction);
  rows.JournalLine.find(line=>line.journal_id===correction.id&&line.account_id==='tax').credit=100;
  assert.equal((await print('east',invoice.id)).status,409);
  delete invoice.invoice_vat_correction;
  assert.equal((await print('east',invoice.id)).status,409);
});
