export const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
export const roundQuantity = (value) => Math.round((Number(value) || 0) * 1000) / 1000;

// Avoid a partial custody balance or customer list when the SDK returns cursor pages.
export async function readAll(entity, query = {}, sort = 'name') {
  const items = [];
  const seen = new Set();
  let cursor;
  do {
    const page = await entity.filter(query, { sort, limit: 200, include_total: false, ...(cursor ? { cursor } : {}) });
    if (Array.isArray(page)) return page;
    if (!Array.isArray(page?.items)) throw new Error('The records could not be loaded. Please retry.');
    items.push(...page.items);
    cursor = page.has_more === false ? null : page.next_cursor;
    if (page.has_more && !cursor) throw new Error('Some records could not be loaded. Please retry.');
    if (cursor && seen.has(cursor)) throw new Error('The records could not be fully loaded. Please retry.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

export function availableCustody(balances, productId, today = new Date().toISOString().slice(0, 10)) {
  return roundQuantity(balances.filter((b) => b.product_id === productId && Number(b.quantity) > 0
    && (b.qc_status || 'approved') === 'approved' && (!b.expiry_date || b.expiry_date >= today))
    .reduce((sum, b) => sum + Math.max(0, Number(b.usable_quantity ?? b.quantity)), 0));
}
export const saleIsLocked = (sale) => Boolean(sale && (sale.stock_moved_at || !['draft', 'returned'].includes(sale.status)));

export function saleTotals(lines, stock) {
  let subtotal = 0;
  let tax = 0;
  for (const line of lines) {
    const product = stock.find((s) => s.product_id === line.product_id);
    const amount = roundMoney(roundQuantity(line.quantity) * roundMoney(line.unit_price));
    subtotal = roundMoney(subtotal + amount);
    tax = roundMoney(tax + roundMoney(amount * (Number(product?.tax_rate ?? line.tax_rate) || 0) / 100));
  }
  return { subtotal, tax, total: roundMoney(subtotal + tax) };
}

export function validateSale(form, stock, { isAdmin = false, submit = false } = {}) {
  if (!form.customer_id) return 'Choose a customer for this sale.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.transaction_date || '')) return 'Choose a transaction date.';
  if (!form.lines.length) return 'Tap a product to add it to your sale.';
  const seen = new Set();
  for (const line of form.lines) {
    const product = stock.find((s) => s.product_id === line.product_id);
    if (!product || product.is_active === false) return 'A product is no longer available. Remove it from the cart.';
    if (seen.has(line.product_id)) return 'Combine duplicate products into a single cart line.';
    seen.add(line.product_id);
    if (!Number.isFinite(Number(line.quantity)) || roundQuantity(line.quantity) <= 0) return `Enter a quantity for ${product.name}.`;
    if (roundQuantity(line.quantity) > product.quantity) return `Only ${product.quantity} available for ${product.name}.`;
    if (!Number.isFinite(Number(line.unit_price)) || roundMoney(line.unit_price) <= 0) return `Enter a valid price for ${product.name}.`;
    if (!isAdmin && roundMoney(line.unit_price) < roundMoney(product.selling_price)) return `The price for ${product.name} is below its authorized selling price.`;
  }
  const { total } = saleTotals(form.lines, stock);
  if (submit && !['cash', 'credit'].includes(form.payment_type)) return 'Choose whether cash was collected or this supply is on credit.';
  if (submit && form.payment_type === 'cash' && (form.amount_collected === '' || form.amount_collected == null)) return 'Enter the exact cash collected.';
  if (form.payment_type === 'cash' && form.amount_collected !== '') {
    const amount = Number(form.amount_collected);
    if (!Number.isFinite(amount) || amount < 0 || roundMoney(amount) > total) return 'Cash collected must be between zero and the sale total.';
    if (submit && roundMoney(amount) <= 0) return 'Choose credit when no cash was collected.';
  }
  if (form.payment_type === 'credit' && Number(form.amount_collected || 0) !== 0) return 'Choose cash to report money collected, or zero cash for a credit supply.';
  if (form.payment_type === 'credit' && form.payment_terms_days !== '' && (!Number.isInteger(Number(form.payment_terms_days)) || Number(form.payment_terms_days) < 0)) return 'Payment terms must be a whole number of days, zero or greater.';
  if (submit && !form.receipt_reference.trim()) return 'Add the receipt reference before submitting.';
  if (submit && !form.receipt_file_uris.length) return 'Attach a clear supply receipt photo before recording the sale.';
  return '';
}
