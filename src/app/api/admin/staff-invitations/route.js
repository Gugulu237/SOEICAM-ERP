import { clerkClient } from '@clerk/nextjs/server';
import { authenticateRequest, checkOrigin, apiError } from '@/server/auth';
import { database, transaction } from '@/server/db';
import { serviceEntities } from '@/server/entities';
import { inviteStaff, staffInvitationStatuses } from '@/server/staff-invitations';
import { usesClerk } from '@/lib/auth-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireClerk() {
  if (!usesClerk() || !process.env.CLERK_SECRET_KEY) throw Object.assign(new Error('Staff invitations require Clerk authentication.'), { status: 503 });
}

export async function GET() {
  try {
    requireClerk();
    const context = await authenticateRequest();
    return Response.json(await staffInvitationStatuses(context, database()), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}

export async function POST(request) {
  try {
    checkOrigin(request);
    requireClerk();
    const context = await authenticateRequest();
    const body = await request.json();
    const result = await inviteStaff(context, body.employeeId, { db: database(), entities: serviceEntities, transaction, clerk: await clerkClient() });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
