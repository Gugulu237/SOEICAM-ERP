const amount = n => new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(Number(n || 0))+' XAF';
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function purchaseOrderText(order,lines) {
  return ['SOEICAM - Purchase order '+order.po_number,'Supplier: '+order.supplier_name,'Date: '+order.order_date,'Expected delivery: '+(order.expected_date || 'To be agreed'),'Status: '+order.status,'',...lines.map(l=>`${l.product_name}: ${l.quantity} ${l.unit} at ${amount(l.unit_price)}; total ${amount(l.total)}`),'','Total: '+amount(order.total),order.notes || ''].join('\r\n');
}
export function purchaseOrderHtml(order,lines) {
  return '<!doctype html><html lang="en"><meta charset="utf-8"><title>'+escape(order.po_number)+'</title><style>body{font:14px system-ui;margin:40px;color:#172033}table{border-collapse:collapse;width:100%;margin:24px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}td:nth-child(n+2),th:nth-child(n+2){text-align:right}pre{font:inherit;white-space:pre-wrap}@media print{button{display:none}}</style><button onclick="window.print()">Print / save as PDF</button><h1>SOEICAM</h1><h2>Purchase order '+escape(order.po_number)+'</h2><p>Supplier: '+escape(order.supplier_name)+'</p><p>Date: '+escape(order.order_date)+' | Expected: '+escape(order.expected_date || 'To be agreed')+'</p><p>Status: '+escape(order.status)+'</p><table><tr><th>Item</th><th>Quantity / U/M</th><th>Unit price</th><th>Tax</th><th>Total</th></tr>'+lines.map(l=>'<tr><td>'+escape(l.product_name)+'</td><td>'+escape(l.quantity)+' '+escape(l.unit)+'</td><td>'+escape(amount(l.unit_price))+'</td><td>'+escape(l.tax_rate || 0)+'%</td><td>'+escape(amount(l.total))+'</td></tr>').join('')+'</table><h3>Total: '+escape(amount(order.total))+'</h3><pre>'+escape(order.notes || '')+'</pre></html>';
}
export function downloadPurchaseOrder(order,lines) {
  const url=URL.createObjectURL(new Blob([purchaseOrderHtml(order,lines)],{type:'text/html;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=String(order.po_number).replace(/[^A-Za-z0-9_-]/g,'')+'.html';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export const purchaseOrderEmail = (supplier,order,lines) => 'mailto:'+encodeURIComponent(supplier.email)+'?subject='+encodeURIComponent('SOEICAM Purchase Order '+order.po_number)+'&body='+encodeURIComponent(purchaseOrderText(order,lines));
