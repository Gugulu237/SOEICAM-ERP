import { writeFile } from 'node:fs/promises';
import { catalog,identifier,readSnapshot,openDatabase,normalizedRecord,recordHash,controls,localPath,canonical } from './migration-lib.mjs';
import { flattenRecord } from '../src/server/query.js';
const directory=process.argv[2];
if (!directory) throw new Error('Usage: npm run data:verify -- exports/<snapshot>');
const {manifest,tables}=await readSnapshot(directory), sql=await openDatabase(), actual={}, report={ verified_at:new Date().toISOString(),tables:{},files:[],new_empty_tables:Object.entries(manifest.tables).filter(([,entry])=>entry.source_status === 'schema_absent').map(([name])=>name) };
try {
  await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY',async tx=>{
    for (const [name,schema] of Object.entries(catalog)) {
      const rows=(await tx.unsafe(`SELECT * FROM public.${identifier(schema.table)} ORDER BY id`)).map(flattenRecord);
      // Authentication linking is expected to add this field after import.
      if (name === 'User') rows.forEach(row=>{ row.auth_user_id=tables.User.find(source=>source.id === row.id)?.auth_user_id ?? null; });
      actual[name]=rows;
      const expected=tables[name].map(row=>normalizedRecord(row,schema));
      for (const file of manifest.attachments || []) {
        if (file.private) continue;
        const [mapped]=await tx.unsafe('SELECT bucket,object_key FROM erp_private.files WHERE legacy_uri=$1',[file.uri]);
        if (!mapped) continue;
        for (const ref of file.references.filter(ref=>ref.entity === name)) {
          const row=expected.find(row=>row.id === ref.id);
          if (row) row[ref.field]=process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/,'')+'/storage/v1/object/public/'+mapped.bucket+'/'+mapped.object_key;
        }
      }
      report.tables[name]={ expected:expected.length,actual:rows.length,match:recordHash(expected) === recordHash(rows) };
    }
    for (const attachment of manifest.attachments || []) {
      const [row]=await tx.unsafe('SELECT id FROM erp_private.files WHERE legacy_uri=$1',[attachment.uri]);
      report.files.push({ uri:attachment.uri,imported:Boolean(row) });
    }
  });
  report.controls_match=JSON.stringify(canonical(controls(tables))) === JSON.stringify(canonical(controls(actual)));
  report.passed=Object.values(report.tables).every(table=>table.match) && report.controls_match && report.files.every(file=>file.imported);
  await writeFile(localPath(directory,'verification-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ passed:report.passed,tables:Object.keys(report.tables).length,new_empty_tables:report.new_empty_tables,mismatched:Object.entries(report.tables).filter(([,v])=>!v.match).map(([k])=>k),files_pending:report.files.filter(f=>!f.imported).length,controls_match:report.controls_match }));
  if (!report.passed) process.exitCode=1;
} finally { await sql.end(); }
