import { authenticateRequest, apiError, checkOrigin } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
import { database, transaction } from '@/server/db';
import { payrollAction, payrollWorkspace } from '@/server/domain/payroll-workspace';
export const dynamic='force-dynamic';
export async function POST(request) {
  try {
    checkOrigin(request);
    const context=await authenticateRequest('payroll'), text=await request.text();
    if (text.length>30000) throw Error('Payroll request is too large.');
    const body=JSON.parse(text);
    const result=await transaction(async()=>{
      await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payroll-workspace']);
      return payrollAction(serviceEntities,context,body);
    });
    return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return apiError(error); }
}

export async function GET(request) {
  try {
    const context=await authenticateRequest('payroll'),runId=new URL(request.url).searchParams.get('run') || '';
    if(runId.length>200)throw Error('Choose a valid payroll run.');
    return Response.json(await payrollWorkspace(serviceEntities,context,runId),{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {return apiError(error);}
}
