import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { postgresAdapter } from './helpers/postgres-adapter.mjs';

async function load(entry) {
  const output = await build({ entryPoints:[entry], bundle:true, format:'esm', platform:'node', write:false,
    plugins:[{ name:'receipt-fixtures', setup(builder) {
      builder.onResolve({ filter:/^server-only$/ }, () => ({ path:'empty', namespace:'receipt-fixtures' }));
      builder.onResolve({ filter:/(?:^|\/)db\.js$/ }, () => ({ path:'db', namespace:'receipt-fixtures' }));
      builder.onResolve({ filter:/(?:^|\/)supabase\.js$/ }, () => ({ path:'supabase', namespace:'receipt-fixtures' }));
      builder.onResolve({ filter:/(?:^|\/)auth\.js$/ }, () => ({ path:'auth', namespace:'receipt-fixtures' }));
      builder.onResolve({ filter:/(?:^|\/)entities\.js$/ }, () => ({ path:'entities', namespace:'receipt-fixtures' }));
      builder.onResolve({ filter:/(?:^|\/)entity-api\.js$/ }, () => ({ path:'entity-api', namespace:'receipt-fixtures' }));
      builder.onLoad({ filter:/.*/, namespace:'receipt-fixtures' }, args => ({ contents:({
        db:'export const database = () => globalThis.__receiptPhotoDatabase;',
        supabase:'export const supabaseAdmin = () => { throw Error("Storage HTTP is not used to validate receipt references"); };',
        auth:'export const authenticateRequest = async () => globalThis.__receiptPhotoContext;',
        entities:'export const serviceEntities = {};',
        'entity-api':'export const entityOperation = () => {};',
      })[args.path] || '' }));
    } }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
}
const { assertReceiptPhotoFiles, validateReceiptPhotos, validateExpenseReceipt, canReadDeliveryProof, canReadExpiredReturnProof, MAX_FILE_SIZE, canReadPrivateFile } = await load('src/server/files.js');
const commercial = { user:{ id:'agent-user', role:'user' }, employee:{ id:'agent', role:'commercial', status:'active' } };
const admin = { user:{ id:'gm-user', role:'admin' } };
const photo = (changes = {}) => ({ id:'receipt-one', bucket:'soeicam-private', object_key:'clerk-agent/receipt-one.jpg', owner_id:'agent-user', content_type:'image/jpeg', size:1024,
  access_roles:['admin','cashier'], stored_object_key:'clerk-agent/receipt-one.jpg', stored_bucket:'soeicam-private', stored_metadata:{ size:1024, mimetype:'image/jpeg' }, ...changes });
const rejected400 = error => error.status === 400;
const rejected403 = error => error.status === 403;

test('expired return photos are shared only with the recorded pair and warehouse reviewers', async () => {
  const db = new PGlite(), driver = { user: { id: 'driver-user', role: 'user' }, employee: { id: 'driver', role: 'driver', status: 'active' } };
  try {
    await db.exec('CREATE TABLE public.spoilage_record(id text PRIMARY KEY, extra_data jsonb)'); globalThis.__receiptPhotoDatabase = postgresAdapter(db);
    const metadata = { record_type: 'field_expired_return', driver_id: 'driver', commercial_id: 'agent', receipt_file_uris: ['private/receipt-one'], replacement_receipt_file_uris: ['private/replacement'] };
    await db.query('INSERT INTO public.spoilage_record VALUES($1,$2)', ['return', JSON.stringify(metadata)]);
    for (const actor of [driver, commercial, admin, { user: { id: 'warehouse', role: 'user' }, employee: { id: 'warehouse', role: 'warehouse_manager', status: 'active' } }]) assert.equal(await canReadExpiredReturnProof(actor, photo()), true);
    assert.equal(await canReadExpiredReturnProof(driver, photo({ id: 'replacement' })), true);
    assert.equal(await canReadExpiredReturnProof(driver, photo({ id: 'unrelated' })), false);
    assert.equal(await canReadExpiredReturnProof({ ...driver, employee: { ...driver.employee, id: 'different-driver' } }, photo()), false);
    assert.equal(await canReadExpiredReturnProof({ ...commercial, employee: { ...commercial.employee, id: 'different-agent' } }, photo()), false);
    assert.equal(await canReadExpiredReturnProof(driver, photo({ bucket: 'soeicam-public' })), false);
  } finally { delete globalThis.__receiptPhotoDatabase; await db.close(); }
});

test('sale proof needs 1 to 8 distinct private uploaded photos before any registry lookup', async () => {
  let lookups = 0;
  for (const uris of [undefined, null, '', [], Array(9).fill('private/receipt-one'), ['private/receipt-one','private/receipt-one'], ['https://files.example.test/a.png'], ['public/a'], ['private/'], ['private/../a'], ['private/a?token=x'], ['private/a#x'], ['private/a\\b'], ['private/a b'], ['private/a/'], ['private/' + 'x'.repeat(2000)], [{ id:'private/receipt-one' }]]) {
    await assert.rejects(validateReceiptPhotos(commercial, uris, { lookup:async () => { lookups++; return []; } }), rejected400);
  }
  assert.equal(lookups, 0);
  const photos = Array.from({ length:8 }, (_, i) => photo({ id:'receipt-' + i, object_key:'agent/' + i, stored_object_key:'agent/' + i }));
  assert.deepEqual(await validateReceiptPhotos(commercial, photos.map(row => 'private/' + row.id), { lookup:async () => photos }), photos.map(row => 'private/' + row.id));
});

test('only active authenticated accounts can verify their uploaded proof', async () => {
  await assert.rejects(validateReceiptPhotos({}, ['private/receipt-one'], { lookup:async () => assert.fail('Unauthorized lookup') }), error => error.status === 401);
  await assert.rejects(validateReceiptPhotos({ ...commercial, employee:{ ...commercial.employee, status:'suspended' } }, ['private/receipt-one'], { lookup:async () => assert.fail('Suspended lookup') }), rejected403);
  assert.deepEqual(assertReceiptPhotoFiles(commercial, ['private/receipt-one'], [photo()]), ['private/receipt-one']);
  assert.throws(() => assertReceiptPhotoFiles(commercial, ['private/receipt-one'], [photo({ owner_id:'another-user' })]), rejected403);
  const cashier = { user:{ id:'cashier-user', role:'user' }, employee:{ id:'cashier', role:'cashier', status:'active' } };
  assert.throws(() => assertReceiptPhotoFiles(cashier, ['private/receipt-one'], [photo()]), rejected403, 'read access is not authority to attach another employee photo to a sale');
  assert.deepEqual(assertReceiptPhotoFiles(admin, ['private/receipt-one'], [photo()]), ['private/receipt-one']);
  assert.throws(() => assertReceiptPhotoFiles(admin, ['private/receipt-one'], [photo({ access_roles:[] })]), rejected403);
});

test('unregistered, public and metadata-only receipt references cannot record a sale', () => {
  for (const files of [[], null, [photo({ id:'other' })], [photo({ bucket:'soeicam-public', stored_bucket:'soeicam-public' })], [photo({ stored_object_key:null, stored_bucket:null })], [photo({ stored_object_key:'different' })], [photo({ stored_bucket:'another-bucket' })], [photo({ object_key:'' })]]) {
    assert.throws(() => assertReceiptPhotoFiles(commercial, ['private/receipt-one'], files), rejected400);
  }
});

test('receipt evidence requires a positive bounded image file, with matching stored file metadata', () => {
  for (const content_type of ['application/pdf','image/gif','image/svg+xml','application/octet-stream','IMAGE/JPEG']) {
    assert.throws(() => assertReceiptPhotoFiles(commercial, ['private/receipt-one'], [photo({ content_type })]), rejected400);
  }
  for (const size of [0, -1, null, '', true, NaN, Infinity, 1.5, '1e3', MAX_FILE_SIZE + 1]) {
    assert.throws(() => assertReceiptPhotoFiles(commercial, ['private/receipt-one'], [photo({ size })]), rejected400);
  }
  for (const stored_metadata of [{ size:999, mimetype:'image/jpeg' }, { size:1024, mimetype:'application/pdf' }]) {
    assert.throws(() => assertReceiptPhotoFiles(commercial, ['private/receipt-one'], [photo({ stored_metadata })]), rejected400);
  }
  for (const content_type of ['image/jpeg','image/png','image/webp']) {
    assert.deepEqual(assertReceiptPhotoFiles(commercial, ['private/receipt-one'], [photo({ content_type, size:String(MAX_FILE_SIZE), stored_metadata:{ size:MAX_FILE_SIZE, mimetype:content_type } })]), ['private/receipt-one']);
  }
});

test('registered legacy private references normalize to registry IDs and cannot duplicate one photo through aliases', () => {
  const file = photo({ legacy_uri:'private/legacy-app/photo-name.png' });
  assert.deepEqual(assertReceiptPhotoFiles(commercial, [file.legacy_uri], [file]), ['private/receipt-one']);
  assert.throws(() => assertReceiptPhotoFiles(commercial, ['private/receipt-one',file.legacy_uri], [file]), rejected400);
  assert.throws(() => assertReceiptPhotoFiles(commercial, ['private/receipt-one'], [file, photo({ id:'second', legacy_uri:'private/receipt-one' })]), rejected400, 'ambiguous legacy aliases must not choose an arbitrary file');
});

test('registry proof joins the actual private stored object and the request client keeps authenticated ownership', async () => {
  const db = new PGlite();
  try {
    await db.waitReady;
    await db.exec('CREATE SCHEMA erp_private; CREATE SCHEMA storage; CREATE TABLE erp_private.files (id text PRIMARY KEY, bucket text, object_key text, owner_id text, content_type text, size bigint, access_roles jsonb, legacy_uri text); CREATE TABLE storage.objects (bucket_id text, name text, metadata jsonb);');
    await db.query('INSERT INTO erp_private.files VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', ['receipt-one','soeicam-private','clerk-agent/receipt-one.jpg','agent-user','image/jpeg',1024,JSON.stringify(['admin','cashier']),'private/legacy-app/photo.png']);
    globalThis.__receiptPhotoDatabase = postgresAdapter(db);
    await assert.rejects(validateReceiptPhotos(commercial, ['private/receipt-one']), /missing from storage/);
    await db.query('INSERT INTO storage.objects VALUES ($1,$2,$3)', ['soeicam-private','clerk-agent/receipt-one.jpg',JSON.stringify({ size:1024, mimetype:'image/jpeg' })]);
    assert.deepEqual(await validateReceiptPhotos(commercial, ['private/legacy-app/photo.png']), ['private/receipt-one']);
    globalThis.__receiptPhotoContext = commercial;
    const { createClientFromRequest } = await load('src/server/request-client.js');
    const client = await createClientFromRequest();
    assert.deepEqual(await client.validateReceiptPhotos(['private/receipt-one']), ['private/receipt-one']);
    await validateReceiptPhotos(admin, ['private/receipt-one'], { employeeId: 'agent' });
    const saved = (await db.query('SELECT * FROM erp_private.files WHERE id=$1', ['receipt-one'])).rows[0];
    assert.ok(saved.access_roles.includes('employee:agent'));
    assert.equal(canReadPrivateFile({ ...commercial, user: { id: 'new-agent-login', role: 'user' } }, saved), true);
    assert.equal(canReadPrivateFile({ user: { id: 'other-user', role: 'user' }, employee: { id: 'other-agent', role: 'commercial', status: 'active' } }, saved), false);
    await db.query('UPDATE erp_private.files SET owner_id=$1 WHERE id=$2', ['different-user','receipt-one']);
    await assert.rejects(client.validateReceiptPhotos(['private/receipt-one']), rejected403);
  } finally {
    delete globalThis.__receiptPhotoDatabase;
    delete globalThis.__receiptPhotoContext;
    await db.close();
  }
});

test('expense receipts accept accessible private stored PDFs and reject foreign, missing or public attachments', async () => {
  const db = new PGlite();
  const cashier = { user: { id: 'cashier-user', role: 'user' }, employee: { id: 'cashier', role: 'cashier', status: 'active' } };
  try {
    await db.exec('CREATE SCHEMA erp_private; CREATE SCHEMA storage; CREATE TABLE erp_private.files (id text PRIMARY KEY,bucket text,object_key text,owner_id text,content_type text,size bigint,access_roles jsonb,legacy_uri text); CREATE TABLE storage.objects (bucket_id text,name text,metadata jsonb);');
    globalThis.__receiptPhotoDatabase = postgresAdapter(db);
    await db.query('INSERT INTO erp_private.files VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', ['expense','soeicam-private','cashier/voucher.pdf','cashier-user','application/pdf',1024,JSON.stringify(['admin','cashier']),null]);
    await assert.rejects(validateExpenseReceipt(cashier, 'private/expense'), /accessible stored/);
    await db.query('INSERT INTO storage.objects VALUES ($1,$2,$3)', ['soeicam-private','cashier/voucher.pdf',JSON.stringify({size:1024,mimetype:'application/pdf'})]);
    assert.equal(await validateExpenseReceipt(cashier, 'private/expense'), 'private/expense');
    await assert.rejects(validateExpenseReceipt(commercial, 'private/expense'), /accessible stored/);
    await assert.rejects(validateExpenseReceipt(cashier, 'https://example.com/receipt.pdf'), /private expense/);
    await assert.rejects(validateExpenseReceipt(cashier, 'private/missing'), /accessible stored/);
    await db.query('UPDATE erp_private.files SET bucket=$1 WHERE id=$2', ['soeicam-public','expense']);
    await assert.rejects(validateExpenseReceipt(cashier, 'private/expense'), /accessible stored/);
  } finally { delete globalThis.__receiptPhotoDatabase; await db.close(); }
});

test('Operations may view existing proof linked to driver reports without opening unrelated private files', async () => {
  const db = new PGlite();
  const operations = { user: { id: 'operations-user', role: 'user' }, employee: { id: 'operations', role: 'production_manager', status: 'active' } };
  try {
    await db.exec('CREATE TABLE public.driver_activity(id text PRIMARY KEY,proof_file_uris jsonb)');
    globalThis.__receiptPhotoDatabase = postgresAdapter(db);
    const file = photo({ access_roles: ['admin', 'warehouse_manager'] });
    assert.equal(canReadPrivateFile(operations, file), false);
    assert.equal(await canReadDeliveryProof(operations, file), false);
    await db.query('INSERT INTO public.driver_activity VALUES($1,$2)', ['report', JSON.stringify(['private/receipt-one'])]);
    assert.equal(await canReadDeliveryProof(operations, file), true);
    assert.equal(await canReadDeliveryProof(operations, photo({ id: 'unrelated' })), false);
    assert.equal(await canReadDeliveryProof(operations, { ...file, bucket: 'soeicam-public' }), false);
    assert.equal(await canReadDeliveryProof(commercial, file), false);
    await db.query('UPDATE public.driver_activity SET proof_file_uris=$1', [JSON.stringify(['private/legacy/photo.jpg'])]);
    assert.equal(await canReadDeliveryProof(operations, { ...file, legacy_uri: 'private/legacy/photo.jpg' }), true);
  } finally { delete globalThis.__receiptPhotoDatabase; await db.close(); }
});
