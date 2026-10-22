import { authenticateRequest, apiError, checkOrigin } from '@/server/auth';
import { entityOperation } from '@/server/entity-api';
import { requestTiming } from '@/server/request-timing';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request,{ params }) {
  const timing = requestTiming();
  try {
    checkOrigin(request);
    const context = await timing.measure('auth', authenticateRequest), { entity } = await params;
    const text = await request.text();
    if (text.length > 2_000_000) throw new Error('The request is too large.');
    const { operation,args } = JSON.parse(text);
    const value = await timing.measure('operation', () => entityOperation(context,entity,operation,args));
    return timing.respond(Response.json(value,{ headers:{ 'Cache-Control':'private, no-store' } }));
  } catch(error) { return timing.respond(apiError(error)); }
}
