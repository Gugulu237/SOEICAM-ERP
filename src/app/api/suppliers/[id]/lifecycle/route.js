import {authenticateRequest,checkOrigin,apiError} from '@/server/auth';
import {transaction} from '@/server/db';
import {serviceEntities} from '@/server/entities';
import {supplierLifecycle} from '@/server/domain/supplier-lifecycle';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request,{params}){try{checkOrigin(request);const context=await authenticateRequest('purchases'),text=await request.text();if(text.length>4000)throw Error('Supplier request is too large.');const body=JSON.parse(text),{id}=await params;return Response.json(await transaction(()=>supplierLifecycle(context,serviceEntities,id,body)),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return apiError(error);}}
