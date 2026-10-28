import {authenticateRequest,checkOrigin,apiError} from '@/server/auth';
import {serviceEntities} from '@/server/entities';
import {database,transaction} from '@/server/db';
import {saveAccountingPeriod} from '@/server/domain/accounting-periods';
export const dynamic='force-dynamic';
export async function POST(request){try{checkOrigin(request);const context=await authenticateRequest('accounting'),text=await request.text();if(text.length>10000)throw Error('Period change is too large.');const body=JSON.parse(text);return Response.json(await transaction(async()=>{await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['accounting-periods']);return saveAccountingPeriod(serviceEntities,context,body);}),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return apiError(e);}}
