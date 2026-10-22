import { spawn } from 'node:child_process';
import { mkdir, stat, readdir, appendFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyLocalInterface } from './local-readiness.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const address = 'http://localhost:5174';
const next = path.join(root, 'node_modules/next/dist/bin/next');
const envFile = path.join(root, '.env.local');
const buildFile = path.join(root, '.next/BUILD_ID');
const logFile = path.join(root, 'logs/local-server.log');
const checkOnly = process.argv.includes('--check');
process.chdir(root);
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function health() {
  try {
    const response = await fetch(address + '/api/health', { signal: AbortSignal.timeout(1500), cache: 'no-store' });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

async function newerThanBuild(target, builtAt) {
  if (!existsSync(target)) return false;
  const info = await stat(target);
  if (!info.isDirectory()) return info.mtimeMs > builtAt;
  for (const entry of await readdir(target)) {
    if (await newerThanBuild(path.join(target, entry), builtAt)) return true;
  }
  return false;
}

function openLogin() {
  const url = address + '/login';
  console.log('\nOpen SOEICAM: ' + url);
  if (process.platform !== 'win32') return;
  // A fixed localhost URL, opened in the normal Windows browser session.
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', () => console.log('Open the address above in Chrome or Edge.'));
  browser.unref();
}

function runNext(args) {
  const child = spawn(process.execPath, [next, ...args], { cwd: root, env: process.env, windowsHide: true, stdio: ['inherit', 'pipe', 'pipe'] });
  let logQueue = Promise.resolve();
  for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on('data', bytes => {
      target.write(bytes);
      logQueue = logQueue.then(() => appendFile(logFile, bytes)).catch(() => {});
    });
  }
  const finished = new Promise(resolve => {
    child.once('error', error => { console.error('Could not launch Next.js: ' + error.message); resolve(1); });
    child.once('exit', async code => { await logQueue; resolve(code ?? 1); });
  });
  return { child, finished };
}

try {
  if (!existsSync(next)) throw new Error('Dependencies are missing. Run npm.cmd ci in the project folder.');
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'DATABASE_URL', ...(process.env.NEXT_PUBLIC_AUTH_PROVIDER === 'clerk'
    ? ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'] : ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'])];
  const missing = required.filter(key => !process.env[key]?.trim());
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SECRET_KEY');
  if (missing.length) throw new Error('Missing settings in .env.local: ' + missing.join(', '));
  const builtAt = existsSync(buildFile) ? (await stat(buildFile)).mtimeMs : 0;
  let needsBuild = !builtAt;
  for (const input of ['.env.local', 'src', 'public', 'next.config.mjs', 'package.json', 'package-lock.json', 'tailwind.config.js', 'postcss.config.js']) {
    if (await newerThanBuild(path.join(root, input), builtAt)) { needsBuild = true; break; }
  }
  console.log('Project: ' + root);
  console.log('Connection settings: present');
  console.log('Production build: ' + (needsBuild ? 'needs building' : 'available'));
  if (checkOnly) process.exit(0);

  await mkdir(path.dirname(logFile), { recursive: true });
  await writeFile(logFile, 'SOEICAM local startup ' + new Date().toISOString() + '\n');
  console.log('Startup log: ' + logFile);

  const existing = await health();
  if (existing) {
    if (existing.application !== 'SOEICAM ERP') throw new Error('Port 5174 belongs to another application. Close it before starting SOEICAM.');
    if (!existing.configured || needsBuild) throw new Error('An older SOEICAM server is already using port 5174. Stop its terminal with Ctrl+C, then run this launcher again.');
    try { await verifyLocalInterface(address); }
    catch (error) { throw new Error('The existing server cannot render its login page: ' + error.message + '. Stop its terminal with Ctrl+C, then run this launcher again.'); }
    console.log('SOEICAM is already responding.');
    openLogin();
  } else {
    if (needsBuild) {
      console.log('\nBuilding with your saved connection settings...');
      await import('./prepare-next.mjs');
      if (await runNext(['build', '--webpack']).finished !== 0) throw new Error('The build failed. See the startup log above.');
    }
    console.log('\nStarting SOEICAM. Keep this window open while using the app.');
    const server = runNext(['start', '--hostname', 'localhost', '--port', '5174']);
    let exited = false;
    server.finished.then(() => { exited = true; });
    const stop = () => server.child.kill();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    let ready = false;
    for (let attempt = 0; attempt < 30 && !exited; attempt++) {
      const status = await health();
      if (status?.application === 'SOEICAM ERP' && status.configured) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (ready) {
      try {
        const interfaceStatus = await verifyLocalInterface(address);
        console.log('\nVerified: the login page and all ' + interfaceStatus.assets + ' JavaScript/CSS assets are responding.');
        openLogin();
      } catch (error) {
        server.child.kill();
        await server.finished;
        throw new Error('The server did not render the login interface: ' + error.message + '. See logs/local-server.log.');
      }
    } else if (!exited) {
      console.error('\nNext.js started, but Windows could not reach its local health check.');
      console.error('Keep this window open and share logs/local-server.log for diagnosis.');
    }
    const code = await server.finished;
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.exitCode = code;
  }
} catch (error) {
  console.error('\nSOEICAM could not start: ' + error.message);
  process.exitCode = 1;
}
