import { authenticateRequest, apiError } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const context = await authenticateRequest();
    const { auth_user_id, ...user } = context.user;
    const settings=(await serviceEntities.CompanySettings.filter({},'id',1))[0];
    const active = !context.employee?.status || context.employee.status === 'active';
    return Response.json({ ...user, role_modules:context.role==='admin'?context.roleCatalogue?.roles?.admin?.modules:undefined, company_language:settings?.default_language || 'fr', employee_profile:context.employee, staff_access:active && (context.role === 'admin' || Boolean(context.employee)) },{ headers:{ 'Cache-Control':'private, no-store' } });
  } catch(error) { return apiError(error); }
}
