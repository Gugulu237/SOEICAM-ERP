import { authenticateRequest, checkOrigin, apiError } from '@/server/auth';
import { assertEntityAccess } from '@/server/access';
import { serviceEntities } from '@/server/entities';
import { transaction } from '@/server/db';
import { addItemUnit } from '@/server/domain/item-settings';
export const runtime = 'nodejs';
export async function POST(request) {
  try {
    checkOrigin(request);
    const context = await authenticateRequest('inventory');
    assertEntityAccess(context, 'Product', 'create');
    const body = await request.json();
    return Response.json(await transaction(() => addItemUnit(serviceEntities, body)), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
