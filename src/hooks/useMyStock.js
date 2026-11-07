import {useEffect, useState} from 'react';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {eligibleStockRecipient} from '@/lib/stock-recipient';
import {invokeFieldOps} from '@/lib/field-ops';
import {watchSalesStock} from '@/lib/sales-stock-refresh';

export function useMyStock({history = false} = {}) {
  const auth = useCurrentUser();
  const enabled = !auth.loading && !auth.error && !!auth.user?.id && eligibleStockRecipient(auth.employee);
  const scope = enabled ? auth.user.id + ':' + auth.employee.id : '';
  const action = history ? 'employeeStockWorkspace' : 'employeeStockSnapshot';
  const [result, setResult] = useState(null), [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!scope) return;
    let active = true, pending = false;
    const load = async () => {
      if (!active || pending) return;
      pending = true; setBusy(true);
      try {
        // The server resolves the signed-in employee; no selected employee is sent.
        const {data} = await invokeFieldOps({action});
        if (data.error) throw Error(data.error);
        if (active) {setResult({scope, action, data}); setFailure(null);}
      } catch (error) {if (active) setFailure({scope, action, message:error.message});}
      finally {pending = false; if (active) setBusy(false);}
    };
    load(); const stop = watchSalesStock(load);
    return () => {active = false; stop();};
  }, [scope, action, revision]);
  const data = scope && result?.scope === scope && result.action === action ? result.data : null;
  const error = auth.error || (failure?.scope === scope && failure.action === action ? failure.message : '');
  return {data, error, busy:enabled && busy, enabled, authLoading:auth.loading,
    role:auth.principalRole || auth.role, refresh:() => setRevision(n => n + 1)};
}
