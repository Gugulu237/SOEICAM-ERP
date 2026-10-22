import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import catalog from '../src/server/generated/schema.json' with { type:'json' };

export { catalog };
export const CLEAR_ENTITIES = Object.freeze(['Bill','CashCollection','CashHandover','CashHandoverAllocation','DepreciationEntry','Dispatch','DispatchLine','DispatchRequest','DriverActivity','ExpenseRequest','FieldSale','FieldSaleLine','GoodsReceipt','GoodsReceiptLine','Invoice','InvoiceLine','JournalEntry','JournalLine','OutletVisit','Payment','PaymentAllocation','PayrollLine','PayrollRun','ProductionMaterial','ProductionOrder','PurchaseOrder','PurchaseOrderLine','QualityCheck','SalesOrder','SalesOrderLine','SpoilageRecord','StockBalance','StockMovement','TreasuryTransaction']);
const clear = new Set(CLEAR_ENTITIES);
const id = value => '"'+String(value).replaceAll('"','""')+'"';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
export const snapshotHash = tables => sha256(JSON.stringify(canonical(tables)));
const sorted = rows => [...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
function databaseRow(entity,row) {
  const next={...row};
  // Postgres.js returns numeric as text by default. Preserve exact decimal
  // strings rather than rounding money while creating a recovery snapshot.
  for(const [key,field] of Object.entries(catalog[entity].fields))if(['number','integer'].includes(field.type)&&next[key]!=null)next[key]=String(next[key]);
  return next;
}
const policyHash = sha256(JSON.stringify({version:1,clear:CLEAR_ENTITIES,zero:['Account.balance','Account.opening_balance','Account.opening_debit','Account.opening_credit','Customer.balance','Supplier.balance','TreasuryAccount.balance','Budget.actual_spent','Budget.remaining_amount','FixedAsset.financial_values']}));
const zeroExtra = {Account:['opening_balance','opening_debit','opening_credit']};
const assetRemoved = ['depreciation_plan','disposal_payload','asset_request_payload'];
const moneyKey = /(^|_)(amount|balance|quantity|on_hand|stock_value|total_value|debit|credit|spent|paid|received|owed|proceeds|gain_loss|net_book_value|acquisition_cost|salvage_value|accumulated_depreciation)(_|$)/i;
const allowedConfiguration = {
  Product:new Set(['purchase_price','purchase_cost','standard_cost','selling_price','current_cost','components']),
  Customer:new Set(['credit_limit','price_list','invoice_defaults']),
  Supplier:new Set(['supplier_items','supplier_request_payload']),
  Account:new Set(['account_request_payload']),
  CompanySettings:new Set(['role_catalogue','role_catalog','role_profiles','item_units','delivery_zones','company_profile']),
  Employee:new Set(['bonus_plan']),
  FixedAsset:new Set([...assetRemoved,'asset_revision']),
};
function nonzero(value) {
  if(value==null || value===false)return false;
  if(typeof value==='number')return !Number.isFinite(value)||value!==0;
  if(typeof value!=='string')return true;
  const text=value.trim();
  if(!text)return false;
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))return true;
  // Inspect mantissa digits exactly: Number() can underflow/overflow and hide
  // an unknown financial balance. Zero remains zero at any exponent.
  return /[1-9]/.test(text.split(/e/i)[0]);
}

// Unknown monetary/quantity caches are not guessed or silently kept. Known
// configuration prices and recipe quantities are definitions, not balances.
export function validateExtras(tables) {
  const issues=[];
  for(const [entity,rows] of Object.entries(tables)) {
    if(clear.has(entity) || entity==='AuditLog')continue;
    for(const row of rows) {
      if(row.extra_data!=null && (typeof row.extra_data!=='object'||Array.isArray(row.extra_data))) {
        issues.push({entity,id:row.id,path:'extra_data (must be an object)'});continue;
      }
      const walk=(value,keys=[],financial=false)=>{
        if(value && typeof value==='object') {
          for(const [key,child] of Object.entries(value)) {
            if(!keys.length && (allowedConfiguration[entity]?.has(key) || zeroExtra[entity]?.includes(key)))continue;
            walk(child,[...keys,key],financial || moneyKey.test(key));
          }
        } else if(financial && nonzero(value))issues.push({entity,id:row.id,path:'extra_data.'+keys.join('.')});
      };
      walk(row.extra_data || {});
    }
  }
  return issues;
}

