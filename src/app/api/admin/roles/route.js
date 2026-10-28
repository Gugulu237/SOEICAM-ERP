import { authenticateRequest, apiError, checkOrigin } from '@/server/auth';
import { loadRoleCatalogue, saveRoleProfile, saveOrganigramLayout } from '@/server/role-catalogue-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const denied = () => Object.assign(new Error('Only the General Manager can manage roles.'),{ status:403 });
export async function GET() {
  try { const context = await authenticateRequest('employees'); if (context.role !== 'admin') throw denied(); return Response.json(await loadRoleCatalogue(),{ headers:{ 'Cache-Control':'private, no-store' } }); }
  catch(error) { return apiError(error); }
}
export async function PUT(request) {
  try {
    checkOrigin(request);
    const context = await authenticateRequest(); if (context.role !== 'admin') throw denied();
    const text = await request.text(); if (text.length > 12000) throw Object.assign(new Error('Role details are too large.'),{ status:413 });
    const body = JSON.parse(text);
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error('Refresh the role editor before saving.');
    const saved = Object.hasOwn(body,'layout') ? await saveOrganigramLayout(context,body.layout,body.revision) : await saveRoleProfile(context,body.profile,body.revision);
    return Response.json(saved,{ headers:{ 'Cache-Control':'private, no-store' } });
  } catch(error) { return apiError(error); }
}
