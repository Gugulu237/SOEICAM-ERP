
/* localized-interface */
import SupplierRemoval from './SupplierRemoval';
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, {useState} from 'react';
import {erp} from '@/api/erpClient';
import {businessDate} from '@/lib/business-date';
import {formatXAF} from '@/lib/formatters';
import {finishedStorageAllowed} from '@/lib/finished-product-storage';
import {supplierCatalogue,supplierItems,supplierMaterial} from '@/lib/supplier-catalogue';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import ProductThumb from '@/components/shared/ProductThumb';
import {useToast} from '@/components/ui/use-toast';
import {Plus,Trash2} from 'lucide-react';

export const supplierInvoke = async body => (await erp.functions.invoke('fieldOps',body)).data;
export function Field({label,children}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
return <label className="block space-y-1 text-sm"><span className="font-medium text-slate-600">{label}</span>{children}</label>;}
export function NativeSelect({children,...props}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
return <select {...props} className={'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm '+(props.className || '')}>{children}</select>;}
function useSave(onSaved,onClose){
  const [saving,setSaving]=useState(false),[key]=useState(()=>crypto.randomUUID()),{toast}=useToast();
  return {saving,key,setSaving,close:()=>!saving&&onClose(),save:async(body,title)=>{setSaving(true);try{const data=await supplierInvoke({...body,requestKey:key});toast({title});onSaved?.(data);onClose();}catch(e){toast({title:ui("Unable to save"),description:e.message,variant:'destructive'});}finally{setSaving(false);}}};
}

