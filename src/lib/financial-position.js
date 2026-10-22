const round = n => Math.round((Number(n) || 0) * 100) / 100;
const types = ['revenue', 'other_income', 'cogs', 'expense', 'other_expense'];
// Each account's own ledger amount is counted once; header rollups never enter
// the total again. Contra assets remain negative instead of inflating assets.
export function financialPosition(accounts = [], balances = {}) {
  const rows = type => accounts.filter(a => a.account_type === type).map(a => ({ id: a.id, account_number: a.account_number, name: a.name, is_active: a.is_active, amount: round((Number(balances[a.id]?.debit || 0) - Number(balances[a.id]?.credit || 0)) * (type === 'asset' ? 1 : -1)) })).sort((a,b) => String(a.account_number).localeCompare(String(b.account_number),undefined,{numeric:true}));
  const assets = rows('asset'), liabilities = rows('liability'), equity = rows('equity');
  const total = rows => round(rows.reduce((s,r) => s + r.amount,0));
  const earnings = round(accounts.filter(a => types.includes(a.account_type)).reduce((sum,a) => sum + Number(balances[a.id]?.credit || 0) - Number(balances[a.id]?.debit || 0),0));
  const totalAssets = total(assets), totalLiabilities = total(liabilities), recordedEquity = total(equity), totalEquity = round(recordedEquity + earnings), funding = round(totalLiabilities + totalEquity);
  const known = new Map(accounts.map(a => [a.id,a]));
  const unclassified = Object.entries(balances).filter(([id,b]) => (!known.has(id) || !['asset','liability','equity',...types].includes(known.get(id)?.account_type)) && round(Number(b.debit || 0)-Number(b.credit || 0)) !== 0).length;
  return { assets, liabilities, equity, earnings, totalAssets, totalLiabilities, recordedEquity, totalEquity, funding, difference: round(totalAssets - funding), unclassified };
}
