import {authenticateRequest,apiError,checkOrigin} from '@/server/auth';
import {serviceEntities} from '@/server/entities';
import {database,transaction} from '@/server/db';
import {setupStockCorrectionWorkspace,previewSetupStockCorrection,postSetupStockCorrection} from '@/server/domain/setup-stock-correction';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){
  try{const context=await authenticateRequest('accounting');return Response.json(await setupStockCorrectionWorkspace(serviceEntities,context),{headers});}
  catch(error){return apiError(error);}
}
export async function POST(request){
  try{
    checkOrigin(request);const context=await authenticateRequest('accounting'),text=await request.text();
    if(text.length>100000)throw Error('The setup-stock correction is too large.');
    const body=JSON.parse(text);
    if(!['preview','post'].includes(body?.action))throw Error('Choose preview or post for the setup-stock correction.');
    const result=await transaction(async()=>{
      await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['setup-stock-correction']);
      return body.action==='preview'?previewSetupStockCorrection(serviceEntities,context,body):postSetupStockCorrection(serviceEntities,context,body);
    });
    return Response.json(result,{headers});
  }catch(error){return apiError(error);}
}
