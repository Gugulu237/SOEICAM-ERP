'use client';
import {ui} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {useClerkUiStatus} from '@/lib/clerk-ui-options';

export default function ClerkWidgetBoundary({children,className=''}){
  useLocaleRender();
  const {ready,error,retry}=useClerkUiStatus();
  return <>
    {ready?children:<p role="status" className={className}>{ui('Loading...')}</p>}
    {error&&<div role="status" className={className}><p>{ui('Display settings could not be loaded. You can still use your account.')}</p><button type="button" className="mt-2 rounded px-3 py-2 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" onClick={retry}>{ui('Retry')}</button></div>}
  </>;
}
