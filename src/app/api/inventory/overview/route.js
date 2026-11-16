import { authenticateRequest, apiError } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
import { inventoryOverview } from '@/server/domain/inventory-overview';
import {inventorySnapshotResponse} from '@/server/inventory-snapshot-response';
import {transaction} from '@/server/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const params=new URL(request.url).searchParams,compact=params.get('compact')==='1';
    const context=await authenticateRequest('inventory');
    const data=await transaction(()=>inventoryOverview(context,serviceEntities,{compact,includeRemoved:!compact||params.get('removed')==='1'}));
    return inventorySnapshotResponse(data,request.headers.get('if-none-match'));
  } catch (error) { return apiError(error); }
}
