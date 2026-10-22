
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React,{useEffect,useState} from 'react';
import {erp} from '@/api/erpClient';
import {readAll} from '@/lib/field-pos';
import {createBillFromPO} from '@/lib/ar-ap';
import {formatXAF} from '@/lib/formatters';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {NativeSelect,Field} from '@/components/suppliers/SupplierDialogs';
import {useToast} from '@/components/ui/use-toast';
export default function NewBillDialog({onClose,onCreated}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [orders,setOrders]=useState([]),[id,setId]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),{toast}=useToast();
  useEffect(()=>{let active=true;readAll(erp.entities.PurchaseOrder,{status:{$in:['received','partially_received','billed']}}).then(rows=>{if(active)setOrders(rows);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  const order=orders.find(o=>o.id===id);
  async function save(){setSaving(true);try{const bill=await createBillFromPO({po:order});toast({title:ui("Receipt bills registered"),description:bill.bill_number+' linked to its existing payable journal'});onCreated();}catch(e){toast({title:ui("Unable to register bill"),description:e.message,variant:'destructive'});}finally{setSaving(false);}}
  return <Dialog open onOpenChange={()=>!saving&&onClose()}><DialogContent><DialogHeader><DialogTitle>{ui("Register bills from received goods")}</DialogTitle></DialogHeader>{error&&<p role="alert" className="text-red-600">{uiMessage(error)}</p>}<Field label={ui("Received purchase order")}><NativeSelect value={id} onChange={e=>setId(e.target.value)}><option value="">{loading?ui("Loading orders..."):ui("Select purchase order")}</option>{orders.map(o=><option key={o.id} value={o.id}>{o.po_number} · {o.supplier_name} · {formatXAF(o.total)}</option>)}</NativeSelect></Field><p className="text-sm text-slate-500">{ui("Each confirmed receipt gets one bill for its recorded payable. Dates and amounts come from the receipt; the existing inventory and payable journal is reused. New receipts already create their bills automatically.")}</p><DialogFooter><Button variant="outline" disabled={saving} onClick={onClose}>{ui("Cancel")}</Button><Button disabled={saving || !order} onClick={save}>{saving?ui("Registering..."):ui("Register receipt bills")}</Button></DialogFooter></DialogContent></Dialog>;
}
