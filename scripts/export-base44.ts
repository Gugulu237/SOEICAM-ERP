// Run from the repository root: Get-Content scripts/export-base44.ts -Raw | npx.cmd --yes base44 exec --privileged --data-env prod
// Uses the CLI's authenticated SDK. No tokens are written to the export.
export {};
declare const base44: any;
const fs = await import('node:fs/promises');
const path = await import('node:path');
const { pathToFileURL } = await import('node:url');
// exec pipes this file into a temporary script, so resolve helpers from the project.
const { readSourceTable, assertSourceTableStable, safeExportError } = await import(pathToFileURL(path.join(Deno.cwd(),'scripts/base44-export-lib.mjs')).href);
const { createHash } = await import('node:crypto');
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const schemaBytes = await fs.readFile(path.join(Deno.cwd(),'src/server/generated/schema.json'));
const schema = JSON.parse(schemaBytes.toString('utf8'));
if (Deno.env.get('BASE44_PRIVILEGED') !== 'true') throw new Error('Use --privileged with the app owner/editor to export every record.');
const appId = Deno.env.get('BASE44_APP_ID');
if (appId !== '6a5164141d12cb92ecfede16') throw new Error('This is not the linked SOEICAM source app.');
const directory = path.join(Deno.cwd(),'exports',new Date().toISOString().replaceAll(':','-').replaceAll('.','-'));
await fs.mkdir(path.join(directory,'files'),{ recursive:true });
const manifest: any = { format:'soeicam-export-v1',source_app_id:appId,source_environment:Deno.env.get('BASE44_DATA_ENV') || 'prod',started_at:new Date().toISOString(),schema_sha256:sha(schemaBytes),tables:{},attachments:[],verified_stable:false };
const tables: Record<string, any[]> = {};
try {
  for (const name of Object.keys(schema)) {
    const snapshot=await readSourceTable(base44,name), content=snapshot.content, rows=JSON.parse(content);tables[name]=rows;
    await fs.writeFile(path.join(directory,`${name}.json`),content);
    manifest.tables[name]={ status:'complete',file:`${name}.json`,count:rows.length,sha256:sha(content),source_status:snapshot.source_status,...(snapshot.source_evidence ? { source_evidence:snapshot.source_evidence } : {}) };
    console.log(snapshot.source_status === 'schema_absent' ? `${name}: schema absent from Base44; new target table remains empty.` : `${name}: ${rows.length} records`);
  }
  // A second full read detects changes while exporting. Stop source writes for cutover.
  for (const name of Object.keys(schema)) {
    assertSourceTableStable(name,manifest.tables[name],await readSourceTable(base44,name));
    if (manifest.tables[name].source_status === 'schema_absent') manifest.tables[name].source_evidence.verified_twice=true;
  }
  manifest.verified_stable=true;
  const references=new Map<string, any>();
  const fields: Record<string,string[]>={ CashCollection:['receipt_file_uris'],CompanySettings:['logo_url'],DriverActivity:['proof_file_uris'],ExpenseRequest:['receipt_url'],FieldSale:['receipt_file_uris'],OutletVisit:['proof_file_uris'],Product:['image_url'] };
  for (const [entity,keys] of Object.entries(fields)) for (const row of tables[entity]) for (const key of keys) {
    for (const uri of Array.isArray(row[key]) ? row[key] : [row[key]]) {
      if (typeof uri !== 'string' || (!uri.startsWith('private/') && !uri.startsWith('https://'))) continue;
      const item=references.get(uri) || { uri,references:[] };item.references.push({ entity,id:row.id,field:key,created_by:row.created_by });references.set(uri,item);
    }
  }
  for (const item of references.values()) {
    const privateFile=item.uri.startsWith('private/');
    const url=privateFile ? (await base44.integrations.Core.CreateFileSignedUrl({ file_uri:item.uri,expires_in:600 })).signed_url : item.uri;
    const parsed=new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[|172\.(1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname)) throw new Error('Unsafe source attachment URL.');
    // Do not follow a redirect to an unreviewed destination.
    const response=await fetch(url,{ redirect:'error' });
    if (!response.ok) throw new Error(`Attachment download failed (${response.status}).`);
    const contentType=(response.headers.get('content-type') || '').split(';')[0];
    if (!['image/jpeg','image/png','image/webp','image/gif','application/pdf'].includes(contentType)) throw new Error(`Unsupported attachment type ${contentType}; review before migration.`);
    const reader=response.body!.getReader(),chunks: Uint8Array[]= [];let size=0;
    for (;;) { const {value,done}=await reader.read();if (done) break;size+=value.length;if (size>20*1024*1024) { await reader.cancel();throw new Error('Attachment exceeds 20 MB.'); }chunks.push(value); }
    const bytes=new Uint8Array(size);let offset=0;for (const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.length; }
    const id=sha(item.uri),file=`files/${id}`;await fs.writeFile(path.join(directory,file),bytes);
    manifest.attachments.push({ ...item,id,file,private:privateFile,size,content_type:contentType,sha256:sha(bytes) });
  }
  manifest.completed_at=new Date().toISOString();
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const absent=Object.keys(schema).filter(name=>manifest.tables[name].source_status === 'schema_absent');
  if (absent.length) console.log(`New tables with no source schema (checked twice): ${absent.join(', ')}`);
  console.log(`Export verified: ${directory}`);
} catch(error) {
  manifest.error=safeExportError(error);
  await fs.writeFile(path.join(directory,'incomplete-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.error(`Export failed: ${manifest.error}`);
  console.error(`Incomplete snapshot (do not import): ${directory}`);
  // Throwing the SDK error causes the CLI to dump Authorization headers.
  Deno.exit(1);
}
