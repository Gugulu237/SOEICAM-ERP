// Only item-editor selection metadata is cached. Stock, permissions and saved
// transaction records still come from the server on every request.
export function createLookupCache({ now = Date.now, ttl = 30_000 } = {}) {
  let identity = null, generation = 0;
  const entries = new Map();
  const clear = () => { generation++; entries.clear(); };
  return {
    clear,
    setIdentity(value) { if (value !== identity) { identity = value; clear(); } },
    load(key, loader, { fresh = false } = {}) {
      const cached = entries.get(key);
      if (cached?.pending) return cached.pending.then(structuredClone);
      if (!fresh && cached && cached.expires > now()) return Promise.resolve(structuredClone(cached.value));
      const version = generation;
      const entry = {};
      entry.pending = Promise.resolve().then(loader).then(value => {
        if (generation === version && entries.get(key) === entry) {
          entry.value = structuredClone(value); entry.expires = now() + ttl; delete entry.pending;
        }
        return value;
      }).catch(error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.set(key, entry);
      return entry.pending.then(structuredClone);
    },
  };
}

const lookups = createLookupCache();
export const invalidateItemLookups = () => lookups.clear();
export const setItemLookupIdentity = identity => lookups.setIdentity(identity);
export const getItemCatalog = ({ fresh = false } = {}) => lookups.load('component-catalog', async () => {
  const response = await fetch('/api/items/component-catalog', { credentials: 'same-origin', cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Item options could not load');
  return data;
}, { fresh });
