'use client';
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';

import { SignIn, SignUp } from '@clerk/nextjs';

export default function ClerkAuthScreen({ signUp = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <main className="min-h-screen bg-[#094178] px-4 py-10 flex flex-col items-center justify-center gap-6">
    <div className="text-center text-white"><img src="/brand/soeicam-logo.png" alt={ui("SOEICAM")} className="mx-auto mb-4 h-auto w-44 rounded-xl bg-white p-1.5" /><p className="text-xs font-bold tracking-[0.3em] text-sky-200">{ui("YOLA ERP")}</p><h1 className="mt-3 text-2xl font-semibold">{signUp ? ui("Create your staff login") : ui("Welcome back")}</h1><p className="mt-2 text-sm text-sky-100">{signUp ? ui("Use the email linked to your SOEICAM staff account.") : ui("Sign in to your SOEICAM workspace.")}</p></div>
    {signUp ? <SignUp routing="hash" signInUrl="/login" forceRedirectUrl="/" /> : <SignIn routing="hash" signUpUrl="/register" forceRedirectUrl="/" />}
    {signUp && <p className="max-w-sm text-center text-xs leading-5 text-sky-100">{ui("The General Manager assigns staff roles after your email is verified.")}</p>}
  </main>;
}
