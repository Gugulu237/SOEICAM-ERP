import { readFile,writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { catalog,identifier,readSnapshot,openDatabase,localPath,sha256 } from './migration-lib.mjs';
const directory=process.argv.find((value,i)=>i>1 && !value.startsWith('--'));
if (!directory) throw new Error('Usage: npm run files:import -- exports/<snapshot> [--apply]');
const {manifest,tables}=await readSnapshot(directory), apply=process.argv.includes('--apply');
for (const file of manifest.attachments || []) {
  const bytes=await readFile(localPath(directory,file.file));
  if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error('Attachment checksum or size mismatch.');
}
if (!apply) { console.log(`Verified ${manifest.attachments?.length || 0} attachment files; no uploads. Add --apply to copy to Supabase.`);process.exit(0); }
const sql=await openDatabase(), key=process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key || !process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Configure the Supabase URL and server secret first.');
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{ auth:{ persistSession:false,autoRefreshToken:false } });
const report=[], replacements=new Map();
try {
  const gm=tables.User.find(row=>row.role === 'admin');
  if (!gm && manifest.attachments?.length) throw new Error('An imported General Manager profile is required to own unassigned attachments.');
  for (const file of manifest.attachments || []) {
    const bucket=file.private ? 'soeicam-private' : 'soeicam-public', objectKey='migrated/'+file.id;
    const [existing]=await sql.unsafe('SELECT id,bucket,object_key FROM erp_private.files WHERE legacy_uri=$1',[file.uri]);
    if (existing && (existing.id !== file.id || existing.bucket !== bucket || existing.object_key !== objectKey)) throw new Error('Attachment mapping conflicts with an existing file.');
    if (!existing) {
      const bytes=await readFile(localPath(directory,file.file));
      const {error}=await client.storage.from(bucket).upload(objectKey,bytes,{ contentType:file.content_type,upsert:true });
      if (error) throw error;
      const owner=tables.User.find(row=>row.email && file.references.some(ref=>ref.created_by === row.email)) || gm;
      const roles=['admin'];
      if (file.references.some(ref=>['CashCollection','FieldSale','ExpenseRequest'].includes(ref.entity))) roles.push('cashier');
      if (file.references.some(ref=>ref.entity === 'ExpenseRequest')) roles.push('production_manager');
      if (file.references.some(ref=>ref.entity === 'DriverActivity')) roles.push('warehouse_manager');
      await sql.unsafe('INSERT INTO erp_private.files(id,bucket,object_key,owner_id,original_name,content_type,size,access_roles,legacy_uri) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb,$9)',[file.id,bucket,objectKey,owner.id,file.id,file.content_type,file.size,JSON.stringify(roles),file.uri]);
    }
    // Confirm the target bytes, not just the metadata or upload response.
    const downloaded=await client.storage.from(bucket).download(objectKey);
    if (downloaded.error) throw downloaded.error;
    if (sha256(Buffer.from(await downloaded.data.arrayBuffer())) !== file.sha256) throw new Error('Target attachment checksum mismatch.');
    if (!file.private) replacements.set(file.uri,client.storage.from(bucket).getPublicUrl(objectKey).data.publicUrl);
    report.push({ id:file.id,verified:true });
  }
  // Public URLs change host; private references stay identical through legacy_uri.
  await sql.begin(async tx=>{
    for (const file of manifest.attachments || []) {
      const replacement=replacements.get(file.uri);if (!replacement) continue;
      for (const ref of file.references) {
        if (!catalog[ref.entity]?.fields[ref.field] || catalog[ref.entity].fields[ref.field].type !== 'string') throw new Error('Invalid public attachment field mapping.');
        await tx.unsafe(`UPDATE public.${identifier(catalog[ref.entity].table)} SET ${identifier(ref.field)}=$1 WHERE id=$2 AND ${identifier(ref.field)}=$3`,[replacement,ref.id,file.uri]);
      }
    }
  });
  await writeFile(localPath(directory,'files-report.json'),JSON.stringify({ completed_at:new Date().toISOString(),files:report },null,2));
  console.log(`Verified ${report.length} files in Supabase. Run data:verify again.`);
} finally { await sql.end(); }
