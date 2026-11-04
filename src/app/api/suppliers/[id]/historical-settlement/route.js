import {authenticateRequest,checkOrigin,apiError} from '@/server/auth';
import {database,transaction} from '@/server/db';
import {serviceEntities} from '@/server/entities';
import {historicalSettlementWorkspace,previewHistoricalSettlement,postHistoricalSettlement} from '@/server/domain/supplier-historical-settlement';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const response=data=>Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
export async function GET(request,{params}){
  try{const context=await authenticateRequest('purchases'),{id}=await params;return response(await transaction(()=>historicalSettlementWorkspace(serviceEntities,context,id)));}catch(e){return apiError(e);}
}
export async function POST(request,{params}){
  try{
    checkOrigin(request);const context=await authenticateRequest('purchases'),{id}=await params,text=await request.text();
    if(text.length>12000)throw Error('Correction request is too large.');
    const body=JSON.parse(text);if(!['preview','post'].includes(body.action))throw Error('Unknown correction action.');
    return response(await transaction(async()=>{
      await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['supplier-historical-settlement:'+id]);
      return body.action==='preview'?previewHistoricalSettlement(serviceEntities,context,id,body):postHistoricalSettlement(serviceEntities,context,id,body);
    }));
  }catch(e){return apiError(e);}
}
