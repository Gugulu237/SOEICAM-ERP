// Account.balance is stored in its own normal direction. Contra-assets such
// as accumulated depreciation therefore subtract from the asset total.
export function reportBalance(account, direction = 'debit') {
  return (account.normal_balance === direction ? 1 : -1) * (Number(account.balance) || 0);
}
