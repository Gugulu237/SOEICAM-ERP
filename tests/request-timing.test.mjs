import test from 'node:test';
import assert from 'node:assert/strict';
import { requestTiming } from '../src/server/request-timing.js';

test('server timing measures fulfilled and rejected work without leaking result data', async () => {
  let now = 0;
  const timing = requestTiming(() => now);
  assert.deepEqual(await timing.measure('auth', async () => { now = 14.25; return { secret: 'hidden' }; }), { secret: 'hidden' });
  await assert.rejects(timing.measure('operation', async () => { now = 25; throw Error('private database failure'); }));
  const response = timing.respond(Response.json({ error: 'Request failed' }, { status: 500 }));
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('server-timing'), 'auth;dur=14.3, operation;dur=10.8, total;dur=25.0');
  await assert.rejects(timing.measure('unsafe;name', async () => 1), /Invalid timing/);
});
