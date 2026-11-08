import {authenticateRequest,apiError,checkOrigin} from '@/server/auth';
import {serviceEntities} from '@/server/entities';
import {database,transaction} from '@/server/db';
import {previewDegustationAppropriation,postDegustationAppropriation} from '@/server/domain/degustation-appropriation';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function POST(request){
 try{
  checkOrigin(request);const context=await authenticateRequest('accounting'),text=await request.text();
  if(text.length>12000)throw Error('The Dégustation appropriation request is too large.');
  const body=JSON.parse(text);if(!['preview','post'].includes(body?.action))throw Error('Choose a valid Dégustation appropriation action.');
  const result=await transaction(async()=>{
   await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['chart-of-accounts']);
   await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['degustation-appropriation:'+String(body.dispatchId||'')]);
   return body.action==='preview'?previewDegustationAppropriation(serviceEntities,context,body):postDegustationAppropriation(serviceEntities,context,body);
  });
  return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return apiError(error);}
}
