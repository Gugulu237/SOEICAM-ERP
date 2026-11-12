export function customerOpenInvoiceQuery(customerId) {
  return {
    customer_id: customerId,
    status: { $in: ['posted', 'partially_paid', 'overdue'] },
    balance: { $gt: 0 },
    payment_type: { $ne: 'cash' },
  };
}

export function headquartersDeliveryBalanceQuery(branch, headquarters) {
  if (!branch?.id || !headquarters?.id || branch.id === headquarters.id || branch.parent_id !== headquarters.id || headquarters.parent_id) return null;
  return {
    ...customerOpenInvoiceQuery(headquarters.id),
    location_id: branch.id,
    accounting_source: { $ne: 'opening_balances' },
    opening_batch_id: { $in: ['', null] },
  };
}

export function customerAccountBalance(customer) {
  const balance = customer?.balance;
  return (typeof balance === 'number' || typeof balance === 'string' && balance.trim()) && Number.isFinite(Number(balance)) ? Number(balance) : null;
}

export function customerGroupBalance(headquarters, branches) {
  const accounts = new Map([[headquarters.id, headquarters]]);
  for (const branch of branches) {
    if (branch.id && branch.id !== headquarters.id && branch.parent_id === headquarters.id) accounts.set(branch.id, branch);
  }
  let cents = 0;
  for (const customer of accounts.values()) {
    const balance = customerAccountBalance(customer);
    if (balance === null) return null;
    cents += Math.round(balance * 100);
  }
  return cents / 100;
}
