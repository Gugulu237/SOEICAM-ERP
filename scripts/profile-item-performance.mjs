// Read-only timings. Never saves an item or changes business records.
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { database } from '../src/server/db.js';
import { serviceEntities } from '../src/server/entities.js';
import { readRecords } from '../src/server/domain/commercial-workspace.js';
import { componentCatalog, validateProductComponents } from '../src/server/domain/assembly-components.js';
import { itemOptions, validateItemDefinition } from '../src/server/domain/item-settings.js';
import { ITEM_ACCOUNT_FIELDS, availableItemAccount } from '../src/lib/item-accounts.js';
import { stockUnit } from '../src/lib/item-units.js';
import { linkedClerkContext } from '../src/server/clerk-identities.js';

const output = process.argv[2] || 'migration/performance-latest.json';
if (!/^migration\/performance-[a-z-]+\.json$/.test(output) || /-(baseline|after)\.json$/.test(output)) throw new Error('Use migration/performance-latest.json; historical comparison files are preserved.');
let calls = 0;
const stores = new Proxy({}, { get: (_, name) => new Proxy(serviceEntities[name], { get: (target, method) => typeof target[method] === 'function' ? (...args) => { calls++; return target[method](...args); } : target[method] }) });
const timings = [];
async function measure(workflow, run) {
  // Warm the pool first; startup TLS handshakes are a separate first-visit cost.
  await run(); await run();
  const samples = [];
  for (let index = 0; index < 5; index++) {
    calls = 0;
    const start = performance.now();
    await run();
    samples.push({ milliseconds: Math.round(performance.now() - start), store_calls: calls });
  }
  timings.push({ workflow, samples, median_ms: [...samples].sort((a, b) => a.milliseconds - b.milliseconds)[2].milliseconds });
}
try {
  const [products, accounts] = await Promise.all([readRecords(serviceEntities.Product), readRecords(serviceEntities.Account)]);
  const byId = new Map(products.map(product => [product.id, product]));
  const representative = products.filter(p => ['assembly', 'finished_product'].includes(p.inventory_type) && p.components?.length).sort((a, b) => b.components.length - a.components.length)[0];
  if (!representative) throw new Error('No assembly available for the read-only benchmark');
  const input = { ...representative, unit_of_measure: stockUnit(representative) };
  // Normalize only this in-memory fixture, never the stored recipe. Imported
  // recipes may have old U/M labels or lack the new accounting selections.
  input.components = representative.components.map(row => {
    if (row.product_id && !byId.has(row.product_id)) throw new Error('Benchmark assembly has a missing product reference');
    return { ...row, ...(row.product_id ? { unit: stockUnit(byId.get(row.product_id)) } : {}) };
  });
  for (const field of ITEM_ACCOUNT_FIELDS) {
    input[field.field] = accounts.find(a => availableItemAccount(a, field.types))?.id;
    if (!input[field.field]) throw new Error('Benchmark needs active posting accounts');
  }
  await measure('item-selection-catalogue', async () => {
    const catalog = componentCatalog(stores);
    await Promise.all([catalog, itemOptions(stores, catalog.then(value => value.products))]);
  });
  await measure('assembly-save-validation', async () => {
    const checked = await validateItemDefinition(stores, input, representative);
    await validateProductComponents(stores, checked, representative);
  });
  const [binding] = await database().unsafe("SELECT subject FROM erp_private.auth_identities WHERE provider='clerk' LIMIT 1");
  if (binding) await measure('bound-identity-database-only', async () => {
    // SQL timing only; this does not impersonate a session or call an API.
    calls++; await linkedClerkContext(database(), binding.subject);
  });
  const result = { generated_at: new Date().toISOString(), read_only: true, comparison: 'current code only', warmup_runs: 2, measured_runs: 5, component_rows: representative.components.length, timings };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await database().end({ timeout: 5 }); }
