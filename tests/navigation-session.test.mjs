import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationSession, navigationLabel, pageMemoryKey, workspaceHref } from '../src/lib/navigation-session.js';

function fixture(key = 'account-one') {
  const values = new Map(); let id = 0;
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  return { storage, session: createNavigationSession({ key, storage, makeId: () => String(++id) }) };
}

test('Back and Forward keep query selections; a new destination discards the forward branch', () => {
  const { session } = fixture();
  const first = session.commit('/inventory');
  const vans = session.commit('/inventory?group=vehicles');
  const van = session.commit('/inventory?group=vehicles&warehouse=van1');
  session.commit('/commercial?employee=agent1');
  session.commit('/inventory?group=vehicles&warehouse=van1', { kind: 'traverse', entryId: van.id });
  assert.equal(session.getSnapshot().canForward, true);
  session.commit('/inventory?group=vehicles', { kind: 'traverse', entryId: vans.id });
  session.commit('/inventory', { kind: 'traverse', entryId: first.id });
  assert.equal(session.getSnapshot().canBack, false);
  assert.equal(session.getSnapshot().canForward, true);
  session.commit('/sales?tab=invoices');
  assert.deepEqual(session.getSnapshot().entries.map(entry => entry.href), ['/inventory', '/sales?tab=invoices']);
  assert.equal(session.getSnapshot().canForward, false);
});

test('automatic replacements and repeated clicks do not create extra Back steps', () => {
  const { session } = fixture();
  session.commit('/sales');
  const marker = session.commit('/commercial');
  session.commit('/commercial?employee=agent1', { kind: 'replace' });
  const same = session.commit('/commercial?employee=agent1');
  assert.equal(same.id, marker.id);
  assert.equal(session.getSnapshot().entries.length, 2);
  assert.deepEqual(session.getSnapshot().recent, ['/commercial?employee=agent1', '/commercial', '/sales']);
});

test('reload restores the native history position, page filters and scrolling without mixing accounts', () => {
  const { session, storage } = fixture();
  const route = '/inventory?section=items&filter=finished';
  const list = session.commit(route);
  session.writePage(pageMemoryKey(route) + '\ntable', { search: 'yogurt', page: 3, sort: 'name' });
  session.saveScroll(route, [0, 720]);
  session.commit('/items/product1');
  const reloaded = createNavigationSession({ key: 'account-one', storage });
  reloaded.commit(route, { entryId: list.id });
  assert.equal(reloaded.getSnapshot().canForward, true);
  assert.equal(reloaded.lastPage('/inventory'), route);
  assert.equal(reloaded.readPage(pageMemoryKey(route) + '\ntable').page, 3);
  assert.deepEqual(reloaded.scrollFor(route), [0, 720]);
  const other = createNavigationSession({ key: 'account-two', storage });
  other.commit('/');
  assert.deepEqual(other.getSnapshot().recent, ['/']);
  assert.equal(other.readPage(pageMemoryKey(route) + '\ntable'), undefined);
  assert.equal(other.scrollFor(route), undefined);
  reloaded.flush(); other.flush();
});

test('history and state stay bounded and tolerate corrupt or unavailable storage', () => {
  const { session } = fixture();
  for (let n = 0; n < 200; n++) { session.commit('/customers?customer=' + n); session.writePage('filter:' + n, String(n)); }
  assert.equal(session.getSnapshot().entries.length, 60);
  assert.equal(session.getSnapshot().recent.length, 15);
  assert.equal(session.readPage('filter:0'), undefined);
  assert.equal(session.readPage('filter:199'), '199');
  const blocked = createNavigationSession({ key: 'blocked', storage: { getItem() { throw Error('Unavailable'); }, setItem() { throw Error('Unavailable'); } } });
  blocked.commit('/inventory'); blocked.writePage('search', 'milk'); blocked.flush();
  assert.equal(blocked.readPage('search'), 'milk');
  session.flush();
});

test('recent pages accept only workspace addresses, and page memory ignores query ordering', () => {
  for (const url of ['https://other.test', '//other.test', '/\\other.test', '/api/files', '/auth/callback?token=private', '/login']) assert.equal(workspaceHref(url), null);
  assert.equal(pageMemoryKey('/inventory?filter=finished&section=items'), pageMemoryKey('/inventory?section=items&filter=finished'));
  assert.equal(navigationLabel('/inventory?group=vehicles'), 'Inventory / Vehicles');
  assert.equal(navigationLabel('/commercial?view=stock'), 'Commercial Dashboard / Stock');
});
