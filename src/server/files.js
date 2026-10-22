import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from './db.js';
import { supabaseAdmin } from './supabase.js';
import { requireActiveContext, forbidden } from './access.js';
import { assertModule } from './domain/role-catalogue.js';

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
const formats = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif', 'application/pdf':'pdf' };
const receiptPhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const invalidReceipt = message => Object.assign(new Error(message), { status:400 });
function receiptReferences(uris) {
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 8) throw invalidReceipt('Attach 1 to 8 photos of the supply receipt before submitting this sale.');
  if (uris.some(uri => typeof uri !== 'string' || uri.length > 2000 || !/^private\/[^\s?#\\]+$/.test(uri) || uri.split('/').some(part => !part || part === '.' || part === '..'))) throw invalidReceipt('Receipt photos must be uploaded private attachments.');
  if (new Set(uris).size !== uris.length) throw invalidReceipt('Each receipt photo must be a different uploaded attachment.');
  return uris;
}
const fileBytes = value => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) ? Number(value) : NaN;

// Pure proof check, also used with an injected registry lookup in offline tests.
// The stored object fields must come from Storage, never from the sale payload.
export function assertReceiptPhotoFiles(context, uris, files) {
  const role = requireActiveContext(context), references = receiptReferences(uris), accepted = new Set();
  if (!Array.isArray(files)) throw invalidReceipt('The uploaded receipt photos could not be verified.');
  return references.map(uri => {
    const matches = files.filter(file => file?.id === uri.slice(8) || file?.legacy_uri === uri);
    if (matches.length !== 1) throw invalidReceipt('A receipt photo was not found. Upload the photo again before submitting.');
    const file = matches[0];
    if (file.bucket !== 'soeicam-private') throw invalidReceipt('Receipt photos must be private uploaded attachments.');
    if (file.owner_id !== context.user.id && !(role === 'admin' && Array.isArray(file.access_roles) && file.access_roles.includes('admin'))) throw forbidden('Use receipt photos uploaded by your own account.');
    const size = fileBytes(file.size);
    if (!receiptPhotoTypes.has(file.content_type) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_SIZE) throw invalidReceipt('Receipt photos must be JPEG, PNG or WebP images up to 20 MB.');
    if (typeof file.object_key !== 'string' || !file.object_key || file.stored_object_key !== file.object_key || file.stored_bucket !== file.bucket) throw invalidReceipt('A receipt photo is missing from storage. Upload the photo again before submitting.');
    const storedSize = file.stored_metadata?.size, storedType = file.stored_metadata?.mimetype;
    if ((storedSize !== undefined && fileBytes(storedSize) !== size) || (storedType !== undefined && storedType !== file.content_type)) throw invalidReceipt('A receipt photo does not match its uploaded file. Upload the photo again.');
    if (typeof file.id !== 'string' || !file.id || accepted.has(file.id)) throw invalidReceipt('Each receipt photo must be a different uploaded attachment.');
    accepted.add(file.id);
    return `private/${file.id}`;
  });
}

export async function validateReceiptPhotos(context, uris, { lookup, employeeId } = {}) {
  const role = requireActiveContext(context);
  const references = receiptReferences(uris);
  const files = await (lookup || (async values => {
    const ids = values.map((_, index) => `$${index + 1}`).join(','), aliases = values.map((_, index) => `$${index + values.length + 1}`).join(',');
    return database().unsafe(
      `SELECT f.*, o.name AS stored_object_key, o.bucket_id AS stored_bucket, o.metadata AS stored_metadata FROM erp_private.files f LEFT JOIN storage.objects o ON o.bucket_id = f.bucket AND o.name = f.object_key WHERE f.id IN (${ids}) OR f.legacy_uri IN (${aliases})`,
      [...values.map(uri => uri.slice(8)), ...values],
    );
  }))(references);
  const validated = assertReceiptPhotoFiles(context, references, files);
  if (employeeId && role === 'admin') {
    const principal = 'employee:' + employeeId;
    for (const uri of validated) await database().unsafe('UPDATE erp_private.files SET access_roles = access_roles || jsonb_build_array($2::text) WHERE id = $1 AND NOT access_roles @> jsonb_build_array($2::text)', [uri.slice(8), principal]);
  }
  return validated;
}
export function canReadPrivateFile(context, file) {
  const role = requireActiveContext(context);
  return !!file && file.bucket === 'soeicam-private' && (file.owner_id === context.user.id || file.access_roles?.includes(role) || (context.employee?.id && file.access_roles?.includes('employee:' + context.employee.id)));
}
// Existing driver uploads retain their original ACLs. Operations management may
// also open evidence actually referenced by a protected driver activity report.
export async function canReadDeliveryProof(context, file) {
  const role = requireActiveContext(context);
  if (role !== 'production_manager' || !file || file.bucket !== 'soeicam-private') return false;
  const [report] = await database().unsafe('SELECT id FROM public.driver_activity WHERE proof_file_uris @> jsonb_build_array($1::text) OR ($2::text IS NOT NULL AND proof_file_uris @> jsonb_build_array($2::text)) LIMIT 1', [`private/${file.id}`, file.legacy_uri || null]);
  return !!report;
}
export async function canReadExpiredReturnProof(context, file) {
  const role = requireActiveContext(context), manager = ['admin', 'warehouse_manager', 'production_manager'].includes(role);
  if ((!manager && !['driver', 'commercial'].includes(role)) || file?.bucket !== 'soeicam-private') return false;
  try { assertModule(context, role === 'commercial' ? 'commercial' : 'distribution'); } catch { return false; }
  const [record] = await database().unsafe(`SELECT id FROM public.spoilage_record WHERE extra_data->>'record_type'='field_expired_return'
    AND ((COALESCE(extra_data->'receipt_file_uris','[]'::jsonb) || COALESCE(extra_data->'replacement_receipt_file_uris','[]'::jsonb)) @> jsonb_build_array($1::text)
      OR ($2::text IS NOT NULL AND (COALESCE(extra_data->'receipt_file_uris','[]'::jsonb) || COALESCE(extra_data->'replacement_receipt_file_uris','[]'::jsonb)) @> jsonb_build_array($2::text)))
    AND ($3::boolean OR extra_data->>$4::text=$5::text) LIMIT 1`, [`private/${file.id}`, file.legacy_uri || null, manager, role === 'driver' ? 'driver_id' : 'commercial_id', context.employee?.id || '']);
  return !!record;
}
export async function validateExpenseReceipt(context, uri) {
  requireActiveContext(context);
  if (typeof uri !== 'string' || !uri.startsWith('private/') || uri.length > 2000) throw new Error('Upload a private expense receipt first.');
  const [file] = await database().unsafe('SELECT f.*, o.name AS stored_object_key FROM erp_private.files f LEFT JOIN storage.objects o ON o.bucket_id=f.bucket AND o.name=f.object_key WHERE f.id=$1 OR f.legacy_uri=$2 LIMIT 1', [uri.slice(8), uri]);
  if (!canReadPrivateFile(context, file) || !file.stored_object_key || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(file.content_type) || !(Number(file.size) > 0 && Number(file.size) <= MAX_FILE_SIZE)) throw new Error('This expense receipt is not an accessible stored image or PDF.');
  return `private/${file.id}`;
}
export async function uploadFile(context, file, privateFile) {
  const role = requireActiveContext(context);
  if (!privateFile && !['admin','production_manager','warehouse_manager','procurement'].includes(role)) throw forbidden('Product images require an inventory manager.');
  if (!file || typeof file.arrayBuffer !== 'function' || !formats[file.type] || !file.size || file.size > MAX_FILE_SIZE) throw new Error('Choose a JPEG, PNG, WebP, GIF or PDF up to 20 MB.');
  if (!privateFile && file.type === 'application/pdf') throw new Error('Product images must be images.');
  const id = randomUUID(), bucket = privateFile ? 'soeicam-private' : 'soeicam-public';
  const objectKey = `${context.authUserId}/${id}.${formats[file.type]}`;
  const client = supabaseAdmin();
  const { error } = await client.storage.from(bucket).upload(objectKey, await file.arrayBuffer(), { contentType:file.type, upsert:false });
  if (error) throw new Error('File storage is unavailable. Check that the Supabase buckets have been created.');
  const access = ['admin',...({ commercial:['cashier'],driver:['warehouse_manager'],hotesse:[],cashier:['cashier','production_manager'] }[role] || ['cashier','production_manager'])];
  try {
    await database().unsafe('INSERT INTO erp_private.files (id,bucket,object_key,owner_id,original_name,content_type,size,access_roles) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb)',[id,bucket,objectKey,context.user.id,String(file.name).slice(0,255),file.type,file.size,JSON.stringify(access)]);
  } catch (error) { await client.storage.from(bucket).remove([objectKey]); throw error; }
  if (privateFile) return { file_uri:`private/${id}` };
  return { file_url:client.storage.from(bucket).getPublicUrl(objectKey).data.publicUrl };
}
export async function signedFile(context, uri, seconds = 300) {
  requireActiveContext(context);
  if (typeof uri !== 'string' || !uri.startsWith('private/') || uri.length > 2000) throw new Error('Invalid private file reference.');
  const [file] = await database().unsafe('SELECT * FROM erp_private.files WHERE id = $1 OR legacy_uri = $2 LIMIT 1',[uri.slice(8),uri]);
  if (!canReadPrivateFile(context, file) && !await canReadDeliveryProof(context, file) && !await canReadExpiredReturnProof(context, file)) throw forbidden('This attachment is not available to your account.');
  const ttl = Math.min(900,Math.max(30,Number(seconds) || 300));
  const { data,error } = await supabaseAdmin().storage.from(file.bucket).createSignedUrl(file.object_key,ttl);
  if (error) throw new Error('Unable to open this attachment.');
  return { signed_url:data.signedUrl };
}
