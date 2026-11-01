'use client';
import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {Download, WifiOff} from 'lucide-react';
import {createPwaClient} from '@/lib/pwa-client';
import {ui} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';

const PwaContext = createContext(null);

export default function PwaProvider({children}) {
  useLocaleRender();
  const [state, setState] = useState({ready: false, installed: false, offline: false});
  const [instructions, setInstructions] = useState(false);
  const client = useRef(null);
  useEffect(() => {
    const instance = createPwaClient(window, setState, {enableWorker: process.env.NODE_ENV === 'production'});
    client.current = instance;
    return () => {instance.dispose(); client.current = null;};
  }, []);
  async function install() {
    const result = await client.current?.install();
    if (result === 'instructions') setInstructions(true);
    else if (result === 'accepted') setInstructions(false);
  }
  return <PwaContext.Provider value={{...state, install}}>
    {children}
    <Dialog open={instructions} onOpenChange={setInstructions}>
      <DialogContent>
        <DialogHeader><DialogTitle>{ui('Install SOEICAM')}</DialogTitle><DialogDescription>{ui('Open your workspace from your home screen in its own app window.')}</DialogDescription></DialogHeader>
        {!state.secure && <p className="rounded-lg bg-amber-50 p-3 text-sm">{ui('Open the secure HTTPS address of SOEICAM to install it on your phone.')}</p>}
        <div className="space-y-4 text-sm">
          <p><strong>Android</strong><br/>{ui('Open SOEICAM in Chrome. In the browser menu, choose Install app or Add to Home screen.')}</p>
          <p><strong>iPhone / iPad</strong><br/>{ui('Open SOEICAM in Safari. Tap Share, then Add to Home Screen.')}</p>
          <p><strong>{ui('Desktop')}</strong><br/>{ui('Open SOEICAM in Chrome or Edge and use the install icon in the address bar or browser menu.')}</p>
          <p className="text-slate-500">{ui('Already installed? Open SOEICAM from your app list. Installation availability depends on your browser.')}</p>
        </div>
        {state.canPrompt && <button type="button" onClick={install} disabled={state.installing} className="min-h-12 rounded-xl bg-[#347623] px-4 font-semibold text-white">{ui('Install app')}</button>}
      </DialogContent>
    </Dialog>
  </PwaContext.Provider>;
}

export function InstallAppButton({compact = false}) {
  useLocaleRender();
  const pwa = useContext(PwaContext);
  if (!pwa?.ready || pwa.installed) return null;
  return <button type="button" onClick={pwa.install} disabled={pwa.installing} aria-label={ui('Install app')} title={ui('Install app')} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-[#245719] hover:bg-green-50 disabled:opacity-60 ${compact ? 'justify-center' : ''}`}>
    <Download size={18} className="shrink-0"/>{!compact && <span>{ui(pwa.installing ? 'Installing...' : 'Install app')}</span>}
  </button>;
}

export function PwaStatus() {
  useLocaleRender();
  const pwa = useContext(PwaContext);
  if (!pwa || (!pwa.offline && !pwa.updateReady)) return null;
  return <aside role="status" className="mx-3 mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
    {pwa.offline && <div className="flex items-start gap-2"><WifiOff size={18} className="mt-0.5 shrink-0"/><p>{ui('You are offline. Reconnect before recording transactions. Check recent activity before retrying an interrupted submission.')}</p></div>}
    {pwa.updateReady && <p>{ui('An app update is ready. Finish your work, then close all SOEICAM windows and reopen the app.')}</p>}
  </aside>;
}
