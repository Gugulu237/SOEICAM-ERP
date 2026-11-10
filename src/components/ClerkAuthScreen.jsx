'use client';
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';

import { SignIn, SignUp } from '@clerk/nextjs';

export default function ClerkAuthScreen({ signUp = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <main data-clerk-auth data-sleek-screen="connexion" className="min-h-screen bg-[#094178] px-5 py-10 flex flex-col items-center justify-start gap-6 sm:justify-center">
    <div className="w-full max-w-sm text-left text-white sm:text-center"><img src="/brand/soeicam-logo.png" alt={ui("SOEICAM")} className="mb-4 h-auto w-40 rounded-xl bg-white p-1.5 sm:mx-auto" /><p className="text-xs font-bold tracking-[0.3em] text-sky-200">{ui("YOLA ERP")}</p><h1 className="mt-3 text-2xl font-semibold">{signUp ? ui("Create your staff login") : ui("Welcome back")}</h1><p className="mt-2 text-sm text-sky-100">{signUp ? ui("Use the email linked to your SOEICAM staff account.") : ui("Sign in to your SOEICAM workspace.")}</p></div>
    {signUp ? <SignUp routing="hash" signInUrl="/login" forceRedirectUrl="/" /> : <SignIn appearance={{elements:{rootBox:'w-full max-w-sm',cardBox:'w-full shadow-none',card:'shadow-none border-0 px-0 sm:px-6',headerTitle:'text-left',headerSubtitle:'text-left',formButtonPrimary:'min-h-12 rounded-xl',formFieldInput:'min-h-12 rounded-xl'}}} routing="hash" signUpUrl="/register" forceRedirectUrl="/" />}
    {!signUp&&<p className="max-w-sm text-center text-xs text-sky-100">{ui('SOEICAM staff access only. Password recovery is available in the sign-in form.')}</p>}
    {signUp && <p className="max-w-sm text-center text-xs leading-5 text-sky-100">{ui("The General Manager assigns staff roles after your email is verified.")}</p>}
  </main>;
}
