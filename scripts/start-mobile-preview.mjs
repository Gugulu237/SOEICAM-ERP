import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const checkOnly=process.argv.includes('--check');
const supplied=process.argv.slice(2).find(value=>value!=='--check');
const candidates=[
  supplied,
  process.env.SOEICAM_ENV_FILE,
  path.join(root,'.env.local'),
  path.join(homedir(),'Documents','Codex','2026-10-17','new-chat-3','SOEICAM-ERP','.env.local'),
].filter(Boolean);
const envFile=supplied || candidates.find(file=>existsSync(file));
if(!envFile||!existsSync(envFile))throw Error('The local ERP configuration was not found. Pass its .env.local path to this launcher.');
const launcher=path.join(root,'scripts','start-responsive-preview.mjs');
if(!existsSync(launcher)||!existsSync(path.join(root,'node_modules','next','dist','bin','next')))throw Error('The Next.js workspace or its installed dependencies are missing.');
const url='http://127.0.0.1:5175/dev-preview?mode=mobile&route=%2Fsales%2Fnew&phone=390';
if(checkOnly){
  console.log(JSON.stringify({workspace:root,configurationFound:true,nextInstalled:true,preview:url}));
}else{
  process.env.NEXT_PUBLIC_APP_URL='http://127.0.0.1:5175';
  process.argv=[process.execPath,launcher,envFile,'127.0.0.1'];
  console.log('Starting the SOEICAM mobile preview. Keep this PowerShell window open.');
  console.log('After the server is ready, open: '+url);
  await import('./start-responsive-preview.mjs');
}
