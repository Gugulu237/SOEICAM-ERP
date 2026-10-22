import { authenticateRequest, checkOrigin, apiError } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
import { transaction } from '@/server/db';
import { quickEditItem } from '@/server/domain/item-quick-edit';
import { requestTiming } from '@/server/request-timing';

export const runtime = 'nodejs';
export async function POST(request) {
  const timing = requestTiming();
  try {
    checkOrigin(request);
    const context = await timing.measure('auth', authenticateRequest);
    const input = await request.json();
    const saved = await timing.measure('save', () => transaction(() => quickEditItem(context, serviceEntities, input)));
    return timing.respond(Response.json(saved, { headers: { 'Cache-Control': 'private, no-store' } }));
  } catch (error) { return timing.respond(apiError(error)); }
}