export function resetRow(entity,row) {
  const next=structuredClone(row);
  if(['Account','Customer','Supplier','TreasuryAccount'].includes(entity))next.balance=0;
  if(entity==='Account')for(const key of zeroExtra.Account)if(Object.hasOwn(next.extra_data || {},key))next.extra_data[key]=0;
  if(entity==='Budget'){next.actual_spent=0;next.remaining_amount=next.budget_amount ?? 0;}
  if(entity==='FixedAsset') {
    for(const key of ['acquisition_cost','salvage_value','accumulated_depreciation','net_book_value','disposal_proceeds','disposal_gain_loss'])next[key]=0;
    for(const key of ['journal_id','last_depreciation_date','disposal_date'])next[key]=null;
    next.status='fully_depreciated';
    next.extra_data={...next.extra_data,fresh_start_requires_opening:true};
    for(const key of assetRemoved)delete next.extra_data[key];
    if(Object.hasOwn(next.extra_data,'asset_revision'))next.extra_data.asset_revision=Number(next.extra_data.asset_revision || 0)+1;
  }
  return next;
}
export function expectedReset(tables,marker) {
  return Object.fromEntries(Object.entries(tables).map(([entity,rows])=>[entity,clear.has(entity)?[]:sorted([...rows.map(row=>databaseRow(entity,resetRow(entity,row))),...(entity==='AuditLog'&&marker?[marker]:[])])]));
}
async function schemaCheck(sql) {
  const tables=await sql.unsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const expected=Object.values(catalog).map(s=>s.table).sort(),actual=tables.map(r=>r.tablename).sort();
  if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Public table catalogue differs from the 56 audited ERP tables; inspect unknown or missing tables before reset.');
  // Do not permit a new field to hide a financial balance from the policy.
  const columns=await sql.unsafe("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name");
  const expectedColumns=Object.values(catalog).flatMap(s=>[...Object.keys(s.fields),'extra_data'].map(column_name=>({table_name:s.table,column_name}))).sort((a,b)=>a.table_name.localeCompare(b.table_name)||a.column_name.localeCompare(b.column_name));
  columns.sort((a,b)=>a.table_name.localeCompare(b.table_name)||a.column_name.localeCompare(b.column_name));
  if(JSON.stringify(canonical(columns))!==JSON.stringify(canonical(expectedColumns)))throw Error('ERP columns differ from the audited schema; inspect the schema before reset.');
}
async function snapshot(sql,{targetKey='' }={}) {
  await schemaCheck(sql);
  const [identity]=await sql.unsafe('SELECT current_database() AS database_name, current_user AS database_user');
  const tables={};
  for(const [entity,schema] of Object.entries(catalog))tables[entity]=sorted((await sql.unsafe(`SELECT * FROM public.${id(schema.table)} ORDER BY id`)).map(row=>databaseRow(entity,row)));
  const settings=tables.CompanySettings.map(r=>({id:r.id,company_name:r.company_name,brand_name:r.brand_name}));
  const target=sha256(JSON.stringify(canonical({identity,targetKey,settings})));
  return {tables,target,hash:snapshotHash(tables),issues:validateExtras(tables)};
}
function summary(s) {
  return {target:s.target,hash:s.hash,policy:policyHash,issues:s.issues,counts:Object.fromEntries(Object.entries(s.tables).map(([name,rows])=>[name,{count:rows.length,action:clear.has(name)?'clear activity':['Account','Customer','Supplier','TreasuryAccount','Budget','FixedAsset'].includes(name)?'preserve; zero financial values':'preserve unchanged'}]))};
}
export async function inspectDatabase(sql,options={}) {
  return sql.begin(async tx=>{await tx.unsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return summary(await snapshot(tx,options));});
}
async function lock(sql) {
  await sql.unsafe("SET LOCAL lock_timeout='3s'");
  await sql.unsafe("SET LOCAL statement_timeout='120s'");
  await sql.unsafe('SELECT pg_advisory_xact_lock(867153021)');
  await sql.unsafe('LOCK TABLE '+Object.values(catalog).map(s=>'public.'+id(s.table)).join(',')+' IN EXCLUSIVE MODE');
}
async function safeBackupDirectory(directory) {
  if(!directory || !path.isAbsolute(directory))throw Error('An absolute backup directory outside a Git repository is required.');
  const resolvedParent=await realpath(path.dirname(directory));
  if(path.resolve(path.dirname(directory)).toLowerCase()!==resolvedParent.toLowerCase())throw Error('Backup parent resolves through a symbolic link; choose a direct local directory.');
  for(let check=resolvedParent;;check=path.dirname(check)) {
    try {await stat(path.join(check,'.git'));throw Error('Backup directory must be outside a Git repository.');}catch(error){if(error.code!=='ENOENT')throw error;}
    if(path.dirname(check)===check)break;
  }
  await mkdir(directory,{recursive:false,mode:0o700});
}
async function writeBackup(directory,s,resetId,actor) {
  await safeBackupDirectory(directory);
  const manifest={format:'soeicam-fresh-start-v1',policy:policyHash,created_at:new Date().toISOString(),target:s.target,before_hash:s.hash,reset_id:resetId,actor,files:{}};
  for(const [entity,rows] of Object.entries(s.tables)) {
    const bytes=JSON.stringify(rows,null,2)+'\n',file=entity+'.json';
    await writeFile(path.join(directory,file),bytes,{flag:'wx',mode:0o600,flush:true});
    manifest.files[entity]={file,count:rows.length,sha256:sha256(bytes)};
  }
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600,flush:true});
  const verified=await readBackup(directory);
  if(snapshotHash(verified.tables)!==s.hash)throw Error('Backup readback differs from database; no reset was applied.');
  return manifest;
}
export async function readBackup(directory) {
  const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
  if(manifest.format!=='soeicam-fresh-start-v1'||manifest.policy!==policyHash)throw Error('Backup format or reset policy does not match.');
  const tables={};
  if(JSON.stringify(Object.keys(manifest.files).sort())!==JSON.stringify(Object.keys(catalog).sort()))throw Error('Backup is missing an ERP table.');
  for(const entity of Object.keys(catalog)) {
    const entry=manifest.files[entity];
    if(entry.file!==entity+'.json')throw Error('Unsafe backup filename.');
    const bytes=await readFile(path.join(directory,entry.file));
    if(sha256(bytes)!==entry.sha256)throw Error('Backup checksum mismatch: '+entity);
    const rows=JSON.parse(bytes.toString('utf8'));
    if(!Array.isArray(rows)||rows.length!==entry.count||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Backup record count/identity mismatch: '+entity);
    tables[entity]=sorted(rows);
  }
  if(snapshotHash(tables)!==manifest.before_hash)throw Error('Backup content hash mismatch.');
  return {manifest,tables};
}
function assertExpected(s,{expectedTarget,expectedHash}) {
  if(!expectedTarget||s.target!==expectedTarget)throw Error('Database target does not match the reviewed dry run.');
  if(!expectedHash||s.hash!==expectedHash)throw Error('Data changed since the dry run; inspect a fresh dry run before applying.');
  if(s.issues.length)throw Error('Unknown nonzero financial fields require inspection: '+s.issues.map(v=>v.entity+'.'+v.path).join(', '));
}
async function updateRow(sql,entity,before,after) {
  const changed=Object.keys(after).filter(key=>JSON.stringify(canonical(before[key]))!==JSON.stringify(canonical(after[key])));
  if(!changed.length)return;
  const params=changed.map(key=>key==='extra_data'?JSON.stringify(after[key]):after[key]);params.push(before.id);
  await sql.unsafe(`UPDATE public.${id(catalog[entity].table)} SET ${changed.map((key,i)=>id(key)+'=$'+(i+1)+(key==='extra_data'?'::text::jsonb':'')).join(',')} WHERE id=$${params.length}`,params);
}
async function insertRow(sql,entity,row) {
  const keys=Object.keys(row),params=keys.map(key=>key==='extra_data'||['array','object'].includes(catalog[entity].fields[key]?.type)?JSON.stringify(row[key]):row[key]);
  await sql.unsafe(`INSERT INTO public.${id(catalog[entity].table)} (${keys.map(id).join(',')}) VALUES (${keys.map((key,i)=>'$'+(i+1)+(key==='extra_data'||['array','object'].includes(catalog[entity].fields[key]?.type)?'::text::jsonb':'')).join(',')})`,params);
}
export async function applyFreshStart(sql,options) {
  const {backupDir,actor='Project owner'}=options;
  return sql.begin(async tx=>{
    await lock(tx);
    const before=await snapshot(tx,options);assertExpected(before,options);
    const resetId='fresh-start-'+randomUUID();
    await writeBackup(backupDir,before,resetId,actor);
    for(const entity of CLEAR_ENTITIES)await tx.unsafe(`DELETE FROM public.${id(catalog[entity].table)}`);
    for(const [entity,rows] of Object.entries(before.tables))if(!clear.has(entity))for(const row of rows)await updateRow(tx,entity,row,resetRow(entity,row));
    const now=new Date().toISOString(),marker=Object.fromEntries(Object.keys(catalog.AuditLog.fields).map(key=>[key,null]));
    Object.assign(marker,{id:resetId,created_date:now,updated_date:now,created_by:actor,user_id:actor,user_name:actor,action:'fresh_start_reset',module:'administration',entity_type:'CompanySettings',entity_id:before.tables.CompanySettings[0]?.id || null,description:'Owner-authorized fresh start: transactional activity and financial balances reset; definitions and audit history retained.',reason:'Prepare for real business data',extra_data:{fresh_start_backup_hash:before.hash,cleared_tables:CLEAR_ENTITIES,policy:policyHash}});
    await insertRow(tx,'AuditLog',marker);
    const expected=expectedReset(before.tables,marker),after=await snapshot(tx,options);
    if(snapshotHash(expected)!==after.hash)throw Error('Post-reset verification failed; all database changes rolled back.');
    const receipt={reset_id:resetId,target:after.target,before_hash:before.hash,after_hash:after.hash,completed_at:now,counts:summary(before).counts};
    // Written before commit; a restore additionally verifies the committed marker.
    await writeFile(path.join(backupDir,'reset-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600,flush:true});
    return receipt;
  });
}
export async function restoreFreshStart(sql,options) {
  const {manifest,tables}=await readBackup(options.backupDir),receipt=JSON.parse(await readFile(path.join(options.backupDir,'reset-receipt.json'),'utf8'));
  return sql.begin(async tx=>{
    await lock(tx);
    const current=await snapshot(tx,options);assertExpected(current,options);
    if(current.target!==manifest.target||receipt.reset_id!==manifest.reset_id||receipt.before_hash!==manifest.before_hash||current.hash!==receipt.after_hash||!current.tables.AuditLog.some(r=>r.id===manifest.reset_id&&r.action==='fresh_start_reset'))throw Error('Restore refused: target or state differs from the completed reset, or new business activity exists.');
    for(const entity of Object.keys(catalog))await tx.unsafe(`DELETE FROM public.${id(catalog[entity].table)} WHERE ${entity==='User'?'false':'true'}`);
    // User rows cannot be deleted because private sign-in links are retained.
    for(const [entity,rows] of Object.entries(tables)) {
      if(entity==='User')continue;
      for(const row of rows)await insertRow(tx,entity,row);
    }
    const restored=await snapshot(tx,options);
    if(restored.hash!==manifest.before_hash)throw Error('Restore verification failed; all changes rolled back.');
    return {restored:true,target:restored.target,hash:restored.hash};
  });
}
