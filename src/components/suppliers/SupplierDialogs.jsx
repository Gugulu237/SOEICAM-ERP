import {SupplierTransactionHeader,supplierTransactionClass,supplierTransactionBody,supplierTransactionFooter} from './SupplierTransactionLayout';
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import {isPackagingItem} from '@/lib/inventory-packaging';
import {sortProductRows} from '@/lib/product-sorting';
import ProductSortSelect from '@/components/shared/ProductSortSelect';

/* localized-interface */
import SupplierRemoval from './SupplierRemoval';
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, {useState} from 'react';
import {erp} from '@/api/erpClient';
import {businessDate} from '@/lib/business-date';
import {formatAccountingXAF,formatDate,formatXAF} from '@/lib/formatters';
import {purchaseQuoteAmounts,purchaseReceiptAmounts} from '@/lib/purchase-vat';
import {STANDARD_VAT_RATE} from '@/lib/sale-vat';
import PurchaseVatRateSelect from './PurchaseVatRateSelect';
import {printSupplierBill} from '@/lib/supplier-documents';
import {finishedStorageAllowed} from '@/lib/finished-product-storage';
import {supplierCatalogue,supplierItems,supplierMaterial} from '@/lib/supplier-catalogue';
import {Dialog,DialogContent,DialogFooter} from '@/components/ui/dialog';
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

export function SupplierVatTotals({subtotal,tax,total,estimate=false}){
  return <dl className="space-y-1 text-sm tabular-nums">
    {subtotal!=null&&<div className="flex justify-between gap-2"><dt>{ui('Net before VAT')}</dt><dd>{formatAccountingXAF(subtotal)}</dd></div>}
    {tax!=null&&<div className="flex justify-between gap-2"><dt>{ui(estimate?'Estimated VAT included':'VAT included')}</dt><dd>{formatAccountingXAF(tax)}</dd></div>}
    <div className="flex justify-between gap-2 font-semibold"><dt>{ui('Total incl. VAT')}</dt><dd>{formatAccountingXAF(total)}</dd></div>
  </dl>;
}

function SupplierInvoiceVatFields({value,onChange,allowUnverified,disabled}){
  const set=(key,field)=>onChange({...value,[key]:field});
  return <section className="space-y-3 rounded-xl border bg-white p-4">
    <Field label={ui('Supplier invoice VAT')}><NativeSelect value={value.treatment} disabled={disabled} onChange={e=>onChange({treatment:e.target.value,reference:'',taxAmount:'',confirmed:false})}>
      {allowUnverified&&<option value="unverified">{ui('Invoice VAT pending verification')}</option>}
      {!allowUnverified&&<option value="">{ui('Choose invoice VAT')}</option>}
      <option value="none">{ui('Supplier charges no VAT')}</option><option value="documented">{ui('VAT shown on supplier invoice')}</option>
    </NativeSelect></Field>
    {['none','documented'].includes(value.treatment)&&<Field label={ui(value.treatment==='none'?'Supplier invoice number (optional)':'Supplier invoice number')}><Input maxLength={120} value={value.reference||''} disabled={disabled} onChange={e=>set('reference',e.target.value)}/></Field>}
    {value.treatment==='documented'&&<>
      <Field label={ui('VAT amount on supplier invoice (XAF)')}><Input type="number" min="0.01" step="0.01" value={value.taxAmount||''} disabled={disabled} onChange={e=>set('taxAmount',e.target.value)}/></Field>
      <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={value.confirmed===true} disabled={disabled} onChange={e=>set('confirmed',e.target.checked)}/>{ui('I checked the supplier invoice VAT and total for these received goods.')}</label>
    </>}
  </section>;
}

const invoiceVatInvalid=value=>!value.treatment||value.treatment==='documented'&&(!value.reference?.trim()||!value.confirmed||!(Number(value.taxAmount)>0));

function useSave(onSaved,onClose){
  const [saving,setSaving]=useState(false),[key]=useState(()=>crypto.randomUUID()),{toast}=useToast();
  return {saving,key,setSaving,close:()=>!saving&&onClose(),save:async(body,title)=>{setSaving(true);try{const data=await supplierInvoke({...body,requestKey:key});toast({title});if(onSaved?.(data)!==false)onClose();}catch(e){toast({title:ui("Unable to save"),description:e.message,variant:'destructive'});}finally{setSaving(false);}}};
}

