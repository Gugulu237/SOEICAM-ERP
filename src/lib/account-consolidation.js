// Reporting aliases preserve original journal/account IDs. Only reviewed COGS
// accounts may form a family; credits and reversals keep their original signs.
export function resolveAccountConsolidations(accounts) {
  const byId = new Map(accounts.map(account => [account.id, account]));
  const resolved = new Map();
  const canonicalId = id => {
    if (resolved.has(id)) return resolved.get(id);
    const seen = new Set(), path = [];
    let current = id;
    while (true) {
      if (seen.has(current)) throw Error('Account consolidation contains a cycle. Review the chart of accounts.');
      const account = byId.get(current);
      if (!account) throw Error('A consolidated account is missing from the chart of accounts.');
      seen.add(current);path.push(current);
      const target = account.consolidated_into_account_id;
      if (!target) break;
      const destination = byId.get(target);
      if (account.account_type !== 'cogs' || account.normal_balance !== 'debit' || !destination || destination.account_type !== 'cogs' || destination.normal_balance !== 'debit'
        || (account.currency || 'XAF') !== (destination.currency || 'XAF')) throw Error('Consolidated accounts must use the same COGS type, normal balance and currency.');
      current = target;
    }
    for (const member of path) resolved.set(member, current);
    return current;
  };
  for (const account of accounts) canonicalId(account.id);
  const families = new Map();
  for (const account of accounts) {
    const id = canonicalId(account.id), family = families.get(id) || [];
    family.push(account);families.set(id, family);
  }
  return { byId, canonicalId, members: id => families.get(canonicalId(id)) || [] };
}
