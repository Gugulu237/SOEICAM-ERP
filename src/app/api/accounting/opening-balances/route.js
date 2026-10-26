import {authenticateRequest,apiError,checkOrigin} from '@/server/auth';
import {serviceEntities} from '@/server/entities';
import {database,transaction} from '@/server/db';
import {openingBalancesWorkspace,postOpeningBalances} from '@/server/domain/opening-balances';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){try{const context=await authenticateRequest();return Response.json(await openingBalancesWorkspace(serviceEntities,context),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return apiError(error);}}
export async function POST(request){try{checkOrigin(request);const context=await authenticateRequest(),text=await request.text();if(text.length>100000)throw Error('Opening balances are too large.');const body=JSON.parse(text);const result=await transaction(async()=>{await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['opening-balances']);return postOpeningBalances(serviceEntities,context,body);});return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});}catch(error){return apiError(error);}}
