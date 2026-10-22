import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';
import { usesClerk } from './lib/auth-provider';
import { resumeClerkRequest } from './server/clerk-response';
const clerkProxy = clerkMiddleware();
export async function proxy(request, event) {
  if (usesClerk()) {
    if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return NextResponse.next({ request });
    const result = resumeClerkRequest(request, await clerkProxy(request, event));
    if (result) result.headers.set('Cache-Control', 'private, no-store');
    return result;
  }
  let response = NextResponse.next({ request });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return response;
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await client.auth.getClaims();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|products/|favicon.ico|api/health).*)'] };
