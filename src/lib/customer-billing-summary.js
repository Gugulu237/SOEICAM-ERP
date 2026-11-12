export function customerOpenInvoiceQuery(customerId) {
  return {
    customer_id: customerId,
    status: { $in: ['posted', 'partially_paid', 'overdue'] },
    balance: { $gt: 0 },
    payment_type: { $ne: 'cash' },
  };
}

export function headquartersDeliveryBalancesQuery(headquarters, branches) {
  if (!headquarters?.id || headquarters.parent_id) return null;
  const branchIds = [...new Set(branches.filter(branch => branch.id && branch.id !== headquarters.id && branch.parent_id === headquarters.id).map(branch => branch.id))].sort();
  if (!branchIds.length) return null;
  return {
    ...customerOpenInvoiceQuery(headquarters.id),
    location_id: { $in: branchIds },
    accounting_source: { $ne: 'opening_balances' },
    opening_batch_id: { $in: ['', null] },
  };
}

export function branchTotalDue(branch, headquartersDue) {
  const ownBalance = customerAccountBalance(branch);
  if (ownBalance === null || headquartersDue == null) return null;
  return (Math.max(0, Math.round(ownBalance * 100)) + Math.round(headquartersDue * 100)) / 100;
}

export function headquartersDueForBranch(balances, branchId) {
  return balances ? balances.get(branchId) ?? 0 : null;
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
