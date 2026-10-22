import { readFile,readdir } from 'node:fs/promises';
import { openDatabase,sha256,catalog } from './migration-lib.mjs';
const apply=process.argv.includes('--apply');
const files=(await readdir('supabase/migrations')).filter(name=>name.endsWith('.sql')).sort();
if (!apply) { console.log(`Dry run: ${files.length} SQL migration(s), 56 ERP tables and two storage buckets. Add --apply to create them in DATABASE_URL.`);process.exit(0); }
const sql=await openDatabase();
try {
  await sql.begin(async tx=>{
    await tx.unsafe('SELECT pg_advisory_xact_lock(867153020)');
    await tx.unsafe('CREATE SCHEMA IF NOT EXISTS erp_private; REVOKE ALL ON SCHEMA erp_private FROM public, anon, authenticated; CREATE TABLE IF NOT EXISTS erp_private.schema_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now());');
    for (const name of files) {
      const source=await readFile('supabase/migrations/'+name,'utf8'), hash=sha256(source);
      const [done]=await tx.unsafe('SELECT sha256 FROM erp_private.schema_migrations WHERE name=$1',[name]);
      if (done) { if (done.sha256 !== hash) throw new Error(`Applied migration ${name} was edited. Restore it and add a new migration.`);continue; }
      if (name === '202610170001_erp_schema.sql') {
        const names=new Set(Object.values(catalog).map(schema=>schema.table));
        const existing=(await tx.unsafe("SELECT tablename FROM pg_tables WHERE schemaname='public'")).filter(row=>names.has(row.tablename));
        if (existing.length) throw new Error('The target already contains ERP-named tables. Refusing to change an untracked existing schema; select a fresh target.');
      }
      await tx.unsafe(source);
      await tx.unsafe('INSERT INTO erp_private.schema_migrations(name,sha256) VALUES ($1,$2)',[name,hash]);
      console.log('Applied '+name);
    }
  });
  const { createClient }=await import('@supabase/supabase-js');
  const key=process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key) throw new Error('Tables created. Set Supabase URL and server secret, then rerun to create storage buckets.');
  const storage=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{ auth:{ persistSession:false,autoRefreshToken:false } }).storage;
  for (const [name,publicBucket] of [['soeicam-public',true],['soeicam-private',false]]) {
    const { data,error }=await storage.getBucket(name);
    if (data) { if (data.public !== publicBucket) throw new Error(`Bucket ${name} has the wrong privacy setting.`);continue; }
    if (error && ![400,404].includes(Number(error.statusCode || error.status))) throw error;
    const result=await storage.createBucket(name,{ public:publicBucket,fileSizeLimit:20*1024*1024,allowedMimeTypes:['image/jpeg','image/png','image/webp','image/gif','application/pdf'] });
    if (result.error) throw result.error;
    console.log('Created '+name);
  }
} finally { await sql.end(); }