export function SupplierForm({supplier,products=[],initialTab='contact',onClose,onSaved}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const phone=usePhoneLayout();

  const [form,setForm]=useState(()=>({name:'',contact_person:'',phone:'',email:'',address:'',city:'',category:'',tax_id:'',notes:'',payment_terms_days:30,is_active:true,...supplier,supplier_items:supplierItems(supplier).filter(row=>!products.some(p=>p.id===row.product_id&&!supplierMaterial(p)))}));
  const [sort,setSort]=useState('name');
  const [term,setTerm]=useState(''),[tab,setTab]=useState(initialTab),{saving,key,setSaving,close,save}=useSave(onSaved,onClose);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  function item(p,checked){set('supplier_items',checked?[...form.supplier_items,{product_id:p.id,unit:p.unit,unit_price:p.cost || 0,supplier_code:''}]:form.supplier_items.filter(r=>r.product_id!==p.id));}
  function change(id,k,v){set('supplier_items',form.supplier_items.map(r=>r.product_id===id?{...r,[k]:v}:r));}
  return <Dialog open onOpenChange={close}><DialogContent className={"max-w-3xl max-h-[90vh] overflow-y-auto "+supplierTransactionClass}><SupplierTransactionHeader phone={phone} title={supplier?ui("Manage supplier"):ui("New supplier")} onBack={close} disabled={saving}/><div className={supplierTransactionBody}>
    <fieldset disabled={saving||!!supplier?.supplier_removed_at} className="space-y-3"><div className="flex gap-2"><Button variant={tab==='contact'?'default':'outline'} onClick={()=>setTab('contact')}>{ui("Contact & terms")}</Button><Button variant={tab==='items'?'default':'outline'} onClick={()=>setTab('items')}>{ui("Items supplied (")}{form.supplier_items.length})</Button></div>
    {tab==='contact'?<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[['name',ui("Supplier name *")],['contact_person',ui("Contact person")],['phone','Phone'],['email','Email'],['city','City'],['address','Address'],['category','Category'],['tax_id',ui("Tax ID")]].map(([k,label])=><Field key={k} label={label}><Input value={form[k] || ''} onChange={e=>set(k,e.target.value)} type={k==='email'?'email':'text'}/></Field>)}<Field label={ui("Payment terms (days)")}><Input type="number" min="0" max="3650" value={form.payment_terms_days} onChange={e=>set('payment_terms_days',e.target.value)}/></Field><Field label={ui("Status")}><NativeSelect value={form.is_active===false?'inactive':'active'} onChange={e=>set('is_active',e.target.value==='active')}><option value="active">{ui("Active")}</option><option value="inactive">{ui("Inactive (keep history)")}</option></NativeSelect></Field><div className="sm:col-span-2"><Field label={ui("Notes")}><Input value={form.notes || ''} onChange={e=>set('notes',e.target.value)}/></Field></div></div>:<div className="space-y-3"><p className="text-xs text-slate-500">{ui("Select the items this supplier sells. Prices are in XAF per displayed inventory U/M; item master prices are unchanged.")}</p><Input placeholder={ui("Find an item...")} value={term} onChange={e=>setTerm(e.target.value)}/><ProductSortSelect value={sort} onChange={setSort} className="sm:max-w-xs"/><div className="max-h-80 overflow-y-auto divide-y rounded-xl border">{sortProductRows(products,sort).filter(p=>supplierMaterial(p)&&(p.is_active!==false && p.configuration_status!=='draft' || form.supplier_items.some(r=>r.product_id===p.id)) && (p.name+' '+p.sku).toLowerCase().includes(term.toLowerCase())).map(p=>{const row=form.supplier_items.find(r=>r.product_id===p.id);return <div key={p.id} className="flex flex-wrap items-center gap-3 p-3"><input aria-label={'Supplier sells '+p.name} type="checkbox" checked={!!row} onChange={e=>item(p,e.target.checked)}/><ProductThumb product={p}/><div className="min-w-0 flex-1 text-sm"><strong>{p.name}</strong><p className="text-xs text-slate-500">{p.sku} · {p.unit}</p></div>{row&&<><Field label={'Price / '+p.unit}><Input aria-label={'Supplier price for '+p.name} className="w-28" type="number" min="0" step="0.01" value={row.unit_price} onChange={e=>change(p.id,'unit_price',e.target.value)}/></Field><Field label={ui("Supplier code")}><Input className="w-28" value={row.supplier_code || ''} onChange={e=>change(p.id,'supplier_code',e.target.value)}/></Field></>}</div>;})}{!products.length&&<p className="p-4 text-sm text-slate-500">{ui("Save the supplier, then open Manage supplier to choose registered items.")}</p>}</div></div>}
    </fieldset>
    {supplier&&<SupplierRemoval supplier={supplier} disabled={saving} onBusyChange={setSaving} onDone={record=>{onSaved?.({supplier:record,removed:!!record.supplier_removed_at});onClose();}}/>}</div><DialogFooter data-mobile-action-bar className={supplierTransactionFooter}><Button className="max-sm:hidden" variant="outline" disabled={saving} onClick={close}>{ui("Cancel")}</Button><Button className="max-sm:min-h-14 max-sm:w-full" disabled={saving || !!supplier?.supplier_removed_at || !form.name.trim()} onClick={()=>save({action:'saveSupplier',requestKey:key,supplierId:supplier?.id,supplier:form},'Supplier saved')}>{saving?ui("Saving..."):ui("Save supplier")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function SupplierOrderForm({data,order,onClose,onSaved,onChangeSupplier,onManageCatalogue}) {
  useInterfaceLanguage();
  const phone=usePhoneLayout();
  const {supplier,products,warehouses,orderLines=[]}=data;
  const [form,setForm]=useState(()=>({supplier_id:supplier.id,order_date:businessDate(),expected_date:'',warehouse_id:'',payment_terms:'credit',notes:'',...order,price_includes_vat:!order||order.price_includes_vat===true,lines:order?orderLines.filter(l=>l.po_id===order.id):[]}));
  const [term,setTerm]=useState(''),[sort,setSort]=useState('name');
  const {saving,close,save}=useSave(onSaved,onClose),set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const choices=sortProductRows(supplierCatalogue(supplier,products),sort), filtered=choices.filter(p=>(p.name+' '+p.sku+' '+p.supplier_code).toLowerCase().includes(term.toLowerCase()));
  const includesVat=form.price_includes_vat,taxDefault=includesVat?STANDARD_VAT_RATE:0;
  const priceLabel=ui(includesVat?'Unit price incl. VAT (XAF)':'Unit price (XAF)'),taxLabel=ui(includesVat?'VAT treatment':'Tax %');
  function add(p) {
    setForm(f=>({...f,lines:f.lines.some(l=>l.product_id===p.id)?f.lines.map(l=>l.product_id===p.id?{...l,quantity:Math.round((Number(l.quantity || 0)+1)*1000)/1000}:l):[...f.lines,{product_id:p.id,unit:p.unit,quantity:1,unit_price:p.supplier_price,tax_rate:taxDefault}]}));
  }
  function line(index,field,value) {
    setForm(f=>({...f,lines:f.lines.map((row,i)=>{
      if(i!==index)return row;
      if(field==='product_id'){const p=choices.find(p=>p.id===value);return p?{...row,product_id:p.id,unit:p.unit,unit_price:p.supplier_price}:row;}
      return {...row,[field]:value};
    })}));
  }
  const invalid=!form.lines.length || form.lines.some(l=>!choices.some(p=>p.id===l.product_id) || !Number.isFinite(Number(l.quantity)) || Number(l.quantity)<=0 || !Number.isFinite(Number(l.unit_price)) || Number(l.unit_price)<0);
  const amounts=l=>purchaseQuoteAmounts(Math.max(0,Number(l.quantity)||0),Math.max(0,Number(l.unit_price)||0),Number(l.tax_rate||0),includesVat);
  const totals=form.lines.reduce((sum,l)=>{const {net,tax,total}=amounts(l);return {net:sum.net+net,tax:sum.tax+tax,total:sum.total+total};},{net:0,tax:0,total:0});
  const rateInput=(row,index)=>includesVat?<PurchaseVatRateSelect label={ui('VAT treatment for item {0}',index+1)} disabled={saving} value={row.tax_rate} onChange={value=>line(index,'tax_rate',value)}/>:<Input aria-label={ui('Tax rate {0}',index+1)} type="number" min="0" max="100" disabled={saving} value={row.tax_rate||0} onChange={e=>line(index,'tax_rate',e.target.value)}/>;
  const submit=status=>save({action:'saveSupplierOrder',orderId:order?.id,order:{...form,catalogue_only:true},status},status==='draft'?ui('Purchase order saved'):ui('Purchase order saved and ready to receive'));
  return <Dialog open onOpenChange={close}><DialogContent className={'max-h-[92vh] max-w-5xl overflow-y-auto '+supplierTransactionClass}><SupplierTransactionHeader phone={phone} title={order?ui('Edit {0}',order.po_number):ui('New purchase order')} description={supplier.name} onBack={close} disabled={saving}/><div className={supplierTransactionBody}>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-600">{ui('Choose goods from this supplier’s catalogue. Their agreed price fills automatically.')}</p>{!order&&onChangeSupplier&&<Button variant="outline" disabled={saving} onClick={()=>{if(!form.lines.length || window.confirm(ui('Changing supplier clears the unsaved order. Continue?')))onChangeSupplier();}}>{ui('Change supplier')}</Button>}</div>
    <div className="grid gap-3 sm:grid-cols-3"><Field label={ui('Order date')}><Input type="date" disabled={saving} value={form.order_date} onChange={e=>set('order_date',e.target.value)}/></Field><Field label={ui('Expected delivery')}><Input type="date" disabled={saving} value={form.expected_date || ''} onChange={e=>set('expected_date',e.target.value)}/></Field><Field label={ui('Receiving warehouse')}><NativeSelect disabled={saving} value={form.warehouse_id || ''} onChange={e=>set('warehouse_id',e.target.value)}><option value="">{ui('Select warehouse')}</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</NativeSelect></Field></div>
    <section className="space-y-3 rounded-xl border bg-slate-50 p-3" aria-label={ui('Supplier goods catalogue')}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{ui('Items supplied')} ({choices.length})</h3>{onManageCatalogue&&<Button variant="outline" size="sm" disabled={saving} onClick={onManageCatalogue}>{ui('Manage supplier catalogues')}</Button>}</div><Input aria-label={ui('Search supplier goods')} placeholder={ui('Search goods or supplier code...')} value={term} disabled={saving} onChange={e=>setTerm(e.target.value)}/>
      <ProductSortSelect value={sort} onChange={setSort} disabled={saving} className="sm:max-w-xs"/>
      <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{filtered.map(p=><div key={p.id} className="flex items-center gap-3 rounded-lg border bg-white p-3"><ProductThumb product={p}/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{p.name}</p><p className="text-xs text-slate-500">{p.supplier_code || p.sku} · {formatXAF(p.supplier_price)} / {p.unit}</p></div><Button size="sm" variant="outline" disabled={saving} aria-label={ui('Add {0}',p.name)} onClick={()=>add(p)}>{ui('Add')}</Button></div>)}</div>
      {!choices.length?<p role="alert" className="text-sm text-slate-800">{ui('No goods are linked to this supplier. Add goods in Items supplied before recording an order.')}</p>:!filtered.length&&<p className="text-sm text-slate-500">{ui('No supplier goods match your search.')}</p>}
    </section>
    {phone?<section aria-label={ui('Order items')} className="space-y-3"><h3 className="text-xs font-bold uppercase tracking-wider text-primary">{ui('Items')} · {form.lines.length}</h3>{form.lines.map((item,index)=><article key={index} className="rounded-xl border bg-white p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold">{choices.find(p=>p.id===item.product_id)?.name||item.product_name||ui('Select item')}</p><p className="mt-1 text-xs text-muted-foreground">{item.unit}</p></div><Button variant="ghost" size="icon" disabled={saving} aria-label={ui('Remove item')} onClick={()=>set('lines',form.lines.filter((_,n)=>n!==index))}><Trash2 size={15}/></Button></div><Field label={ui('Item')}><NativeSelect aria-label={ui('Order item {0}',index+1)} disabled={saving} value={item.product_id} onChange={e=>line(index,'product_id',e.target.value)}><option value="">{ui('Select item')}</option>{choices.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field><div className="mt-3 grid grid-cols-2 gap-3"><Field label={ui('Quantity')}><Input aria-label={ui('Quantity {0}',index+1)} type="number" min="0.001" step="0.001" disabled={saving} value={item.quantity} onChange={e=>line(index,'quantity',e.target.value)}/></Field><Field label={priceLabel}><Input aria-label={ui('Unit price {0}',index+1)} type="number" min="0" step="0.01" disabled={saving} value={item.unit_price} onChange={e=>line(index,'unit_price',e.target.value)}/></Field><Field label={taxLabel}>{rateInput(item,index)}</Field><div className="self-end pb-3 text-right text-sm font-bold">{formatAccountingXAF(amounts(item).total)}</div></div></article>)}</section>:<div className="overflow-x-auto"><table className="mobile-table-cards w-full min-w-[650px] text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>{ui('Item')}</th><th>{ui('Quantity')}</th><th>{priceLabel}</th><th>{taxLabel}</th><th/></tr></thead><tbody>{form.lines.map((l,i)=><tr key={i}><td data-label={ui("Item")} className="py-2 pr-2"><NativeSelect aria-label={ui('Order item {0}',i+1)} disabled={saving} value={l.product_id} onChange={e=>line(i,'product_id',e.target.value)}><option value="">{ui('Select item')}</option>{!choices.some(p=>p.id===l.product_id)&&l.product_id&&<option disabled value={l.product_id}>{l.product_name || products.find(p=>p.id===l.product_id)?.name || l.product_id} — {ui('Not linked to supplier')}</option>}{choices.map(p=><option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</NativeSelect></td><td data-label={ui("Quantity")} className="pr-2"><Input aria-label={ui('Quantity {0}',i+1)} type="number" min="0.001" step="0.001" className="w-28" disabled={saving} value={l.quantity} onChange={e=>line(i,'quantity',e.target.value)}/></td><td data-label={priceLabel} className="pr-2"><Input aria-label={ui('Unit price {0}',i+1)} type="number" min="0" step="0.01" disabled={saving} value={l.unit_price} onChange={e=>line(i,'unit_price',e.target.value)}/></td><td data-label={taxLabel}>{rateInput(l,i)}</td><td data-label={ui("Actions")}><Button variant="ghost" size="icon" disabled={saving} aria-label={ui('Remove item')} onClick={()=>set('lines',form.lines.filter((_,n)=>n!==i))}><Trash2 size={15}/></Button></td></tr>)}</tbody></table></div>}
    <div className="flex items-center justify-between"><Button variant="outline" disabled={saving || !choices.length} onClick={()=>set('lines',[...form.lines,{product_id:'',quantity:1,unit_price:0,tax_rate:taxDefault}])}><Plus size={15} className="mr-1"/>{ui('Add item')}</Button>{!includesVat&&<strong>{formatAccountingXAF(totals.total)}</strong>}</div>
    {includesVat&&<div className="rounded-xl border bg-white p-4"><SupplierVatTotals subtotal={totals.net} tax={totals.tax} total={totals.total} estimate/></div>}
    <div className="space-y-1">
      <Field label={ui('Payment terms')}><NativeSelect disabled={saving} value={form.payment_terms} onChange={e=>set('payment_terms',e.target.value)}><option value="cash">{ui('Pay cash')}</option><option value="credit">{ui('Buy on credit')}</option></NativeSelect></Field>
      <p className="text-xs text-muted-foreground">{ui(form.payment_terms==='cash'?'Record the supplier payment from the order or the received bill.':'Receiving the goods adds the amount to supplier payables.')}</p>
    </div>
    <Field label={ui('Notes to supplier')}><Input disabled={saving} value={form.notes || ''} onChange={e=>set('notes',e.target.value)}/></Field>
    </div><DialogFooter data-mobile-action-bar className={supplierTransactionFooter}><Button className="max-sm:hidden" variant="outline" disabled={saving} onClick={close}>{ui('Cancel')}</Button><Button variant="outline" disabled={saving || invalid} onClick={()=>submit('draft')}>{ui('Save draft')}</Button><Button className="max-sm:min-h-14" disabled={saving || invalid} onClick={()=>submit('confirmed')}>{saving?ui('Saving...'):ui('Save purchase order')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function SupplierReceiveForm({data,order,onClose,onSaved}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const phone=usePhoneLayout();
  const [date,setDate]=useState(businessDate()),[warehouseId,setWarehouse]=useState(order.warehouse_id || ''),[lines,setLines]=useState(()=>data.orderLines.filter(l=>l.po_id===order.id && Number(l.quantity)>Number(l.received_quantity || 0)).map(l=>({...l,po_line_id:l.id,remaining:Number(l.quantity)-Number(l.received_quantity || 0),quantity:Number(l.quantity)-Number(l.received_quantity || 0),lot_number:'',expiry_date:''})));
  const {saving,close,save}=useSave(onSaved,onClose);
  const receivingItems=lines.filter(l=>Number(l.quantity)>0).map(l=>data.products.find(p=>p.id===l.product_id));
  const receivingWarehouses=data.warehouses.filter(w=>receivingItems.every(p=>finishedStorageAllowed(p,w)));
  const receivingWarehouse=receivingWarehouses.some(w=>w.id===warehouseId)?warehouseId:receivingWarehouses.length===1?receivingWarehouses[0].id:'';
  const [invoiceVat,setInvoiceVat]=useState({treatment:'unverified'});
  const totals=lines.reduce((sum,line)=>{
    const quantity=Number(line.quantity||0),price=Number(line.unit_price),rate=Number(line.tax_rate||0);
    if(!Number.isFinite(quantity)||quantity<=0||quantity>line.remaining||!Number.isFinite(price)||price<0||!Number.isFinite(rate)||rate<0||rate>100)return sum;
    const {total,tax}=purchaseReceiptAmounts(line,quantity,order.price_includes_vat===true);
    return {total:sum.total+total,tax:sum.tax+tax};
  },{total:0,tax:0});
  const receiptTax=invoiceVat.treatment==='documented'?Number(invoiceVat.taxAmount):invoiceVat.treatment==='none'?0:totals.tax;
  const invalid=lines.some(line=>!Number.isFinite(Number(line.quantity))||Number(line.quantity)<0||Number(line.quantity)>line.remaining)||!lines.some(line=>Number(line.quantity)>0)||order.price_includes_vat===true&&totals.total<=0||invoiceVatInvalid(invoiceVat);
  function change(i,k,v){setLines(rows=>rows.map((r,n)=>n===i?{...r,[k]:v}:r));}
  const confirm=()=>save({action:'receiveSupplierOrder',orderId:order.id,date,warehouseId:receivingWarehouse,supplierInvoiceVat:invoiceVat,lines:lines.map(l=>({po_line_id:l.po_line_id,quantity:l.quantity,lot_number:l.lot_number,expiry_date:l.expiry_date}))},'Inventory received and bill registered');
  return <Dialog open onOpenChange={close}><DialogContent data-sleek-screen="stock-receipt" className={'max-w-5xl max-h-[90vh] overflow-y-auto '+supplierTransactionClass}><SupplierTransactionHeader phone={phone} title={ui('Receive inventory')} description={order.po_number} onBack={close} disabled={saving}/><div className={supplierTransactionBody}>
    <div className="rounded-xl border border-l-4 border-l-primary bg-white p-3"><p className="text-sm font-semibold">{order.supplier_name||data.supplier?.name}</p><p className="mt-1 text-xs text-muted-foreground">{ui('Confirmed order')} · {order.po_number}</p>{receivingWarehouse&&<p className="mt-2 text-xs font-semibold text-primary">{receivingWarehouses.find(w=>w.id===receivingWarehouse)?.name}</p>}</div>
    <div className="grid gap-3 sm:grid-cols-2"><Field label={ui('Receipt date')}><Input type="date" disabled={saving} value={date} onChange={e=>setDate(e.target.value)}/></Field><Field label={ui('Receiving warehouse')}><NativeSelect disabled={saving} value={receivingWarehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">{ui('Select warehouse')}</option>{receivingWarehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</NativeSelect></Field></div>
    <section aria-label={ui('Receiving items')} className="space-y-3">{lines.map((line,index)=>{const product=data.products.find(p=>p.id===line.product_id),packaging=isPackagingItem(product||{});return <article key={line.id} className="rounded-xl border bg-white p-3"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{line.product_name}</h3><p className="mt-1 text-xs text-muted-foreground">{ui('Remaining: ')}{line.remaining} {line.unit}</p></div><span className="text-xs font-semibold tabular-nums">{formatXAF(line.unit_price)} / {line.unit}</span></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><Field label={ui('Quantity received')}><Input aria-label={ui('Quantity received for {0}',line.product_name)} type="number" min="0" max={line.remaining} step="0.001" disabled={saving} value={line.quantity} onChange={e=>change(index,'quantity',e.target.value)}/></Field><Field label={ui('Printed batch / lot')}><Input aria-label={ui('Batch for {0}',line.product_name)} disabled={saving} value={line.lot_number} onChange={e=>change(index,'lot_number',e.target.value)}/></Field>{packaging?<p className="self-end rounded-lg bg-secondary p-3 text-xs text-muted-foreground">{ui('Packaging has no expiry date.')}</p>:<Field label={ui('Expiry date')}><Input aria-label={ui('Expiry for {0}',line.product_name)} type="date" disabled={saving} value={line.expiry_date} onChange={e=>change(index,'expiry_date',e.target.value)}/></Field>}</div></article>;})}</section>
    <SupplierInvoiceVatFields value={invoiceVat} onChange={setInvoiceVat} allowUnverified disabled={saving}/>
    <section className="space-y-2 rounded-xl border bg-white p-4"><h3 className="text-sm font-semibold">{ui('Receipt value')}</h3><SupplierVatTotals subtotal={totals.total-receiptTax} tax={receiptTax} total={totals.total} estimate={invoiceVat.treatment==='unverified'}/><p className="text-xs text-muted-foreground">{ui('The full receipt total is posted to inventory and supplier payables.')}</p></section>
    <p className="text-xs text-primary">{ui('Finished-product receipts require Cold Room storage.')}</p></div><DialogFooter data-mobile-action-bar className={supplierTransactionFooter}><Button className="max-sm:hidden" variant="outline" disabled={saving} onClick={close}>{ui('Cancel')}</Button><Button className={phone?'min-h-14 w-full':''} disabled={saving || !receivingWarehouse || invalid} onClick={confirm}>{saving?ui('Receiving...'):ui('Confirm receipt')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function SupplierBillSummary({bill,onClose,onSaved}){
  useInterfaceLanguage();
  const phone=usePhoneLayout(),{saving,close,save}=useSave(onSaved,onClose);
  const [editing,setEditing]=useState(false),[invoiceVat,setInvoiceVat]=useState({treatment:''});
  const waiting=bill.purchase_vat_treatment==='unverified',canRecord=waiting&&!['draft','cancelled'].includes(bill.status)&&!bill.historical_settlement_id;
  const verified=['none','documented'].includes(bill.purchase_vat_treatment);
  return <Dialog open onOpenChange={close}><DialogContent className={'max-w-lg '+supplierTransactionClass}>
    <SupplierTransactionHeader phone={phone} title={ui('Supplier bill summary')} description={bill.bill_number} onBack={close} disabled={saving}/>
    <div className={supplierTransactionBody}>
      <div><strong>{bill.supplier_name}</strong><p className="text-sm text-muted-foreground">{formatDate(bill.bill_date)} · {ui('Due')} {formatDate(bill.due_date)}</p></div>
      {bill.supplier_invoice_reference&&<p className="text-sm">{ui('Supplier invoice number')} · {bill.supplier_invoice_reference}</p>}
      {bill.purchase_vat_treatment?<SupplierVatTotals subtotal={verified?bill.subtotal:null} tax={verified?bill.tax_total:null} total={bill.total}/>:<p className="text-sm font-semibold">{ui('Total')} · {formatAccountingXAF(bill.total)}</p>}
      {waiting&&<p className="text-sm text-muted-foreground">{ui('Invoice VAT pending verification')}</p>}
      {bill.purchase_vat_treatment&&<p className="text-xs text-muted-foreground">{ui('This VAT breakdown describes the supplier invoice. Inventory and payables use the full bill total.')}</p>}
      <p className="text-sm">{ui('Unpaid')} · {formatAccountingXAF(bill.balance)}</p>
      {editing&&<SupplierInvoiceVatFields value={invoiceVat} onChange={setInvoiceVat} disabled={saving}/>}
    </div>
    <DialogFooter data-mobile-action-bar className={supplierTransactionFooter}>
      {editing?<><Button variant="outline" disabled={saving} onClick={()=>setEditing(false)}>{ui('Cancel')}</Button><Button disabled={saving||invoiceVatInvalid(invoiceVat)} onClick={()=>save({action:'recordSupplierBillVat',billId:bill.id,supplierInvoiceVat:invoiceVat},ui('Supplier invoice VAT saved'))}>{saving?ui('Saving...'):ui('Save invoice VAT')}</Button></>:<><Button variant="outline" onClick={()=>printSupplierBill(bill)}>{ui('Print bill summary')}</Button>{canRecord&&<Button onClick={()=>setEditing(true)}>{ui('Record invoice VAT')}</Button>}</>}
    </DialogFooter>
  </DialogContent></Dialog>;
}

export function SupplierPaymentForm({data,bill,order,advanceRemaining,onClose,onSaved}){
  const phone=usePhoneLayout();
  const interfaceLanguage=useInterfaceLanguage(); void interfaceLanguage;
  const maximum=bill?.balance ?? advanceRemaining;
  const [amount,setAmount]=useState(maximum),[accountId,setAccount]=useState(''),[date,setDate]=useState(businessDate()),[reference,setReference]=useState('');
  const {saving,close,save}=useSave(onSaved,onClose);
  const direct=Boolean(order || bill?.po_id&&!bill.opening_batch_id&&bill.accounting_source!=='recurring_expense');
  const accounts=data.accounts || [];
  const documentNumber=bill?.bill_number || order?.po_number;
  const supplierName=bill?.supplier_name || order?.supplier_name || data.supplier?.name;
  const earliest=bill?.bill_date || order?.order_date;
  const validAmount=Number(amount)>0 && Number(amount)<=Number(maximum);
  function submit(){
    return save({
      action:direct?'recordPurchasePayment':'cashierRequestPayment',
      ...(bill?{billId:bill.id}:{orderId:order.id}),
      accountId,amount:Number(amount),date,reference,
    },direct?ui('Purchase payment recorded'):ui('Bill payment awaiting General Manager approval'));
  }
  return <Dialog open onOpenChange={close}>
    <DialogContent data-sleek-screen="supplier-payment" className={'max-h-[90vh] max-w-lg overflow-y-auto '+supplierTransactionClass}>
      <SupplierTransactionHeader phone={phone} title={ui('Supplier payment')} description={documentNumber} onBack={close} disabled={saving}/>
      <div className={supplierTransactionBody}>
        <section className="rounded-xl border bg-white p-4">
          <p className="text-xs text-muted-foreground">{supplierName}</p>
          <strong className="mt-1 block text-lg">{formatXAF(maximum)}</strong>
          <p className="mt-1 text-xs text-muted-foreground">{ui(bill?'Current bill balance':'Unpaid order amount')}</p>
        </section>
        <p className="text-sm text-slate-500">{ui(direct?'Record the payment after paying the supplier.':'This bill payment requires authorization.')}</p>
        {phone&&<div aria-label={ui('Payment accounts')} className="flex gap-2 overflow-x-auto pb-1">
          {accounts.map(account=><button key={account.id} type="button" aria-pressed={accountId===account.id} disabled={saving} onClick={()=>setAccount(account.id)} className={'min-h-11 shrink-0 rounded-xl border px-3 text-xs font-semibold '+(accountId===account.id?'border-primary bg-primary text-white':'bg-white')}>{account.name}</button>)}
        </div>}
        <Field label={ui('Pay from')}><NativeSelect disabled={saving} value={accountId} onChange={e=>setAccount(e.target.value)}>
          <option value="">{ui('Select treasury account')}</option>
          {accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {formatXAF(a.balance)}</option>)}
        </NativeSelect></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={ui('Amount (XAF)')}><Input disabled={saving} type="number" min="0.01" max={maximum} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></Field>
          <Field label={ui('Date')}><Input disabled={saving} type="date" min={earliest} max={businessDate()} value={date} onChange={e=>setDate(e.target.value)}/></Field>
        </div>
        <Field label={ui('Payment reference')}><Input disabled={saving} value={reference} onChange={e=>setReference(e.target.value)}/></Field>
      </div>
      <DialogFooter data-mobile-action-bar className={supplierTransactionFooter}>
        <Button className="max-sm:hidden" variant="outline" disabled={saving} onClick={close}>{ui('Cancel')}</Button>
        <Button className="max-sm:min-h-14 max-sm:w-full" disabled={saving || !accountId || !reference.trim() || !validAmount || !date || date>businessDate() || date<earliest} onClick={submit}>{saving?ui('Saving...'):ui(direct?'Record payment':'Request payment approval')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
