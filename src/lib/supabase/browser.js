'use client';
import { createBrowserClient } from '@supabase/ssr';
let client;
export const isSupabaseConfigured = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
export function supabaseBrowser() {
  if (!isSupabaseConfigured()) throw new Error('The SOEICAM database connection has not been configured.');
  return client ||= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
