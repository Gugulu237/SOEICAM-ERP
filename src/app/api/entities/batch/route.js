import { authenticateRequest, checkOrigin, apiError } from '@/server/auth';
import { entityOperation } from '@/server/entity-api';
import { readBatch } from '@/server/domain/read-batch';
import { requestTiming } from '@/server/request-timing';
export const runtime = 'nodejs';
export async function POST(request) {
  const timing = requestTiming();
  try {
    checkOrigin(request);
    const context = await timing.measure('auth', authenticateRequest), body = await request.json();
    const results = await timing.measure('reads', () => readBatch(context, body.calls, entityOperation, async error => {
      const response = apiError(error), data = await response.json();
      return { ok: false, status: response.status, error: data.error };
    }));
    return timing.respond(Response.json({ results }, { headers: { 'Cache-Control': 'private, no-store' } }));
  } catch (error) { return timing.respond(apiError(error)); }
}
