import {formatAccountingXAF,formatDate} from './formatters.js';
import {getLocale,ui} from './i18n.js';

const amount = n => new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(Number(n || 0))+' XAF';
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const orderTotals=order=>order.price_includes_vat===true?[['Net before VAT',order.subtotal],['Estimated VAT included',order.tax_total],['Total incl. VAT',order.total]]:[['Total',order.total]];
export function purchaseOrderText(order,lines) {
  return ['SOEICAM - Purchase order '+order.po_number,'Supplier: '+order.supplier_name,'Date: '+order.order_date,'Expected delivery: '+(order.expected_date || 'To be agreed'),'Status: '+order.status,'',...lines.map(l=>`${l.product_name}: ${l.quantity} ${l.unit} at ${amount(l.unit_price)}; total ${amount(l.total)}`),'',...orderTotals(order).map(([label,value])=>label+': '+amount(value)),order.notes || ''].join('\r\n');
}
export function purchaseOrderHtml(order,lines) {
  const unitPrice=order.price_includes_vat===true?'Unit price incl. VAT':'Unit price';
  return '<!doctype html><html lang="en"><meta charset="utf-8"><title>'+escape(order.po_number)+'</title><style>body{font:14px system-ui;margin:40px;color:#172033}table{border-collapse:collapse;width:100%;margin:24px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}td:nth-child(n+2),th:nth-child(n+2){text-align:right}pre{font:inherit;white-space:pre-wrap}@media print{button{display:none}}</style><button onclick="window.print()">Print / save as PDF</button><h1>SOEICAM</h1><h2>Purchase order '+escape(order.po_number)+'</h2><p>Supplier: '+escape(order.supplier_name)+'</p><p>Date: '+escape(order.order_date)+' | Expected: '+escape(order.expected_date || 'To be agreed')+'</p><p>Status: '+escape(order.status)+'</p><table><tr><th>Item</th><th>Quantity / U/M</th><th>'+unitPrice+'</th><th>Tax</th><th>Total</th></tr>'+lines.map(l=>'<tr><td>'+escape(l.product_name)+'</td><td>'+escape(l.quantity)+' '+escape(l.unit)+'</td><td>'+escape(amount(l.unit_price))+'</td><td>'+escape(l.tax_rate || 0)+'%</td><td>'+escape(amount(l.total))+'</td></tr>').join('')+'</table>'+orderTotals(order).map(([label,value])=>'<p>'+escape(label)+': <strong>'+escape(amount(value))+'</strong></p>').join('')+'<pre>'+escape(order.notes || '')+'</pre></html>';
}

export function supplierBillHtml(bill,t=ui,language=getLocale()){
  const evidence=['none','documented'].includes(bill.purchase_vat_treatment);
  const totals=[...(evidence?[['Net before VAT',bill.subtotal],['VAT included',bill.tax_total]]:[]),[bill.purchase_vat_treatment?'Total incl. VAT':'Total',bill.total],['Paid',bill.amount_paid],['Unpaid',bill.balance]];
  const details=[['Supplier',bill.supplier_name],['Date',formatDate(bill.bill_date)],['Due',formatDate(bill.due_date)],['Purchase order',bill.po_number],['Receipt',bill.receipt_number],['Supplier invoice number',bill.supplier_invoice_reference]];
  const row=(label,value)=>'<tr><th scope="row">'+escape(t(label))+'</th><td>'+escape(value)+'</td></tr>';
  return '<!doctype html><html lang="'+escape(language)+'"><meta charset="utf-8"><title>'+escape(bill.bill_number)+'</title><style>body{font:14px system-ui;margin:32px;color:#172033}table{width:100%;max-width:540px;border-collapse:collapse;margin:16px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}td{text-align:right;overflow-wrap:anywhere}@media print{button{display:none}}</style><button onclick="window.print()">'+escape(t('Print / save as PDF'))+'</button><h1>SOEICAM</h1><h2>'+escape(t('Supplier bill summary'))+' '+escape(bill.bill_number)+'</h2><table>'+details.filter(([,value])=>value).map(([label,value])=>row(label,value)).join('')+'</table><table>'+totals.filter(([,value])=>value!=null).map(([label,value])=>row(label,formatAccountingXAF(value))).join('')+'</table>'+(bill.purchase_vat_treatment==='unverified'?'<p>'+escape(t('Invoice VAT pending verification'))+'</p>':'')+'</html>';
}

function downloadHtml(html,reference){
  const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=String(reference).replace(/[^A-Za-z0-9_-]/g,'')+'.html';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export const downloadPurchaseOrder=(order,lines)=>downloadHtml(purchaseOrderHtml(order,lines),order.po_number);
export function printSupplierBill(bill){
  const url=URL.createObjectURL(new Blob([supplierBillHtml(bill)],{type:'text/html;charset=utf-8'}));
  window.open(url,'_blank','noopener,noreferrer');
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export const purchaseOrderEmail = (supplier,order,lines) => 'mailto:'+encodeURIComponent(supplier.email)+'?subject='+encodeURIComponent('SOEICAM Purchase Order '+order.po_number)+'&body='+encodeURIComponent(purchaseOrderText(order,lines));
