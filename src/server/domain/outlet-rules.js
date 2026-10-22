export const AVAILABILITY = { available: 'Available', low_stock: 'Low stock', out_of_stock: 'Out of stock', not_stocked: 'Not carried here' };
export const OUTLET_ISSUES = { none: 'No concern', expiry: 'Expiry concern', damaged: 'Damaged packaging', pricing: 'Price discrepancy', cold_chain: 'Refrigeration concern' };
export function validateOutletDailyReport(body, location, employee, stock) {
  if (!location || location.is_active === false || !location.assigned_hotesse_ids?.includes(employee?.id)) throw new Error('This active outlet is not assigned to you');
  if (!/^[a-f0-9-]{36}$/i.test(body.requestKey || '')) throw new Error('Invalid report reference');
  if (stock.daily_report_submitted) throw new Error('A daily report has already been submitted for this outlet today. Refresh to view it.');
  if (!stock.products.length) throw new Error('No confirmed finished-product supplies are recorded for this outlet. Ask management to record its delivery first.');
  if (!Array.isArray(body.lines) || body.lines.length !== stock.products.length || body.lines.length > 50) throw new Error('Report sales and closing stock for every supplied product');
  const seen = new Set();
  const numeric = (value, label) => {
    if (value === '' || value == null || !['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e9) throw new Error('Enter a valid non-negative ' + label);
    return Math.round(Number(value) * 1000) / 1000;
  };
  const lines = body.lines.map(line => {
    const product = stock.products.find(row => row.id === line.product_id);
    if (!product || seen.has(product.id)) throw new Error('Use each supplied product once; products from other outlets are not permitted');
    seen.add(product.id);
    const sold = numeric(line.sold_quantity, 'sales quantity'), damaged = numeric(line.damaged_quantity, 'damaged quantity'), closing = numeric(line.quantity, 'closing stock count');
    if (sold + damaged > product.opening_quantity + 0.0005) throw new Error('Sold and damaged quantities exceed the available outlet stock for ' + product.name);
    const expected = Math.round((product.opening_quantity - sold - damaged) * 1000) / 1000;
    const price = line.observed_price === '' || line.observed_price == null ? null : numeric(line.observed_price, 'selling price');
    if (!Number.isSafeInteger(Math.round(sold * (price || 0) * 100))) throw new Error('The reported sales amount is too large');
    if (!Object.hasOwn(OUTLET_ISSUES, line.issue || 'none')) throw new Error('Choose a valid stock concern');
    return { product_id: product.id, product_name: product.name, image_url: product.image_url || '', unit: product.unit_of_measure || product.storage_unit || 'units',
      opening_quantity: product.opening_quantity, cumulative_supplied: product.cumulative_supplied,
      sold_quantity: sold, damaged_quantity: damaged, quantity: closing, expected_closing: expected,
      variance: Math.round((closing - expected) * 1000) / 1000,
      observed_price: price, sales_value: sold > 0 && price == null ? null : Math.round(sold * (price || 0) * 100) / 100,
      availability: closing === 0 ? 'out_of_stock' : 'available', issue: line.issue || 'none' };
  });
  const notes = String(body.notes || '').trim().slice(0, 2000);
  if (lines.some(line => line.variance !== 0 || line.issue !== 'none' || line.damaged_quantity > 0) && !notes) throw new Error('Explain stock differences, damage or other concerns in the report notes');
  const fileUris = body.fileUris || [];
  if (!Array.isArray(fileUris) || fileUris.length > 5 || fileUris.some(uri => typeof uri !== 'string' || !uri.startsWith('private/') || uri.length > 2000)) throw new Error('Attach up to five valid private photos');
  if (body.snapshotKey && body.snapshotKey !== stock.snapshot_key) throw new Error('New deliveries or shelf counts arrived while this report was open. Close it, refresh the outlet and review your quantities.');
  return { report_type: 'daily_sales', lines, notes, proof_file_uris: fileUris, informational_only: true,
    marketing_feedback: String(body.marketingFeedback || '').trim().slice(0, 2000),
    sales_total: lines.some(line => line.sales_value == null) ? null : Math.round(lines.reduce((sum, line) => sum + line.sales_value, 0) * 100) / 100,
    has_concerns: lines.some(line => line.variance !== 0 || line.damaged_quantity > 0 || line.issue !== 'none' || line.quantity === 0) };
}
export function validateDeliveryShelfCheck(body, location, employee, stock) {
  if (!location || location.is_active === false || !location.assigned_hotesse_ids?.includes(employee?.id)) throw new Error('This active outlet is not assigned to you');
  if (!/^[a-f0-9-]{36}$/i.test(body.requestKey || '')) throw new Error('Invalid report reference');
  const delivery = stock.deliveries.find(row => row.key === body.deliveryKey);
  if (!delivery) throw new Error('This confirmed delivery has changed or does not belong to this outlet. Refresh before counting.');
  if (delivery.shelf_check_id) throw new Error('This delivery already has a shelf count. Refresh to view it.');
  if (!body.snapshotKey || body.snapshotKey !== stock.snapshot_key) throw new Error('New deliveries or shelf counts arrived while this check was open. Close it, refresh the outlet and review your quantities.');
  const ids = [...new Set(delivery.lines.map(row => row.product_id))], seen = new Set();
  if (!Array.isArray(body.lines) || body.lines.length !== ids.length || body.lines.length > 50) throw new Error('Count every finished product in this delivery');
  const lines = body.lines.map(line => {
    const product = stock.products.find(row => row.id === line.product_id);
    if (!product || !ids.includes(product.id) || seen.has(product.id)) throw new Error('Count only the supplied products at this outlet, once each');
    seen.add(product.id);
    if (!['number', 'string'].includes(typeof line.quantity) || line.quantity === '' || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) < 0 || Number(line.quantity) > 1e9) throw new Error('Enter a valid non-negative shelf count for ' + product.name);
    if (!Object.hasOwn(OUTLET_ISSUES, line.issue || 'none')) throw new Error('Choose a valid stock concern');
    const quantity = Math.round(Number(line.quantity) * 1000) / 1000;
    return { product_id: product.id, product_name: product.name, image_url: product.image_url || '', unit: product.unit_of_measure || product.storage_unit || 'units',
      quantity, expected_closing: product.display_quantity, variance: Math.round((quantity - product.display_quantity) * 1000) / 1000,
      cumulative_supplied: product.cumulative_supplied, issue: line.issue || 'none', availability: quantity === 0 ? 'out_of_stock' : 'available',
      supplied_quantity: delivery.lines.filter(row => row.product_id === product.id).reduce((sum, row) => sum + row.quantity, 0),
      batches: delivery.lines.filter(row => row.product_id === product.id).map(row => ({ lot_number: row.lot_number, expiry_date: row.expiry_date, quantity: row.quantity })) };
  });
  const notes = String(body.notes || '').trim().slice(0, 2000);
  if (lines.some(line => line.variance > 0 || line.issue !== 'none') && !notes) throw new Error('Explain an unexpected surplus or concern in the notes');
  return { report_type: 'delivery_shelf_check', informational_only: true, delivery_key: delivery.key, delivery_number: delivery.document_number,
    delivery_date: delivery.date, delivery_lines: delivery.lines, lines, notes, proof_file_uris: [],
    marketing_feedback: String(body.marketingFeedback || '').trim().slice(0, 2000),
    has_concerns: lines.some(line => line.quantity === 0 || line.variance > 0 || line.issue !== 'none') };
}
export function validateOutletVisit(body, location, employee, products) {
  if (!location || location.is_active === false || !location.assigned_hotesse_ids?.includes(employee?.id)) throw new Error('This active outlet is not assigned to you');
  if (!/^[a-f0-9-]{36}$/i.test(body.requestKey || '')) throw new Error('Invalid report reference');
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 50) throw new Error('Check between 1 and 50 products');
  const seen = new Set();
  const lines = body.lines.map(line => {
    const product = products.find(p => p.id === line.product_id);
    if (!product || product.is_active === false || !['finished_product', 'assembly'].includes(product.inventory_type)) throw new Error('Choose an active finished product');
    if (seen.has(product.id)) throw new Error('Check each product only once');
    seen.add(product.id);
    if (!Object.hasOwn(AVAILABILITY, line.availability) || !Object.hasOwn(OUTLET_ISSUES, line.issue)) throw new Error('Choose a valid availability and concern');
    const number = (value) => {
      if (value === '' || value == null) return null;
      if (!['string', 'number'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e9) throw new Error('Shelf quantities and prices must be valid non-negative numbers');
      return Math.round(Number(value) * 1000) / 1000;
    };
    const quantity = number(line.quantity), observed_price = number(line.observed_price);
    if (['out_of_stock', 'not_stocked'].includes(line.availability) && quantity > 0) throw new Error('An unavailable product cannot have a positive shelf quantity');
    if (line.availability === 'available' && quantity === 0) throw new Error('Choose out of stock when the shelf quantity is zero');
    const expiry_date = String(line.expiry_date || '');
    if (expiry_date && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry_date) || !Number.isFinite(Date.parse(expiry_date)) || new Date(expiry_date).toISOString().slice(0, 10) !== expiry_date)) throw new Error('Enter a valid expiry date');
    return { product_id: product.id, product_name: product.name, unit: product.storage_unit || '', availability: line.availability, issue: line.issue, ...(quantity == null ? {} : { quantity }), ...(observed_price == null ? {} : { observed_price }), expiry_date };
  });
  const notes = String(body.notes || '').trim().slice(0, 2000);
  if (lines.some(line => line.issue !== 'none') && !notes) throw new Error('Describe the concerns so the team can follow up');
  const fileUris = body.fileUris || [];
  if (!Array.isArray(fileUris) || fileUris.length > 5 || fileUris.some(uri => typeof uri !== 'string' || !uri.startsWith('private/') || uri.length > 2000)) throw new Error('Attach up to five valid private photos');
  return { lines, notes, proof_file_uris: fileUris, has_concerns: lines.some(line => line.issue !== 'none' || ['low_stock', 'out_of_stock'].includes(line.availability)) };
}