export function SupplierForm({supplier,products=[],initialTab='contact',onClose,onSaved}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [form,setForm]=useState(()=>({name:'',contact_person:'',phone:'',email:'',address:'',city:'',category:'',tax_id:'',notes:'',payment_terms_days:30,is_active:true,...supplier,supplier_items:supplierItems(supplier).filter(row=>!products.some(p=>p.id===row.product_id&&!supplierMaterial(p)))}));
  const [term,setTerm]=useState(''),[tab,setTab]=useState(initialTab),{saving,key,setSaving,close,save}=useSave(onSaved,onClose);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  function item(p,checked){set('supplier_items',checked?[...form.supplier_items,{product_id:p.id,unit:p.unit,unit_price:p.cost || 0,supplier_code:''}]:form.supplier_items.filter(r=>r.product_id!==p.id));}
  function change(id,k,v){set('supplier_items',form.supplier_items.map(r=>r.product_id===id?{...r,[k]:v}:r));}
  return <Dialog open onOpenChange={close}><DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{supplier?ui("Manage supplier"):ui("New supplier")}</DialogTitle></DialogHeader>
    <fieldset disabled={saving||!!supplier?.supplier_removed_at} className="space-y-3"><div className="flex gap-2"><Button variant={tab==='contact'?'default':'outline'} onClick={()=>setTab('contact')}>{ui("Contact & terms")}</Button><Button variant={tab==='items'?'default':'outline'} onClick={()=>setTab('items')}>{ui("Items supplied (")}{form.supplier_items.length})</Button></div>
    {tab==='contact'?<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[['name',ui("Supplier name *")],['contact_person',ui("Contact person")],['phone','Phone'],['email','Email'],['city','City'],['address','Address'],['category','Category'],['tax_id',ui("Tax ID")]].map(([k,label])=><Field key={k} label={label}><Input value={form[k] || ''} onChange={e=>set(k,e.target.value)} type={k==='email'?'email':'text'}/></Field>)}<Field label={ui("Payment terms (days)")}><Input type="number" min="0" max="3650" value={form.payment_terms_days} onChange={e=>set('payment_terms_days',e.target.value)}/></Field><Field label={ui("Status")}><NativeSelect value={form.is_active===false?'inactive':'active'} onChange={e=>set('is_active',e.target.value==='active')}><option value="active">{ui("Active")}</option><option value="inactive">{ui("Inactive (keep history)")}</option></NativeSelect></Field><div className="sm:col-span-2"><Field label={ui("Notes")}><Input value={form.notes || ''} onChange={e=>set('notes',e.target.value)}/></Field></div></div>:<div className="space-y-3"><p className="text-xs text-slate-500">{ui("Select the items this supplier sells. Prices are in XAF per displayed inventory U/M; item master prices are unchanged.")}</p><Input placeholder={ui("Find an item...")} value={term} onChange={e=>setTerm(e.target.value)}/><div className="max-h-80 overflow-y-auto divide-y rounded-xl border">{products.filter(p=>supplierMaterial(p)&&(p.is_active!==false && p.configuration_status!=='draft' || form.supplier_items.some(r=>r.product_id===p.id)) && (p.name+' '+p.sku).toLowerCase().includes(term.toLowerCase())).map(p=>{const row=form.supplier_items.find(r=>r.product_id===p.id);return <div key={p.id} className="flex flex-wrap items-center gap-3 p-3"><input aria-label={'Supplier sells '+p.name} type="checkbox" checked={!!row} onChange={e=>item(p,e.target.checked)}/><ProductThumb product={p}/><div className="min-w-0 flex-1 text-sm"><strong>{p.name}</strong><p className="text-xs text-slate-500">{p.sku} · {p.unit}</p></div>{row&&<><Field label={'Price / '+p.unit}><Input aria-label={'Supplier price for '+p.name} className="w-28" type="number" min="0" step="0.01" value={row.unit_price} onChange={e=>change(p.id,'unit_price',e.target.value)}/></Field><Field label={ui("Supplier code")}><Input className="w-28" value={row.supplier_code || ''} onChange={e=>change(p.id,'supplier_code',e.target.value)}/></Field></>}</div>;})}{!products.length&&<p className="p-4 text-sm text-slate-500">{ui("Save the supplier, then open Manage supplier to choose registered items.")}</p>}</div></div>}
    <DialogFooter><Button variant="outline" disabled={saving} onClick={close}>{ui("Cancel")}</Button><Button disabled={saving || !form.name.trim()} onClick={()=>save({action:'saveSupplier',requestKey:key,supplierId:supplier?.id,supplier:form},'Supplier saved')}>{saving?ui("Saving..."):ui("Save supplier")}</Button></DialogFooter></fieldset>
    {supplier&&<SupplierRemoval supplier={supplier} disabled={saving} onBusyChange={setSaving} onDone={record=>{onSaved?.({supplier:record,removed:!!record.supplier_removed_at});onClose();}}/>}
  </DialogContent></Dialog>;
}

