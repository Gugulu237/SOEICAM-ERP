'use client';
import React,{useEffect,useState} from 'react';
import {isChunkLoadFailure,recoverChunkLoad} from '@/lib/chunk-recovery';

// Independent of Providers, authentication SDKs, global CSS and translation bundles.
export default function GlobalError({error,retry,reset}) {
  const [french] = useState(()=>typeof document!=='undefined'&&document.documentElement.lang.startsWith('fr'));
  useEffect(() => {
    recoverChunkLoad(error,window);
  },[error]);
  const chunk = isChunkLoadFailure(error);
  const reload = () => window.location.reload();
  return <html lang={french?'fr':'en'}><body style={{margin:0,background:'#f7faf6',color:'#094178',fontFamily:'Arial,sans-serif'}}>
    <title>SOEICAM ERP</title>
    <main style={{maxWidth:480,margin:'12vh auto',padding:24}}>
      <h1 style={{fontSize:24}}>{french?'La page n’a pas pu se charger':'This page could not load'}</h1>
      <p style={{fontSize:14,lineHeight:1.6}}>{french?'Rechargez la page pour récupérer la dernière version de SOEICAM.':'Reload the page to get the latest version of SOEICAM.'}</p>
      <button onClick={chunk?reload:()=> (retry||reset||reload)()} style={{minHeight:44,border:0,borderRadius:8,padding:'12px 20px',background:'#598f36',color:'#fff',cursor:'pointer'}}>{french?'Recharger la page':'Reload page'}</button>
    </main>
  </body></html>;
}
