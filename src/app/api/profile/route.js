import {authenticateRequest,apiError,checkOrigin} from '@/server/auth';
import {serviceEntities} from '@/server/entities';
import {database,transaction} from '@/server/db';
import {readSelfProfile,saveSelfProfile} from '@/server/domain/self-profile';
export const dynamic='force-dynamic';
const response=profile=>Response.json({profile},{headers:{'Cache-Control':'private, no-store'}});

export async function GET(){
  try{const context=await authenticateRequest();return response(await transaction(()=>readSelfProfile(serviceEntities,context)));}
  catch(error){return apiError(error);}
}
export async function POST(request){
  try{
    checkOrigin(request);
    const context=await authenticateRequest(),text=await request.text();
    if (text.length>2000) throw Error('Profile details are too long.');
    const input=JSON.parse(text);
    return response(await transaction(async()=>{
      await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['self-profile:'+context.user.id]);
      return saveSelfProfile(serviceEntities,context,input);
    }));
  }catch(error){return apiError(error);}
}
