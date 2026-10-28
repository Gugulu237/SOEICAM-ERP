import { authenticateRequest, apiError, checkOrigin } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
import { database, transaction } from '@/server/db';
import { deleteUnusedAccount } from '@/server/domain/account-lifecycle';
import { saveAccountDefinition } from '@/server/domain/account-definitions';
export const dynamic='force-dynamic';
export async function POST(request) {
  try {
    checkOrigin(request);const context=await authenticateRequest('accounting'),text=await request.text();
    if(text.length>20000)throw Error('Account details are too large.');
    const body=JSON.parse(text);
    const result=await transaction(async()=>{await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['chart-of-accounts']);if(body.action && !['save','delete'].includes(body.action))throw Error('Unknown account action.');return body.action==='delete'?deleteUnusedAccount(serviceEntities,context,body):saveAccountDefinition(serviceEntities,context,body);});
    return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
  } catch(e){return apiError(e);}
}
