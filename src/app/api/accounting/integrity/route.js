import {authenticateRequest,apiError} from '@/server/auth';
import {serviceEntities} from '@/server/entities';
import {transaction} from '@/server/db';
import {accountingIntegrity} from '@/server/domain/accounting-integrity';
export const dynamic='force-dynamic';
export async function GET(){try{const context=await authenticateRequest('accounting');return Response.json(await transaction(()=>accountingIntegrity(serviceEntities,context)),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return apiError(e);}}
