import { ITEM_ACCOUNT_FIELDS, availableItemAccount } from './item-accounts.js';
const money = value => Math.round(Number(value) * 100) / 100;
const reference = account => ({ account_id: account.id || account.account_id, account_number: account.account_number || '', account_name: account.name || account.account_name || '' });

async function postingContext(stores, fallback) {
  const products = new Map(), accounts = new Map();
  return {
    product: async id => {
      if (!products.has(id)) products.set(id, await stores.Product.get(id));
      if (!products.get(id)) throw new Error('A document item is no longer registered');
      return products.get(id);
    },
    account: async (product, field) => {
      const id = product[field];
      if (!id) return reference(await fallback(field, product));
      if (!accounts.has(id)) accounts.set(id, await stores.Account.get(id));
      const account = accounts.get(id), definition = ITEM_ACCOUNT_FIELDS.find(value => value.field === field);
      if (!availableItemAccount(account, definition.types)) throw new Error('Review the ' + definition.label + ' for ' + product.name);
      return reference(account);
    },
  };
}
function grouped() {
  const groups = new Map();
  return {
    add(account, side, amount, description) {
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid item posting amount');
      if (!amount) return;
      if (!account.account_id) throw new Error('A required posting account is missing');
      const key = account.account_id + ':' + side, row = groups.get(key) || { ...account, debit: 0, credit: 0, description };
      row[side] = money(row[side] + amount); groups.set(key, row);
    },
    lines: () => [...groups.values()],
  };
}
export async function saleItemPostings(stores, lines, { netTotal, costTotal, fallback }) {
  const context = await postingContext(stores, fallback), plan = grouped();
  let net = 0, cost = 0;
  for (const line of lines) {
    const product = await context.product(line.product_id);
    const revenue = money(Number(line.line_total ?? line.total) - Number(line.tax_amount || 0));
    const cogs = money(line.line_cost ?? line.cogs_total ?? Number(line.unit_cost || 0) * Number(line.quantity));
    if (!Number.isFinite(revenue) || !Number.isFinite(cogs) || revenue < 0 || cogs < 0) throw new Error('Review the item amounts before posting');
    net = money(net + revenue); cost = money(cost + cogs);
    if (revenue) plan.add(await context.account(product, 'revenue_account_id'), 'credit', revenue, 'Sales revenue');
    if (cogs) {
      plan.add(await context.account(product, 'cogs_account_id'), 'debit', cogs, 'Cost of goods sold');
      plan.add(await context.account(product, 'inventory_account_id'), 'credit', cogs, 'Inventory released');
    }
  }
  if (net !== money(netTotal) || cost !== money(costTotal)) throw new Error('Document totals do not match the item revenue and costs; review the lines before posting');
  return plan.lines();
}
export async function purchaseItemPostings(stores, lines, { total, fallback }) {
  const context = await postingContext(stores, fallback), plan = grouped();
  let value = 0;
  for (const line of lines) {
    const product = await context.product(line.product_id), amount = money(line.total);
    value = money(value + amount);
    plan.add(await context.account(product, 'inventory_account_id'), 'debit', amount, 'Goods received');
  }
  if (value !== money(total)) throw new Error('Purchase total does not match the item lines; review the purchase order before billing');
  return plan.lines();
}
