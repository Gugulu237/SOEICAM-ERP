import { authenticateRequest,checkOrigin,apiError } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
import { database,transaction } from '@/server/db';
import { warehouseTransfer } from '@/server/domain/warehouse-transfer';
export const runtime='nodejs';
export async function POST(request) {
  try {
    checkOrigin(request);
    const context=await authenticateRequest(), input=await request.json();
    if (typeof input?.requestKey !== 'string' || input.requestKey.length > 100) throw Error('Invalid transfer reference.');
    const result=await transaction(async () => {
      await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['WarehouseTransfer:'+input.requestKey]);
      return warehouseTransfer(context,serviceEntities,input);
    });
    return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {return apiError(error);}
}
