import {authenticateRequest,apiError,checkOrigin} from '@/server/auth';
import {serviceEntities} from '@/server/entities';
import {database,transaction} from '@/server/db';
import {recurringExpenseWorkspace,recordRecurringExpense} from '@/server/domain/recurring-expenses';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request){
  try{
    const params=new URL(request.url).searchParams;
    const context=await authenticateRequest('accounting');
    return Response.json(await transaction(()=>recurringExpenseWorkspace(serviceEntities,context,{from:params.get('from')||undefined,to:params.get('to')||undefined,reportOnly:['1','alerts'].includes(params.get('summary')),alertsOnly:params.get('summary')==='alerts'})),{headers});
  }catch(error){return apiError(error);}
}
export async function POST(request){
  try{
    checkOrigin(request);const context=await authenticateRequest('accounting'),text=await request.text();
    if(text.length>10000)throw Error('The recurring expense request is too large.');
    const body=JSON.parse(text);
    return Response.json(await transaction(async()=>{
      await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['recurring-expenses']);
      return recordRecurringExpense(serviceEntities,context,body);
    }),{headers});
  }catch(error){return apiError(error);}
}
