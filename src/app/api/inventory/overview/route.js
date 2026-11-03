import { authenticateRequest, apiError } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
import { inventoryOverview } from '@/server/domain/inventory-overview';
import {inventorySnapshotResponse} from '@/server/inventory-snapshot-response';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const params=new URL(request.url).searchParams,compact=params.get('compact')==='1';
    const data=await inventoryOverview(await authenticateRequest('inventory'),serviceEntities,{compact,includeRemoved:!compact||params.get('removed')==='1'});
    return inventorySnapshotResponse(data,request.headers.get('if-none-match'));
  } catch (error) { return apiError(error); }
}
