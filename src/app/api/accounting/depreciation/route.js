import {authenticateRequest,apiError,checkOrigin} from '@/server/auth';
import {requireActiveContext,forbidden} from '@/server/access';
import {assertModule} from '@/server/domain/role-catalogue';
import {canReadManagementAccounting} from '@/lib/management-access';
import {synchronizeAssetDepreciation} from '@/server/asset-depreciation-worker';
export const runtime='nodejs';
export const dynamic='force-dynamic';

// The request can only run saved schedules. It cannot supply rates, accounts,
// a posting date or authorization, including for read-only report viewers.
export async function POST(request) {
  try {
    checkOrigin(request);
    const context=await authenticateRequest('accounting'),role=requireActiveContext(context);
    assertModule({...context,role},'accounting');
    if(!['admin','cashier'].includes(role)&&!canReadManagementAccounting(role,context.employee))throw forbidden('Depreciation checks require accounting access.');
    const body=await request.text();if(body.trim()&&body.trim()!=='{}')throw Error('This check only processes saved asset schedules.');
    return Response.json(await synchronizeAssetDepreciation(),{headers:{'Cache-Control':'private, no-store'}});
  } catch(error){return apiError(error);}
}
