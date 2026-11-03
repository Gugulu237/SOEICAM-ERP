import {authenticateRequest,apiError,checkOrigin} from '@/server/auth';
import {serviceEntities} from '@/server/entities';
import {database,transaction} from '@/server/db';
import {customerOpeningWorkspace,saveCustomerOpening} from '@/server/domain/customer-opening-balance';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request,{params}){
  try{const context=await authenticateRequest('customers'),{id}=await params;return Response.json(await customerOpeningWorkspace(serviceEntities,context,id),{headers});}catch(error){return apiError(error);}
}
export async function POST(request,{params}){
  try{
    checkOrigin(request);const context=await authenticateRequest('customers'),{id}=await params,text=await request.text();
    if(text.length>4000)throw Object.assign(Error('Customer opening balance request is too large.'),{status:413});
    const body=JSON.parse(text);
    const result=await transaction(async()=>{await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['opening-balances']);return saveCustomerOpening(serviceEntities,context,id,body);});
    return Response.json(result,{headers});
  }catch(error){return apiError(error);}
}
