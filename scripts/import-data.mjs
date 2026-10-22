import { writeFile } from 'node:fs/promises';
import { catalog,identifier,readSnapshot,openDatabase,insertSnapshot,controls,localPath,sha256,canonical } from './migration-lib.mjs';
const directory=process.argv.find((value,i)=>i>1 && !value.startsWith('--'));
if (!directory) throw new Error('Usage: npm run data:import -- exports/<snapshot> [--apply]');
const {manifest,tables}=await readSnapshot(directory), apply=process.argv.includes('--apply');
const newEmptyTables=Object.entries(manifest.tables).filter(([,entry])=>entry.source_status === 'schema_absent').map(([name])=>name);
const report={ mode:apply ? 'apply' : 'dry-run',tables:Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.length])),new_empty_tables:newEmptyTables,controls:controls(tables),files_pending:manifest.attachments?.length || 0 };
if (newEmptyTables.length) console.log(`New target tables with no Base44 source schema: ${newEmptyTables.join(', ')}. They will remain empty.`);
if (!apply) { await writeFile(localPath(directory,'import-preview.json'),JSON.stringify(report,null,2));console.log(`Validated all ${Object.keys(tables).length} tables. No database changes. Review import-preview.json, then add --apply.`);process.exit(0); }
const sql=await openDatabase(), runId=sha256(JSON.stringify(canonical(manifest)));
try {
  await sql.begin(async tx=>{
    await tx.unsafe('SELECT pg_advisory_xact_lock(867153021)');
    const [previous]=await tx.unsafe('SELECT id FROM erp_private.migration_runs WHERE id=$1 AND completed_at IS NOT NULL',[runId]);
    if (previous) { console.log('This snapshot was already imported. Run data:verify; no rows changed.');return; }
    for (const schema of Object.values(catalog)) {
      const rows=await tx.unsafe(`SELECT id FROM public.${identifier(schema.table)} LIMIT 1`);
      if (rows.length) throw new Error(`${schema.table} is not empty. Refusing to overwrite existing business data; use a fresh target database.`);
    }
    await tx.unsafe('INSERT INTO erp_private.migration_runs(id,manifest) VALUES ($1,$2::text::jsonb)',[runId,JSON.stringify(manifest)]);
    await insertSnapshot(tx,tables);
    await tx.unsafe('UPDATE erp_private.migration_runs SET completed_at=now(),report=$2::text::jsonb WHERE id=$1',[runId,JSON.stringify(report)]);
  });
  await writeFile(localPath(directory,'import-report.json'),JSON.stringify(report,null,2));
  console.log('Table import completed in one transaction. Run data:verify and files:import before cutover.');
} finally { await sql.end(); }
