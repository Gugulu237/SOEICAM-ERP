import {authenticateRequest,apiError,checkOrigin} from '@/server/auth';
import {serviceEntities} from '@/server/entities';
import {database,transaction} from '@/server/db';
import {openingPositionWorkspace,saveOpeningPosition} from '@/server/domain/opening-position';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){try{return Response.json(await openingPositionWorkspace(serviceEntities,await authenticateRequest()),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return apiError(error);}}
export async function POST(request){try{checkOrigin(request);const context=await authenticateRequest(),text=await request.text();if(text.length>500000)throw Error('Opening details are too large.');const body=JSON.parse(text);return Response.json(await transaction(async()=>{await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['opening-balances']);return saveOpeningPosition(serviceEntities,context,body);}),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return apiError(error);}}
