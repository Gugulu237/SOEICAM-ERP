import { writeFile } from 'node:fs/promises';
import { catalog, identifier, readSnapshot, openDatabase, localPath } from './migration-lib.mjs';
import { planJsonRepair, applyJsonRepair } from './repair-json-lib.mjs';
import { safeExportError } from './base44-export-lib.mjs';

const args = process.argv.slice(2);
const directory = args.find(value => !value.startsWith('--'));
if (!directory || args.filter(value => !value.startsWith('--')).length !== 1 || args.some(value => value.startsWith('--') && value !== '--apply')) {
  throw new Error('Usage: npm run data:repair-json -- exports/<snapshot> [--apply]');
}
const snapshot = await readSnapshot(directory), apply = args.includes('--apply');
const sql = await openDatabase();
try {
  const summary = await sql.begin(apply ? 'ISOLATION LEVEL SERIALIZABLE' : 'ISOLATION LEVEL REPEATABLE READ READ ONLY', async tx => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'");
    if (apply) {
      await tx.unsafe('SELECT pg_advisory_xact_lock(867153021)');
      const names = ['erp_private.migration_runs', 'erp_private.files', ...Object.values(catalog).map(schema => 'public.' + identifier(schema.table))];
      await tx.unsafe(`LOCK TABLE ${names.join(',')} IN SHARE ROW EXCLUSIVE MODE`);
    }
    console.log('Checking every imported record against the snapshot before JSON repair...');
    const plan = await planJsonRepair(tx, snapshot, { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL });
    if (apply) await applyJsonRepair(tx, plan);
    return plan.summary;
  });
  await writeFile(localPath(directory, apply ? 'json-repair-report.json' : 'json-repair-preview.json'), JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...summary }, null, 2));
  console.log(JSON.stringify(summary));
  console.log(apply ? 'JSON repair completed in one transaction. Run data:verify again.' : 'All records match the export after decoding JSON. No database changes. Add --apply to repair.');
} catch (error) {
  console.error('JSON repair stopped: ' + safeExportError(error));
  process.exitCode = 1;
} finally { await sql.end(); }
