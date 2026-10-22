'use client';
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';

import { Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { AuthProvider } from '@/lib/AuthContext';
import { Toaster } from '@/components/ui/toaster';
import SetupScreen from '@/components/SetupScreen';
import { ClerkProvider } from '@clerk/nextjs';
import { shadcn } from '@clerk/ui/themes';
import { enUS,frFR } from '@clerk/localizations';
import { LanguageProvider,useLocaleRender } from '@/lib/localization';
import { isAuthConfigured, usesClerk } from '@/lib/auth-provider';

// This app uses Tailwind 3's HSL channel tokens. Clerk's current shadcn theme
// expects complete CSS colors, so adapt them without changing the ERP palette.
const clerkAppearance = { theme:shadcn, variables:{
  colorBackground:'hsl(var(--card))', colorForeground:'hsl(var(--card-foreground))',
  colorInput:'hsl(var(--input))', colorInputForeground:'hsl(var(--card-foreground))',
  colorDanger:'hsl(var(--destructive))', colorMuted:'hsl(var(--muted))',
  colorMutedForeground:'hsl(var(--muted-foreground))', colorNeutral:'hsl(var(--foreground))',
  colorPrimary:'hsl(var(--primary))', colorPrimaryForeground:'hsl(var(--primary-foreground))',
  colorRing:'hsl(var(--ring))', colorModalBackdrop:'rgba(0,0,0,0.5)',
  fontWeight:{ normal:400,medium:500,semibold:600,bold:700 },
} };

function LocalizedProviders({ children }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const language=useLocaleRender();
  if (!isAuthConfigured()) return <SetupScreen />;
  const content=<Suspense fallback={<p className="p-8">{ui("Loading SOEICAM...")}</p>}><QueryClientProvider client={queryClientInstance}><AuthProvider>{children}<Toaster /></AuthProvider></QueryClientProvider></Suspense>;
  return usesClerk() ? <ClerkProvider localization={language==='fr'?frFR:enUS} appearance={clerkAppearance} publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY} signInUrl="/login" signUpUrl="/register" signInForceRedirectUrl="/" signUpForceRedirectUrl="/">{content}</ClerkProvider> : content;
}

export default function Providers({children}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
return <LanguageProvider><LocalizedProviders>{children}</LocalizedProviders></LanguageProvider>;}
