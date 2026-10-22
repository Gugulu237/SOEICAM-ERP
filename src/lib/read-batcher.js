// Coalesce queued and in-flight table reads without caching settled data or batching writes.
export function createReadBatcher(send, { schedule = queueMicrotask, limit = 20 } = {}) {
  let queued = [], scheduled = false;
  const inFlight = new Map();
  function settle(entry, error, value) {
    // An invalidated request may finish after a newer read of the same record.
    if (inFlight.get(entry.key) === entry) inFlight.delete(entry.key);
    if (error) entry.reject(error);
    else entry.resolve(value);
  }
  function flush() {
    const entries = queued; queued = []; scheduled = false;
    for (let index = 0; index < entries.length; index += limit) {
      const group = entries.slice(index, index + limit);
      Promise.resolve().then(() => send(group.map(entry => entry.call))).then(results => {
        if (!Array.isArray(results) || results.length !== group.length) throw new Error('The server returned an incomplete read batch');
        results.forEach((result, i) => {
          if (result.ok) settle(group[i], null, result.value);
          else settle(group[i], Object.assign(new Error(result.error || 'Request failed.'), { status: result.status, data: { error: result.error }, response: { status: result.status, data: { error: result.error } } }));
        });
      }).catch(error => group.forEach(entry => settle(entry, error)));
    }
  }
  const read = call => {
    const key = JSON.stringify(call);
    if (inFlight.has(key)) return inFlight.get(key).promise;
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    const entry = { key, call: JSON.parse(key), promise, resolve, reject };
    queued.push(entry); inFlight.set(key, entry);
    if (!scheduled) { scheduled = true; schedule(flush); }
    return promise;
  };
  // Writes/session changes must not join a read that began before the change.
  // Existing callers still receive their own request's result.
  read.clear = () => inFlight.clear();
  return read;
}
