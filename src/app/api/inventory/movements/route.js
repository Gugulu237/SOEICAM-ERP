import { authenticateRequest, apiError } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
import { warehouseMovements } from '@/server/domain/warehouse-movements';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try { return Response.json(await warehouseMovements(await authenticateRequest('inventory'),serviceEntities,Object.fromEntries(new URL(request.url).searchParams)),{headers:{'Cache-Control':'private, no-store'}}); }
  catch(error) { return apiError(error); }
}
