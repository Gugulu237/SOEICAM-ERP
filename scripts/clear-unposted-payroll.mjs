import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { inspectPayroll, clearPayroll, restorePayroll } from './payroll-cleanup-lib.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--apply') { options.apply = true; continue; }
  if (!['--backup-dir', '--expected-hash', '--restore'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Use --apply --backup-dir <new absolute directory> --expected-hash <review hash>, or --restore <backup file>. Without these arguments this is read-only.');
  options[key.slice(2)] = args[++i];
}
if (options.apply && options.restore) throw Error('Choose clear or restore, not both.');
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is not configured.');
const url = new URL(process.env.DATABASE_URL);
const target = createHash('sha256').update([url.hostname, url.port, url.pathname, url.username].join('|')).digest('hex');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10, ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require' });
try {
  const result = options.restore ? await restorePayroll(sql, { target, backupFile: options.restore }) : options.apply ? await clearPayroll(sql, { target, expectedHash: options['expected-hash'], backupDir: options['backup-dir'] }) : await inspectPayroll(sql, { target });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Never print a driver message containing connection information or record data.
  console.error(error.code ? `Payroll operation stopped (${error.code}); no partial cleanup was committed.` : error.message.replaceAll(process.env.DATABASE_URL, '[database]'));
  process.exitCode = 1;
} finally { await sql.end(); }
