export const READ_OPERATIONS = new Set(['filter', 'list', 'get', 'count', 'aggregate']);
export async function readBatch(context, calls, perform, failure) {
  if (!Array.isArray(calls) || !calls.length || calls.length > 20) throw new Error('A read batch must contain between 1 and 20 calls');
  return Promise.all(calls.map(async call => {
    try {
      if (!call || typeof call.entity !== 'string' || !READ_OPERATIONS.has(call.operation) || !Array.isArray(call.args)) throw Object.assign(new Error('Only table reads are permitted in a read batch'), { status: 403 });
      // perform is the same scoped, checked entity operation as the table API.
      return { ok: true, value: await perform(context, call.entity, call.operation, call.args) };
    } catch (error) { return failure(error); }
  }));
}
