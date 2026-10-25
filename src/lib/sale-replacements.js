const round = value => Math.round(Number(value) * 1000) / 1000;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// Shared by checkout and the authenticated server operation. These units are
// free, like-for-like exchanges; they must never enter the billed sale lines.
export function normalizeSaleReplacements(input, date) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 50) throw Error('Choose at most 50 stock replacements.');
  const keys = new Set();
  return input.map(row => {
    if (!row || typeof row.product_id !== 'string' || !row.product_id.trim()) throw Error('Choose the product being replaced.');
    if (!['number', 'string'].includes(typeof row.quantity) || !String(row.quantity).trim() || !Number.isFinite(Number(row.quantity)) || round(row.quantity) <= 0 || Number(row.quantity) > 1e9) throw Error('Enter the exact positive quantity being replaced.');
    if (!['expired', 'damaged'].includes(row.reason)) throw Error('Choose expired or damaged for each replacement.');
    const expiry = row.expiry_date || '';
    if ((expiry && !validDate(expiry)) || row.reason === 'expired' && (!validDate(expiry) || expiry >= date)) throw Error('For expired goods, enter the printed expiry date before the delivery date.');
    const lot = String(row.lot_number || '').trim().slice(0, 200);
    const key = JSON.stringify([row.product_id, row.reason, expiry, lot]);
    if (keys.has(key)) throw Error('Combine quantities for the same returned product and batch.');
    keys.add(key);
    return { product_id: row.product_id, quantity: round(row.quantity), reason: row.reason, expiry_date: expiry, lot_number: lot };
  });
}

export function combinedSupplyQuantities(lines, replacements) {
  const totals = new Map();
  for (const line of [...lines, ...replacements]) totals.set(line.product_id, round((totals.get(line.product_id) || 0) + Number(line.quantity)));
  return [...totals].map(([product_id, quantity]) => ({ product_id, quantity }));
}

export function validateSaleReplacements(form, stock) {
  try {
    const rows = normalizeSaleReplacements(form.stock_replacements, form.transaction_date);
    for (const line of combinedSupplyQuantities(form.lines, rows)) {
      const product = stock.find(row => (row.id || row.product_id) === line.product_id);
      if (!product || line.quantity > Number(product.quantity || 0)) return 'Sold units and free replacements exceed the available delivery stock.';
    }
    return '';
  } catch (error) { return error.message; }
}
