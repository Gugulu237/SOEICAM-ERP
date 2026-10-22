import postgres from 'postgres';
import { inspectDatabase, applyFreshStart, restoreFreshStart, sha256 } from './fresh-start-lib.mjs';

const args=process.argv.slice(2),values={};
for(let i=0;i<args.length;i++) {
  const key=args[i];
  if(['--apply','--restore'].includes(key)){values[key]=true;continue;}
  if(!['--backup-dir','--target','--snapshot','--actor'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('Usage: node --env-file=<app .env.local> scripts/reset-business-data.mjs [--apply|--restore] --backup-dir <absolute new directory> --target <dry-run target> --snapshot <dry-run hash> [--actor <owner>]');
  values[key]=args[++i];
}
if(values['--apply']&&values['--restore'])throw Error('Choose reset or restore, not both.');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required.');
let url;
try{url=new URL(process.env.DATABASE_URL);}catch{throw Error('DATABASE_URL must be a valid database connection URL.');}
const targetKey=sha256([url.hostname,url.port,url.pathname,url.username].join('|'));
let sql;
try {
  sql=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:10,ssl:process.env.DATABASE_SSL==='disable'?false:'require'});
  const options={targetKey,backupDir:values['--backup-dir'],expectedTarget:values['--target'],expectedHash:values['--snapshot'],actor:values['--actor']||'Project owner'};
  const result=values['--apply']?await applyFreshStart(sql,options):values['--restore']?await restoreFreshStart(sql,options):await inspectDatabase(sql,options);
  console.log(JSON.stringify({mode:values['--apply']?'reset committed':values['--restore']?'restore committed':'dry run; no changes',...result},null,2));
} catch(error) {
  // Driver errors may contain connection parameters. Report only our reviewed
  // messages, or a SQLSTATE code without potentially sensitive driver details.
  const safe=error.code?`Database operation failed (${error.code}); no partial reset was committed.`:String(error.message).replaceAll(process.env.DATABASE_URL,'[database]');
  console.error(safe);process.exitCode=1;
} finally {if(sql)await sql.end();}
