// Posted invoice sales exclude opening balances, drafts and cancelled documents.
export const CUSTOMER_SALE_STATUSES = ['posted', 'partially_paid', 'paid', 'overdue'];
export function customerInvoiceQuery(customerId) {
  return {customer_id:customerId,accounting_source:{$ne:'opening_balances'},status:{$in:CUSTOMER_SALE_STATUSES}};
}
export function customerMonthInvoiceQuery(customerId,now=new Date()) {
  const from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString().slice(0,10);
  const to=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString().slice(0,10);
  return {...customerInvoiceQuery(customerId),invoice_date:{$gte:from,$lt:to}};
}
