import { authenticateRequest, apiError } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
import { inventoryOverview } from '@/server/domain/inventory-overview';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return Response.json(await inventoryOverview(await authenticateRequest(), serviceEntities), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
