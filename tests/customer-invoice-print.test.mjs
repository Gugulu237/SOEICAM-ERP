import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {catalogueFromStored, decorateEmployee, validateRoleProfile} from '../src/server/domain/role-catalogue.js';
import {customerInvoicePrintPath} from '../src/lib/customer-mobile-summary.js';
import {fixture, user, date} from './helpers/cashier.mjs';

const path = 'src/app/api/customers/[id]/invoices/[invoiceId]/print/route.js';
const output = await build({entryPoints:[path], bundle:true, format:'esm', platform:'node', write:false, plugins:[{
  name:'customer-print-fixture',
  setup(b) {
    const mocks = {
      auth: `export async function authenticateRequest(){const context=globalThis.__customerPrint.context;if(!context)throw Object.assign(Error('Please sign in.'),{status:401});return context;}
        export const apiError=error=>Response.json({error:error.message},{status:error.status||400});`,
      db: 'export const transaction=fn=>fn();export const database=()=>{throw Error("Unexpected database call");};',
      files: 'export const validateReceiptPhotos=()=>{},validateExpenseReceipt=()=>{};',
      entities: 'export const serviceEntities=new Proxy({},{get:(_,name)=>globalThis.__customerPrint.stores[name]});export const entityStore=name=>serviceEntities[name];',
      'server-only': '',
    };
    b.onResolve({filter:/^(?:@\/server\/auth|\.\/(?:auth|entities|db|files)\.js|server-only)$/}, args => {
      if (args.path.startsWith('./') && !args.importer.includes('/src/server/')) return;
      const name = args.path.split('/').at(-1).replace(/\.js$/,'');
      return {path:name, namespace:'customer-print-fixture'};
    });
    b.onLoad({filter:/.*/, namespace:'customer-print-fixture'}, args => ({contents:mocks[args.path]}));
  },
}]});
const {GET} = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));

function staffContext(modules, {template='employee', status='active', fullAccess=true}={}) {
  const role = validateRoleProfile({key:'print_clerk', label:'Print clerk', category:'Operations', template_role:template, modules});
  if (!fullAccess) role.module_permissions_version=4;
  const roleCatalogue = catalogueFromStored({roles:{print_clerk:role}});
  const account = {...user, preferred_language:'en'};
  const employee = decorateEmployee(account, {id:'clerk', role:'print_clerk', status}, roleCatalogue);
  return {user:account, employee, roleCatalogue, role:template};
}

const print = (id, invoiceId, headers) => GET(new Request('http://localhost', {headers}), {params:Promise.resolve({id,invoiceId})});

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

test('the recent invoice link is encoded and excluded from opening or reversed entries', () => {
  const row={id:'invoice/id',status:'paid'};
  assert.equal(customerInvoicePrintPath('branch & town',row),'/api/customers/branch%20%26%20town/invoices/invoice%2Fid/print');
  assert.equal(customerInvoicePrintPath('branch',{...row,opening_batch_id:'history'}),null);
  assert.equal(customerInvoicePrintPath('branch',{...row,sale_reversal:{}}),null);
});
