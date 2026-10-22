import { NextResponse } from 'next/server';
import { supabaseServer } from '@/server/supabase';
export async function GET(request) {
  const url=new URL(request.url), code=url.searchParams.get('code');
  const next=url.searchParams.get('next') || '/';
  const safe=next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';
  if (code) {
    const client=await supabaseServer();
    const { error }=await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safe,url.origin));
  }
  return NextResponse.redirect(new URL('/login?error=callback',url.origin));
}
