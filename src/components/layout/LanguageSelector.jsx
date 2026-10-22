'use client';
import React,{useState} from 'react';
import {Globe} from 'lucide-react';
import {useLocaleRender} from '@/lib/localization';
import {useAuth} from '@/lib/AuthContext';
import {ui,uiMessage} from '@/lib/i18n';

export default function LanguageSelector({id='app-language'}){
  useLocaleRender();
  const {user,saveLanguagePreference,isSavingLanguage}=useAuth();
  const [error,setError]=useState('');
  async function choose(value){
    setError('');
    try{await saveLanguagePreference(value || null);}catch(e){setError(e.message);}
  }
  return <div className="relative flex items-center gap-1 text-xs">
    <Globe size={16} aria-hidden="true"/>
    <label className="sr-only" htmlFor={id}>{ui('Interface language')}</label>
    <select id={id} aria-label={ui('Interface language')} aria-describedby={error ? id+'-error' : undefined} value={user?.preferred_language || ''} disabled={isSavingLanguage} onChange={e=>choose(e.target.value)} className="h-9 max-w-40 rounded-md border border-green-100 bg-white px-2 text-xs">
      <option value="fr" lang="fr">Français</option><option value="en" lang="en">English</option><option value="">{ui('Company default')}</option>
    </select>
    {error&&<p id={id+'-error'} role="alert" className="absolute right-0 top-10 z-50 w-64 rounded border bg-white p-3 text-red-700">{uiMessage(error)}</p>}
  </div>;
}
