// This public build-time flag selects one identity provider for the whole app.
// ERP roles are always resolved from the server's User/Employee records.
export const usesClerk = () => process.env.NEXT_PUBLIC_AUTH_PROVIDER === 'clerk';
export const isAuthConfigured = () => usesClerk()
  ? Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  : Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
