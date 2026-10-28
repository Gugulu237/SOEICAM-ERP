import { authenticateRequest, apiError, checkOrigin } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
import { database, transaction } from '@/server/db';
import { saveManualJournal } from '@/server/domain/manual-journals';
import { journalLifecycle } from '@/server/domain/journal-lifecycle';
export const dynamic='force-dynamic';
export async function GET(request){
  try{const context=await authenticateRequest('accounting'),journalId=new URL(request.url).searchParams.get('journalId');
    if(!journalId||journalId.length>200)throw Error('Choose an existing journal.');
    return Response.json(await transaction(()=>journalLifecycle(serviceEntities,context,{action:'previewReversal',journalId})),{headers:{'Cache-Control':'private, no-store'}});
  }catch(e){return apiError(e);}
}
export async function POST(request) {
  try{
    checkOrigin(request);const context=await authenticateRequest('accounting'),text=await request.text();if(text.length>300000)throw Error('Journal is too large.');
    const body=JSON.parse(text),result=await transaction(async()=>{await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['manual-journals']);return body.action ? journalLifecycle(serviceEntities,context,body) : saveManualJournal(serviceEntities,context,body);});
    return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
  }catch(e){return apiError(e);}
}
