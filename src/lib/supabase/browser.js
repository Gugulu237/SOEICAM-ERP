'use client';
let client, pending;
export const isSupabaseConfigured = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
// Keep the unused identity SDK out of the shared Clerk startup chunk.
export async function supabaseBrowser() {
  if (!isSupabaseConfigured()) throw new Error('The SOEICAM database connection has not been configured.');
  if (client) return client;
  if (!pending) {
    pending = import('@supabase/ssr').then(({createBrowserClient}) => {
      client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
      return client;
    }).catch(error => { pending = null; throw error; });
  }
  return pending;
}
