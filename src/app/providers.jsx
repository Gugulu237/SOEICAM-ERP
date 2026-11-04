'use client';
/* localized-interface */
import { ui } from '@/lib/i18n';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { AuthProvider } from '@/lib/AuthContext';
import { Toaster } from '@/components/ui/toaster';
import SetupScreen from '@/components/SetupScreen';
import { ClerkProvider } from '@clerk/nextjs';
import { LanguageProvider,useLocaleRender } from '@/lib/localization';
import { isAuthConfigured, usesClerk } from '@/lib/auth-provider';
import { isClerkWidgetRoute } from '@/lib/clerk-ui-config';
import { ClerkUiStatusContext,useClerkUiOptions } from '@/lib/clerk-ui-options';
import PwaProvider from '@/components/pwa/PwaProvider';
import DeviceNotificationBridge from '@/components/pwa/DeviceNotificationBridge';

function LocalizedProviders({ children,pathname }) {
  const language=useLocaleRender();
  const clerkEnabled=isAuthConfigured()&&usesClerk();
  const clerkUi=useClerkUiOptions(clerkEnabled&&isClerkWidgetRoute(pathname),language);
  if (!isAuthConfigured()) return <SetupScreen />;
  const content=<Suspense fallback={<p className="p-8">{ui("Loading SOEICAM...")}</p>}><QueryClientProvider client={queryClientInstance}><AuthProvider><DeviceNotificationBridge/>{children}<Toaster /></AuthProvider></QueryClientProvider></Suspense>;
  return clerkEnabled ? <ClerkProvider {...clerkUi.options} publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY} signInUrl="/login" signUpUrl="/register" signInForceRedirectUrl="/" signUpForceRedirectUrl="/"><ClerkUiStatusContext.Provider value={clerkUi.status}>{content}</ClerkUiStatusContext.Provider></ClerkProvider> : content;
}

export default function Providers({children}){
  const pathname=usePathname();
  // The development workbench only frames the app. Each frame authenticates
  // itself; booting another sign-in SDK here doubles mobile preview startup.
  if(process.env.NODE_ENV==='development' && pathname==='/dev-preview')return <LanguageProvider>{children}</LanguageProvider>;
  return <LanguageProvider><PwaProvider><LocalizedProviders pathname={pathname}>{children}</LocalizedProviders></PwaProvider></LanguageProvider>;}