export function SupplierOrderForm({data,order,onClose,onSaved,onChangeSupplier,onManageCatalogue}) {
  useInterfaceLanguage();
  const {supplier,products,warehouses,orderLines=[]}=data;
  const [form,setForm]=useState(()=>({supplier_id:supplier.id,order_date:businessDate(),expected_date:'',warehouse_id:'',payment_terms:'credit',notes:'',...order,lines:order?orderLines.filter(l=>l.po_id===order.id):[]}));
  const [term,setTerm]=useState('');
  const {saving,close,save}=useSave(onSaved,onClose),set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const choices=supplierCatalogue(supplier,products), filtered=choices.filter(p=>(p.name+' '+p.sku+' '+p.supplier_code).toLowerCase().includes(term.toLowerCase()));
  function add(p) {
    setForm(f=>({...f,lines:f.lines.some(l=>l.product_id===p.id)?f.lines.map(l=>l.product_id===p.id?{...l,quantity:Math.round((Number(l.quantity || 0)+1)*1000)/1000}:l):[...f.lines,{product_id:p.id,unit:p.unit,quantity:1,unit_price:p.supplier_price,tax_rate:0}]}));
  }
  function line(index,field,value) {
    setForm(f=>({...f,lines:f.lines.map((row,i)=>{
      if(i!==index)return row;
      if(field==='product_id'){const p=choices.find(p=>p.id===value);return p?{...row,product_id:p.id,unit:p.unit,unit_price:p.supplier_price}:row;}
      return {...row,[field]:value};
    })}));
  }
  const total=form.lines.reduce((sum,l)=>sum+Number(l.quantity || 0)*Number(l.unit_price || 0)*(1+Number(l.tax_rate || 0)/100),0);
  const invalid=!form.lines.length || form.lines.some(l=>!choices.some(p=>p.id===l.product_id) || !Number.isFinite(Number(l.quantity)) || Number(l.quantity)<=0 || !Number.isFinite(Number(l.unit_price)) || Number(l.unit_price)<0);
  const submit=status=>save({action:'saveSupplierOrder',orderId:order?.id,order:{...form,catalogue_only:true},status},status==='draft'?ui('Purchase order saved'):ui('Sent for General Manager approval'));
  return <Dialog open onOpenChange={close}><DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>{order?ui('Edit {0}',order.po_number):ui('New purchase order')} · {supplier.name}</DialogTitle></DialogHeader>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-600">{ui('Choose goods from this supplier’s catalogue. Their agreed price fills automatically.')}</p>{!order&&onChangeSupplier&&<Button variant="outline" disabled={saving} onClick={()=>{if(!form.lines.length || window.confirm(ui('Changing supplier clears the unsaved order. Continue?')))onChangeSupplier();}}>{ui('Change supplier')}</Button>}</div>
    <div className="grid gap-3 sm:grid-cols-3"><Field label={ui('Order date')}><Input type="date" disabled={saving} value={form.order_date} onChange={e=>set('order_date',e.target.value)}/></Field><Field label={ui('Expected delivery')}><Input type="date" disabled={saving} value={form.expected_date || ''} onChange={e=>set('expected_date',e.target.value)}/></Field><Field label={ui('Receiving warehouse')}><NativeSelect disabled={saving} value={form.warehouse_id || ''} onChange={e=>set('warehouse_id',e.target.value)}><option value="">{ui('Select warehouse')}</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</NativeSelect></Field></div>
    <section className="space-y-3 rounded-xl border bg-slate-50 p-3" aria-label={ui('Supplier goods catalogue')}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{ui('Items supplied')} ({choices.length})</h3>{onManageCatalogue&&<Button variant="outline" size="sm" disabled={saving} onClick={onManageCatalogue}>{ui('Manage supplier catalogues')}</Button>}</div><Input aria-label={ui('Search supplier goods')} placeholder={ui('Search goods or supplier code...')} value={term} disabled={saving} onChange={e=>setTerm(e.target.value)}/>
      <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{filtered.map(p=><div key={p.id} className="flex items-center gap-3 rounded-lg border bg-white p-3"><ProductThumb product={p}/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{p.name}</p><p className="text-xs text-slate-500">{p.supplier_code || p.sku} · {formatXAF(p.supplier_price)} / {p.unit}</p></div><Button size="sm" variant="outline" disabled={saving} aria-label={ui('Add {0}',p.name)} onClick={()=>add(p)}>{ui('Add')}</Button></div>)}</div>
      {!choices.length?<p role="alert" className="text-sm text-slate-800">{ui('No goods are linked to this supplier. Procurement must set up Items supplied before an order can be prepared.')}</p>:!filtered.length&&<p className="text-sm text-slate-500">{ui('No supplier goods match your search.')}</p>}
    </section>
    <div className="overflow-x-auto"><table className="mobile-table-cards w-full min-w-[650px] text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>{ui('Item')}</th><th>{ui('Quantity')}</th><th>{ui('Unit price (XAF)')}</th><th>{ui('Tax %')}</th><th/></tr></thead><tbody>{form.lines.map((l,i)=><tr key={i}><td data-label={ui("Item")} className="py-2 pr-2"><NativeSelect aria-label={ui('Order item {0}',i+1)} disabled={saving} value={l.product_id} onChange={e=>line(i,'product_id',e.target.value)}><option value="">{ui('Select item')}</option>{!choices.some(p=>p.id===l.product_id)&&l.product_id&&<option disabled value={l.product_id}>{l.product_name || products.find(p=>p.id===l.product_id)?.name || l.product_id} — {ui('Not linked to supplier')}</option>}{choices.map(p=><option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</NativeSelect></td><td data-label={ui("Quantity")} className="pr-2"><Input aria-label={ui('Quantity {0}',i+1)} type="number" min="0.001" step="0.001" className="w-28" disabled={saving} value={l.quantity} onChange={e=>line(i,'quantity',e.target.value)}/></td><td data-label={ui("Unit price (XAF)")} className="pr-2"><Input aria-label={ui('Unit price {0}',i+1)} type="number" min="0" step="0.01" disabled={saving} value={l.unit_price} onChange={e=>line(i,'unit_price',e.target.value)}/></td><td data-label={ui("Tax %")}><Input aria-label={ui('Tax rate {0}',i+1)} type="number" min="0" max="100" className="w-20" disabled={saving} value={l.tax_rate || 0} onChange={e=>line(i,'tax_rate',e.target.value)}/></td><td data-label={ui("Actions")}><Button variant="ghost" size="icon" disabled={saving} aria-label={ui('Remove item')} onClick={()=>set('lines',form.lines.filter((_,n)=>n!==i))}><Trash2 size={15}/></Button></td></tr>)}</tbody></table></div>
    <div className="flex items-center justify-between"><Button variant="outline" disabled={saving || !choices.length} onClick={()=>set('lines',[...form.lines,{product_id:'',quantity:1,unit_price:0,tax_rate:0}])}><Plus size={15} className="mr-1"/>{ui('Add item')}</Button><strong>{formatXAF(total)}</strong></div>
    <Field label={ui('Payment terms')}><NativeSelect disabled={saving} value={form.payment_terms} onChange={e=>set('payment_terms',e.target.value)}><option value="credit">{ui('Credit')}</option><option value="cash">{ui('Cash / advance')}</option></NativeSelect></Field><Field label={ui('Notes to supplier')}><Input disabled={saving} value={form.notes || ''} onChange={e=>set('notes',e.target.value)}/></Field>
    <DialogFooter><Button variant="outline" disabled={saving} onClick={close}>{ui('Cancel')}</Button><Button variant="outline" disabled={saving || invalid} onClick={()=>submit('draft')}>{ui('Save draft')}</Button><Button disabled={saving || invalid} onClick={()=>submit('pending_approval')}>{saving?ui('Saving...'):ui('Submit for approval')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function SupplierReceiveForm({data,order,onClose,onSaved}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [date,setDate]=useState(businessDate()),[warehouseId,setWarehouse]=useState(order.warehouse_id || ''),[lines,setLines]=useState(()=>data.orderLines.filter(l=>l.po_id===order.id && Number(l.quantity)>Number(l.received_quantity || 0)).map(l=>({...l,po_line_id:l.id,remaining:Number(l.quantity)-Number(l.received_quantity || 0),quantity:Number(l.quantity)-Number(l.received_quantity || 0),lot_number:'',expiry_date:''})));
  const {saving,close,save}=useSave(onSaved,onClose);
  const receivingItems=lines.filter(l=>Number(l.quantity)>0).map(l=>data.products.find(p=>p.id===l.product_id));
  const receivingWarehouses=data.warehouses.filter(w=>receivingItems.every(p=>finishedStorageAllowed(p,w)));
  const receivingWarehouse=receivingWarehouses.some(w=>w.id===warehouseId)?warehouseId:receivingWarehouses.length===1?receivingWarehouses[0].id:'';
  function change(i,k,v){setLines(rows=>rows.map((r,n)=>n===i?{...r,[k]:v}:r));}
  return <Dialog open onOpenChange={close}><DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{ui("Receive inventory · ")}{order.po_number}</DialogTitle></DialogHeader><p className="text-sm text-slate-500">{ui("Record accepted goods only. A linked bill and the inventory/payable journal are recorded together. Tax on the order is included in inventory value.")}</p><p className="text-xs text-sky-800">{ui('Finished-product receipts require Cold Room storage.')}</p><div className="grid gap-3 sm:grid-cols-2"><Field label={ui("Receipt date")}><Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field><Field label={ui("Receiving warehouse")}><NativeSelect value={receivingWarehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">{ui("Select warehouse")}</option>{receivingWarehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</NativeSelect></Field></div><div className="space-y-3">{lines.map((l,i)=><div key={l.id} className="grid items-end gap-3 rounded-xl border p-3 sm:grid-cols-4"><div><strong className="text-sm">{l.product_name}</strong><p className="text-xs text-slate-500">{ui("Remaining: ")}{l.remaining} {l.unit}</p></div><Field label={'Receiving ('+l.unit+')'}><Input type="number" min="0" max={l.remaining} step="0.001" value={l.quantity} onChange={e=>change(i,'quantity',e.target.value)}/></Field><Field label={ui("Printed batch / lot")}><Input value={l.lot_number} onChange={e=>change(i,'lot_number',e.target.value)}/></Field><Field label={ui("Expiry date")}><Input type="date" value={l.expiry_date} onChange={e=>change(i,'expiry_date',e.target.value)}/></Field></div>)}</div><DialogFooter><Button variant="outline" disabled={saving} onClick={close}>{ui("Cancel")}</Button><Button disabled={saving || !receivingWarehouse || !lines.length} onClick={()=>save({action:'receiveSupplierOrder',orderId:order.id,date,warehouseId:receivingWarehouse,lines:lines.map(l=>({po_line_id:l.po_line_id,quantity:l.quantity,lot_number:l.lot_number,expiry_date:l.expiry_date}))},'Inventory received and bill registered')}>{saving?ui("Receiving..."):ui("Confirm receipt")}</Button></DialogFooter></DialogContent></Dialog>;
}

export function SupplierPaymentForm({data,bill,onClose,onSaved}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [amount,setAmount]=useState(bill.balance),[accountId,setAccount]=useState(''),[date,setDate]=useState(businessDate()),[reference,setReference]=useState('');
  const {saving,close,save}=useSave(onSaved,onClose);
  return <Dialog open onOpenChange={close}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{ui("Pay bill · ")}{bill.bill_number}</DialogTitle></DialogHeader><p className="text-sm text-slate-500">{ui("Unpaid: ")}{formatXAF(bill.balance)}{ui(". Request approval, then release the approved payment. Cash and the bill balance change only on release.")}</p><Field label={ui("Pay from")}><NativeSelect value={accountId} onChange={e=>setAccount(e.target.value)}><option value="">{ui("Select cash / bank account")}</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {formatXAF(a.balance)}</option>)}</NativeSelect></Field><div className="grid grid-cols-2 gap-3"><Field label={ui("Amount (XAF)")}><Input type="number" min="0.01" max={bill.balance} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></Field><Field label={ui("Date")}><Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field></div><Field label={ui("Payment reference")}><Input value={reference} onChange={e=>setReference(e.target.value)}/></Field><DialogFooter><Button variant="outline" disabled={saving} onClick={close}>{ui("Cancel")}</Button><Button disabled={saving || !accountId || !reference.trim() || !(Number(amount)>0)} onClick={()=>save({action:'cashierRequestPayment',billId:bill.id,accountId,amount:Number(amount),date,reference},'Bill payment awaiting General Manager approval')}>{saving?ui("Requesting..."):ui("Request payment approval")}</Button></DialogFooter></DialogContent></Dialog>;
}
