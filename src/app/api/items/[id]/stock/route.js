import { authenticateRequest, apiError } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
import { itemStockSummary } from '@/server/domain/item-stock-summary';
import { requestTiming } from '@/server/request-timing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request, { params }) {
  const timing = requestTiming();
  try {
    const context = await timing.measure('auth', authenticateRequest), { id } = await params;
    const summary = await timing.measure('stock', () => itemStockSummary(context, serviceEntities, id));
    return timing.respond(Response.json(summary, { headers: { 'Cache-Control': 'private, no-store' } }));
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return timing.respond(response);
  }
}
