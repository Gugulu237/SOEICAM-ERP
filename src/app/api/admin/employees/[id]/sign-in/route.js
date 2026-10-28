import { authenticateRequest, checkOrigin, apiError } from '@/server/auth';
import { database, transaction } from '@/server/db';
import { serviceEntities } from '@/server/entities';
import { readEmployeeSignIn, changeEmployeeSignIn } from '@/server/domain/employee-sign-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const response = value => Response.json(value, { headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request, { params }) {
  try {
    const context = await authenticateRequest(), { id } = await params;
    return response(await transaction(() => readEmployeeSignIn(context, serviceEntities, id)));
  } catch (error) { return apiError(error); }
}

export async function POST(request, { params }) {
  try {
    checkOrigin(request);
    const context = await authenticateRequest(), { id } = await params;
    const text = await request.text();
    if (text.length > 4000) throw Object.assign(Error('Employee request is too large.'), { status: 413 });
    const input = JSON.parse(text);
    return response(await transaction(() => changeEmployeeSignIn(context, serviceEntities, database(), id, input)));
  } catch (error) { return apiError(error); }
}
