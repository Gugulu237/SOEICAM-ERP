import { authenticateRequest,apiError,checkOrigin } from '@/server/auth';
import { requireActiveContext } from '@/server/access';
import { assertModule } from '@/server/domain/role-catalogue';
import { serviceEntities } from '@/server/entities';
import { transaction,database } from '@/server/db';
import { companyProfileAction } from '@/server/domain/company-profile';
export const dynamic='force-dynamic';
const respond=profile=>Response.json(profile,{headers:{'Cache-Control':'private, no-store'}});
async function context(){const c=await authenticateRequest();requireActiveContext(c);assertModule(c,'admin');return c;}
export async function GET(){try{return respond(await companyProfileAction(serviceEntities,await context()));}catch(e){return apiError(e);}}
export async function POST(request){try{checkOrigin(request);const c=await context(),text=await request.text();if(text.length>100000)throw Error('Company profile is too large.');const body=JSON.parse(text);return respond(await transaction(async()=>{await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['company-profile']);return companyProfileAction(serviceEntities,c,body);}));}catch(e){return apiError(e);}}
