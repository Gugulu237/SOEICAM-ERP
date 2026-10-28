import { authenticateRequest, apiError } from '@/server/auth';
import { assertEntityAccess } from '@/server/access';
import { serviceEntities } from '@/server/entities';
import { componentCatalog } from '@/server/domain/assembly-components';
import { itemOptions } from '@/server/domain/item-settings';
import { requestTiming } from '@/server/request-timing';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const timing = requestTiming();
  try {
    const context = await timing.measure('auth', () => authenticateRequest('inventory'));
    assertEntityAccess(context, 'Product', 'create');
    // Account, vendor and unit lookups do not need to wait for the product read.
    const [catalog, options] = await timing.measure('catalogue', async () => {
      const catalogPromise = componentCatalog(serviceEntities);
      return Promise.all([
      catalogPromise,
      itemOptions(serviceEntities, catalogPromise.then(value => value.products)),
      ]);
    });
    return timing.respond(Response.json({ ...catalog, ...options }, { headers: { 'Cache-Control': 'private, no-store' } }));
  } catch (error) { return timing.respond(apiError(error)); }
}
