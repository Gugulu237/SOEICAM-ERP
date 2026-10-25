'use client';
import React,{useState} from 'react';
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import {Globe} from 'lucide-react';
import {useLocaleRender} from '@/lib/localization';
import {useAuth} from '@/lib/AuthContext';
import {ui,uiMessage} from '@/lib/i18n';

export default function LanguageSelector({id='app-language'}){
  useLocaleRender();
  const phone=usePhoneLayout();
  const {user,saveLanguagePreference,isSavingLanguage}=useAuth();
  const [error,setError]=useState('');
  async function choose(value){
    setError('');
    try{await saveLanguagePreference(value || null);}catch(e){setError(e.message);}
  }
  return <div className="relative flex shrink-0 items-center gap-1 text-xs">
    <Globe size={16} aria-hidden="true" className="hidden sm:block"/>
    <label className="sr-only" htmlFor={id}>{ui('Interface language')}</label>
    <select id={id} aria-label={ui('Interface language')} aria-describedby={error ? id+'-error' : undefined} value={user?.preferred_language || ''} disabled={isSavingLanguage} onChange={e=>choose(e.target.value)} className="h-11 w-14 min-w-0 rounded-lg border border-green-100 bg-white px-1 text-base sm:text-xs sm:w-auto sm:max-w-40 sm:px-2">
      <option value="fr" lang="fr">{phone ? "FR" : "Français"}</option><option value="en" lang="en">{phone ? "EN" : "English"}</option><option value="">{phone ? ui("Auto") : ui('Company default')}</option>
    </select>
    {error&&<p id={id+'-error'} role="alert" className="fixed left-3 right-3 top-14 z-50 sm:absolute sm:left-auto sm:right-0 sm:top-10 sm:w-64 rounded border bg-white p-3 text-red-700">{uiMessage(error)}</p>}
  </div>;
}
