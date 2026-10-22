import { usesClerk } from '@/lib/auth-provider';
export const dynamic = 'force-dynamic';
export function GET() {
  const required=['NEXT_PUBLIC_SUPABASE_URL','DATABASE_URL',...(usesClerk() ? ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY'] : ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'])];
  const missing=required.filter(key=>!process.env[key]);
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SECRET_KEY');
  return Response.json({ application:'SOEICAM ERP', framework:'Next.js', auth_provider:usesClerk() ? 'clerk' : 'supabase', tables:56, configured:!missing.length, missing },{ headers:{ 'Cache-Control':'no-store' } });
}
