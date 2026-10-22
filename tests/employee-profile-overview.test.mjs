import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('employee profile reports are restricted to the GM and scoped to the selected employee', async () => {
  const output = await build({
    entryPoints: ['src/app/api/admin/employees/[id]/overview/route.js'],
    bundle: true, format: 'esm', platform: 'node', write: false,
    alias: { '@': process.cwd() + '/src' },
    plugins: [{ name: 'profile-route-fixture', setup(builder) {
      builder.onResolve({ filter: /^@\/server\/(auth|entities)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'profile-route-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'profile-route-fixture' }, args => ({ contents: args.path === 'auth'
        ? 'export const authenticateRequest = async () => globalThis.__profileRoute.context; export const apiError = error => Response.json({ error: error.message }, { status: error.status || 400, headers: { "Cache-Control": "private, no-store" } });'
        : 'export const entityStore = name => ({ get: async id => { globalThis.__profileRoute.reads.push({ name, id }); return globalThis.__profileRoute.employee; }, filter: async (query, sort, limit) => { globalThis.__profileRoute.reads.push({ name, query, sort, limit }); return [{ id: name + "-one" }]; } });' }));
    } }],
  });
  const { GET } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
  const request = new Request('http://localhost:5174/api/admin/employees/agent/overview');
  const params = { params: Promise.resolve({ id: 'agent' }) };
  globalThis.__profileRoute = { context: { role: 'driver' }, employee: { id: 'agent', role: 'commercial' }, reads: [] };
  try {
    const denied = await GET(request, params);
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(globalThis.__profileRoute.reads, []);

    globalThis.__profileRoute.context = { role: 'admin' };
    const response = await GET(request, params);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json();
    assert.equal(body.employee.id, 'agent');
    assert.equal(body.records.driverReports[0].id, 'DriverActivity-one');
    assert.equal(body.records.outletReports[0].id, 'OutletVisit-one');
    assert.equal(body.reportsIncomplete, false);
    assert.deepEqual(globalThis.__profileRoute.reads.map(read => read.name), ['Employee', 'ExpenseRequest', 'FieldSale', 'Dispatch', 'DriverActivity', 'OutletVisit']);
    assert.deepEqual(globalThis.__profileRoute.reads.find(read => read.name === 'Dispatch').query, { $or: [{ driver_id: 'agent' }, { salesperson_id: 'agent' }] });
    assert.deepEqual(globalThis.__profileRoute.reads.find(read => read.name === 'OutletVisit').query, { employee_id: 'agent' });
    assert.ok(globalThis.__profileRoute.reads.slice(1).every(read => read.limit === 50));

    globalThis.__profileRoute.reads.length = 0;
    globalThis.__profileRoute.employee = null;
    const missing = await GET(request, params);
    assert.equal(missing.status, 404);
    assert.deepEqual(globalThis.__profileRoute.reads.map(read => read.name), ['Employee']);
  } finally { delete globalThis.__profileRoute; }
});
