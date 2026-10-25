import process from 'node:process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyLocalInterface} from './local-readiness.mjs';

// This entry runs only when explicitly started for local UI work. No background
// manufacturing worker runs alongside the existing local ERP process.
const previewHost=process.argv[3] || 'localhost';
if(!['localhost','127.0.0.1'].includes(previewHost))throw Error('The preview host must be localhost or 127.0.0.1.');
if(process.argv[2])process.loadEnvFile(process.argv[2]);
process.env.NEXT_TELEMETRY_DISABLED='1';
process.env.CLERK_TELEMETRY_DISABLED='1';
process.env.SOEICAM_BACKGROUND_JOBS='disabled';
// Share the existing database without competing with the installed server pool.
process.env.SOEICAM_DATABASE_POOL_MAX='2';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
process.argv=[process.execPath,path.join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname',previewHost,'--port','5175'];
// Warm the real pages and download their scripts before reporting app readiness.
// The initial Next.js Ready message only means its listener has started.
setTimeout(async()=>{
  for(let attempt=0;attempt<3;attempt++){
    try{const result=await verifyLocalInterface('http://'+previewHost+':5175',{timeout:30000,pages:['/login','/','/customers?view=map']});console.log('SOEICAM preview ready: '+result.pages+' pages and '+result.assets+' shared assets verified.');return;}
    catch(error){if(attempt===2){console.warn('SOEICAM preview pages are not ready: '+error.message);return;}await new Promise(resolve=>setTimeout(resolve,1500));}
  }
},1500).unref();
await import('../node_modules/next/dist/bin/next');
