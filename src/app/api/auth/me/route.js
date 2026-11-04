import { authenticateRequest, apiError } from '@/server/auth';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const context = await authenticateRequest();
    const { auth_user_id, ...user } = context.user;
    const active = !context.employee?.status || context.employee.status === 'active';
    return Response.json({ ...user, role_modules:context.role==='admin'?context.roleCatalogue?.roles?.admin?.modules:undefined, company_language:context.companyLanguage || 'fr', employee_profile:context.employee, staff_access:active && (context.role === 'admin' || Boolean(context.employee)) },{ headers:{ 'Cache-Control':'private, no-store' } });
  } catch(error) { return apiError(error); }
}
