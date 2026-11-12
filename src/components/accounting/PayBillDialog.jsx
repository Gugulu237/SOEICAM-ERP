
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
import {erp} from '@/api/erpClient';
import {readAll} from '@/lib/field-pos';
import {useCurrentUser} from '@/hooks/useCurrentUser';
export default function PayBillDialog({supplierId,onClose,onPaid}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const {principalRole,role}=useCurrentUser(),isPurchasingAdmin=(principalRole||role)==='admin';
  const [data,setData]=useState(null),[bill,setBill]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    const load=isPurchasingAdmin?supplierInvoke({action:'supplierWorkspace',supplierId}):
      Promise.all([
        readAll(erp.entities.Bill,{supplier_id:supplierId,po_id:{$in:['',null]}}),
        readAll(erp.entities.Payment,{party_id:supplierId,payment_type:'supplier_payment',po_id:{$in:['',null]},status:{$in:['pending_approval','approved','confirmed']}}),
        readAll(erp.entities.TreasuryAccount,{is_active:true}),
      ]).then(([bills,payments,accounts])=>({bills,payments,accounts}));
    load.then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[supplierId,isPurchasingAdmin]);
  if(bill)return <SupplierPaymentForm data={data} bill={bill} onClose={onClose} onSaved={onPaid}/>;
  return <Dialog open onOpenChange={onClose}><DialogContent><DialogHeader><DialogTitle>{ui("Choose an unpaid bill")}</DialogTitle></DialogHeader>{error?<p role="alert" className="text-red-600">{uiMessage(error)}</p>:!data?<p>{ui("Loading bills...")}</p>:<div className="space-y-2">{data.bills.filter(b=>!['draft','cancelled'].includes(b.status)&&Number(b.balance)>0).map(b=><Button key={b.id} variant="outline" className="w-full justify-between" disabled={data.payments.some(p=>(b.po_id?p.po_id===b.po_id:p.bill_id===b.id)&&['pending_approval','approved','confirmed'].includes(p.status))} onClick={()=>setBill(b)}>{b.bill_number}<span>{formatXAF(b.balance)}</span></Button>)}</div>}</DialogContent></Dialog>;
}
