'use client';
import {useEffect,useSyncExternalStore} from 'react';
import {getLanguage,subscribeLanguage,configureLanguage,readLocalLanguage,setLanguage} from './i18n';
export function useLocaleRender(){return useSyncExternalStore(subscribeLanguage,getLanguage,()=> 'en');}
export function LanguageProvider({children}){useEffect(()=>{setLanguage(readLocalLanguage(null)||'fr');},[]);return children;}
export function activateAccountLanguage(profile){configureLanguage({userId:profile.id,preferredLanguage:profile.preferred_language,defaultLanguage:profile.company_language});}
