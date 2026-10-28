import { authenticateRequest, checkOrigin, apiError } from '@/server/auth';
import { transaction } from '@/server/db';
import { serviceEntities } from '@/server/entities';
import { customerLifecycle } from '@/server/domain/customer-lifecycle';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request, { params }) {
  try {
    checkOrigin(request);
    const context = await authenticateRequest('customers');
    if (context.role !== 'admin') throw Object.assign(Error('Only the General Manager can delete or restore customers.'), { status: 403 });
    const text = await request.text();
    if (text.length > 4000) throw Object.assign(Error('Customer request is too large.'), { status: 413 });
    const input = JSON.parse(text), { id } = await params;
    return Response.json(await transaction(() => customerLifecycle(context, serviceEntities, id, input)), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
