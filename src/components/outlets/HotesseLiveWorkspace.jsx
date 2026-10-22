
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import HotesseWorkspace from './HotesseWorkspace';
export default function HotesseLiveWorkspace() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true, pending = false;
    const refresh = async () => {
      if (!active || pending) return;
      pending = true; setLoading(true); setError('');
      try { const result = await invokeFieldOps({ action: 'employeeDashboard', mode: 'hotesse' }); if (result.data.error) throw new Error(result.data.error); if (active) setData(result.data); }
      catch (failure) { if (active) setError(errorMessage(failure)); }
      finally { pending = false; if (active) setLoading(false); }
    };
    const visible = () => { if (!document.hidden) refresh(); };
    refresh(); const timer = window.setInterval(visible, 30000); window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [reload]);
  return <div className="space-y-4"><div className="flex justify-end"><Button size="sm" variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}>{ui("Refresh shelves")}</Button></div>{error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{uiMessage(error)}</p>}<HotesseWorkspace data={data} loading={loading && !data} onRefresh={() => setReload(value => value + 1)} /></div>;
}
