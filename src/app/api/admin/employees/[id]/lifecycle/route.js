import { authenticateRequest, checkOrigin, apiError } from '@/server/auth';
import { transaction } from '@/server/db';
import { serviceEntities } from '@/server/entities';
import { employeeLifecycle } from '@/server/domain/employee-lifecycle';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request,{params}) {
  try{
    checkOrigin(request);const context=await authenticateRequest();
    if(context.role!=='admin')throw Object.assign(Error('Only the General Manager can remove or restore employees.'),{status:403});
    const text=await request.text();if(text.length>4000)throw Object.assign(Error('Employee request is too large.'),{status:413});
    const body=JSON.parse(text),{id}=await params;
    const result=await transaction(()=>employeeLifecycle(context,serviceEntities,id,body));
    return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
  }catch(e){return apiError(e);}
}
