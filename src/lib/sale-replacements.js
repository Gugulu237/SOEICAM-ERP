const round = value => Math.round(Number(value) * 1000) / 1000;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const id = value => typeof value === 'string' && value.trim() && value.length <= 200;
const positiveQuantity = value => ['number', 'string'].includes(typeof value) && String(value).trim() && round(value) > 0 && round(value) === Number(value) && Number(value) <= 1e9;

// The returned product is independent of the free issue. Older field sales
// use the original like-for-like format.
export function normalizeSaleReplacements(input, date, {central = false} = {}) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 50) throw Error('Choose at most 50 stock replacements.');
  const keys = new Set();
  return input.map(row => {
    if (!row || !id(row.product_id)) throw Error('Choose the product being replaced.');
    if (!positiveQuantity(row.quantity)) throw Error('Enter the exact positive quantity being replaced.');
    if (!['expired', 'damaged'].includes(row.reason)) throw Error('Choose expired or damaged for each replacement.');
    const expiry = row.expiry_date || '';
    if ((expiry && !validDate(expiry)) || row.reason === 'expired' && (!validDate(expiry) || expiry >= date)) throw Error('For expired goods, enter the printed expiry date before the delivery date.');
    const lot = String(row.lot_number || '').trim().slice(0, 200);
    const key = JSON.stringify([row.product_id, row.reason, expiry, lot]);
    if (keys.has(key)) throw Error('Combine quantities for the same returned product and batch.');
    keys.add(key);
    const normalized = {product_id: row.product_id, quantity: round(row.quantity), reason: row.reason, expiry_date: expiry, lot_number: lot};
    if (!central) {
      if (row.replacement_product_id !== undefined || row.replacement_quantity !== undefined || row.recovered_packaging !== undefined) throw Error('Use the central exchange workflow for separately recorded returns and replacements.');
      return normalized;
    }
    const replacementId = row.replacement_product_id ?? row.product_id;
    const replacementQuantity = row.replacement_quantity ?? row.quantity;
    if (!id(replacementId) || !positiveQuantity(replacementQuantity)) throw Error('Choose the replacement product and its exact quantity.');
    const packaging = row.recovered_packaging ?? [];
    if (!Array.isArray(packaging) || packaging.length > 20) throw Error('Enter up to twenty recovered packaging items.');
    const seen = new Set();
    const recovered = packaging.map(component => {
      if (!id(component?.product_id) || seen.has(component.product_id) || !positiveQuantity(component.quantity) || !['salvage','reuse_review'].includes(component.disposition)) throw Error('Choose each recovered packaging item once and enter its physical quantity and intended use.');
      seen.add(component.product_id);
      return {product_id: component.product_id, quantity: round(component.quantity), disposition: component.disposition};
    });
    return {...normalized, replacement_product_id: replacementId, replacement_quantity: round(replacementQuantity), recovered_packaging: recovered};
  });
}

export function validateReplacementDeclaration(answer,rows,required=true){
  if(required&&typeof answer!=='boolean')return 'Please answer whether spoiled goods were replaced during this supply.';
  if(answer===true&&!rows.length)return 'Add the products and quantities replaced.';
  if(answer===false&&rows.length)return 'Choose Yes for the replacement products, or remove them.';
  return '';
}

export function combinedSupplyQuantities(lines, replacements) {
  const totals = new Map();
  for (const line of [...lines, ...replacements]) {
    const product = line.replacement_product_id ?? line.product_id;
    totals.set(product, round((totals.get(product) || 0) + Number(line.replacement_quantity ?? line.quantity)));
  }
  return [...totals].map(([product_id, quantity]) => ({ product_id, quantity }));
}

export function validateSaleReplacements(form, stock, options) {
  try {
    const rows = normalizeSaleReplacements(form.stock_replacements, form.transaction_date, options);
    if (options?.central) for (const line of combinedSupplyQuantities([], rows)) {
      const product = stock.find(row => (row.id || row.product_id) === line.product_id);
      if (!product || line.quantity > Number(product.replacement_available || 0)) return 'Insufficient finished goods inventory in the central warehouse to complete this exchange.';
    }
    for (const line of combinedSupplyQuantities(form.lines, rows)) {
      const product = stock.find(row => (row.id || row.product_id) === line.product_id);
      if (!product || line.quantity > Number(product.quantity || 0)) return 'Sold units and free replacements exceed the available delivery stock.';
    }
    return '';
  } catch (error) { return error.message; }
}
