import { checkOrigin, apiError } from '@/server/auth';
import { createClientFromRequest } from '@/server/request-client';
import { transaction } from '@/server/db';
import { expiryRecoveryAction } from '@/server/domain/expiry-recovery';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function call(request,body) {
  const client=await createClientFromRequest(request),user=await client.auth.me();
  return expiryRecoveryAction(client,user,body);
}
export async function GET(request) {
  try{return Response.json(await call(request,{action:'workspace'}),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return apiError(e);}
}
export async function POST(request) {
  try{checkOrigin(request);const text=await request.text();if(text.length>50000)throw Error('The request is too large.');const body=JSON.parse(text);return Response.json(await transaction(()=>call(request,body)),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return apiError(e);}
}
