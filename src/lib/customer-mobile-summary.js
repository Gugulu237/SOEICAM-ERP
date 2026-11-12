// Posted invoice sales exclude opening balances, drafts and cancelled documents.
export const CUSTOMER_SALE_STATUSES = ['posted', 'partially_paid', 'paid', 'overdue'];
export function customerActivityScope(customerId, headquartersId) {
  return headquartersId ? { $or: [
    { customer_id: customerId },
    { customer_id: headquartersId, location_id: customerId },
  ] } : { customer_id: customerId };
}

export function customerInvoiceQuery(customerId, headquartersId) {
  return {...customerActivityScope(customerId,headquartersId),accounting_source:{$ne:'opening_balances'},status:{$in:CUSTOMER_SALE_STATUSES}};
}
export function customerMonthInvoiceQuery(customerId,now=new Date(),headquartersId) {
  const from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString().slice(0,10);
  const to=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString().slice(0,10);
  return {...customerInvoiceQuery(customerId,headquartersId),invoice_date:{$gte:from,$lt:to}};
}
