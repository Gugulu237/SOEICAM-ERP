// Expose durations, never SQL, request arguments or identity data. Inspect the
// Server-Timing response header to separate authentication from business work.
const requests = new WeakMap();
export const attachRequestTiming = (request, timing) => requests.set(request,timing);
export const timingForRequest = request => request && requests.get(request);
export function requestTiming(clock = () => performance.now()) {
  const started = clock(), spans = [];
  return {
    async measure(name, run) {
      if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid timing name');
      const start = clock();
      try { return await run(); }
      finally { spans.push(`${name};dur=${Math.max(0, clock() - start).toFixed(1)}`); }
    },
    respond(response) {
      response.headers.set('Server-Timing', [...spans, `total;dur=${Math.max(0, clock() - started).toFixed(1)}`].join(', '));
      return response;
    },
  };
}
