
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React,{useEffect,useState} from 'react';
import {SupplierPaymentForm,supplierInvoke} from '@/components/suppliers/SupplierDialogs';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {formatXAF} from '@/lib/formatters';
export default function PayBillDialog({supplierId,onClose,onPaid}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [data,setData]=useState(null),[bill,setBill]=useState(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;supplierInvoke({action:'supplierWorkspace',supplierId}).then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[supplierId]);
  if(bill)return <SupplierPaymentForm data={data} bill={bill} onClose={onClose} onSaved={onPaid}/>;
  return <Dialog open onOpenChange={onClose}><DialogContent><DialogHeader><DialogTitle>{ui("Choose an unpaid bill")}</DialogTitle></DialogHeader>{error?<p role="alert" className="text-red-600">{uiMessage(error)}</p>:!data?<p>{ui("Loading bills...")}</p>:<div className="space-y-2">{data.bills.filter(b=>!['draft','cancelled'].includes(b.status)&&Number(b.balance)>0).map(b=><Button key={b.id} variant="outline" className="w-full justify-between" disabled={data.payments.some(p=>p.po_id===b.po_id&&['pending_approval','approved','confirmed'].includes(p.status))} onClick={()=>setBill(b)}>{b.bill_number}<span>{formatXAF(b.balance)}</span></Button>)}<p className="text-xs text-slate-500">{ui("Payments require General Manager approval before release. Pending payments can be followed from Suppliers / Payments.")}</p></div>}</DialogContent></Dialog>;
}
