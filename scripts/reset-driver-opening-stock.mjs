import postgres from 'postgres';
import {inspectCutover,applyCutover,hash} from './driver-stock-cutover-lib.mjs';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  if(args[i]==='--apply'){options.apply=true;continue;}
  if(args[i]==='--review-opening-accounts'){options.reviewOpeningAccounts=true;continue;}
  if(!['--target','--snapshot','--review','--backup-dir','--actor','--offset-account'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw Error('Use [--review-opening-accounts] or [--apply --target HASH --snapshot HASH --review HASH --backup-dir PATH --actor NAME]. Without --apply this command is read-only.');
  options[args[i].slice(2)]=args[++i];
}
let sql;
try{
  if(options.apply&&options.reviewOpeningAccounts)throw Error('Opening-account review is read-only and cannot be combined with --apply.');
  if(options['offset-account'])throw Error('This opening baseline uses dedicated temporary clearing. Remove the obsolete --offset-account argument.');
  if(!process.env.DATABASE_URL)throw Error('Load the configured SOEICAM environment file first.');
  const url=new URL(process.env.DATABASE_URL);
  const targetKey=hash([url.hostname,url.port,url.pathname,url.username]);
  sql=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:10,ssl:process.env.DATABASE_SSL==='disable'?false:'require',onnotice:()=>{}});
  const common={targetKey,offsetAccountId:options['offset-account'],reviewOpeningAccounts:options.reviewOpeningAccounts};
  const result=options.apply?await applyCutover(sql,{...common,expectedTarget:options.target,expectedSnapshot:options.snapshot,expectedReview:options.review,backupDir:options['backup-dir'],actor:options.actor}):await inspectCutover(sql,common);
  // ASCII JSON transport survives Windows PowerShell 5's native-output encoding.
  // ConvertFrom-Json restores accented product/account names without mojibake.
  console.log(JSON.stringify(result,null,2).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));
}catch(e){
  console.error(e.code?'Cutover failed ('+e.code+'). No partial database changes were committed.':String(e.message).replaceAll(process.env.DATABASE_URL||'\0','[database]'));
  process.exitCode=1;
}finally{if(sql)await sql.end();}
