import { createHash } from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const requestFingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const number = (value, decimals) => Math.round(Number(value) * 10 ** decimals) / 10 ** decimals;

// Bind retry identity to business data, excluding transient form IDs and any
// client-provided warehouse, actor, total, tax or accounting fields.
export function supplyRequestFingerprint(body, sale, lines) {
  return requestFingerprint({
    dispatch: body.dispatchId || sale.dispatch_id || '', customer: body.customerId,
    location: body.locationId || '', date: body.transactionDate || sale.transaction_date,
    payment: body.paymentType || null, cash: number(body.amountCollected || 0, 2),
    collectionDate: Number(body.amountCollected) > 0 ? body.collectionDate || body.transactionDate || sale.transaction_date : '',
    terms: body.paymentTermsDays === '' || body.paymentTermsDays == null ? sale.payment_terms_days : Number(body.paymentTermsDays),
    reference: String(body.receiptReference || '').trim(), photos: [...(body.receiptFileUris || [])].filter(Boolean).sort(),
    notes: body.notes || '', override: body.creditOverrideReason || '',
    replacements: body.stockReplacements || [],
    lines: (body.lines || []).map(line => ({ product: line.product_id, quantity: number(line.quantity, 3),
      price: line.unit_price === '' || line.unit_price == null ? Number(lines.find(saved => saved.product_id === line.product_id)?.unit_price) : number(line.unit_price, 2),
    })).sort((a, b) => String(a.product).localeCompare(String(b.product))),
  });
}

export function registrationFingerprint(data, input) {
  const fields = ['business_name', 'phone', 'contact_person', 'whatsapp', 'address', 'town', 'neighbourhood', 'category',
    'gps_lat', 'gps_lng', 'gps_accuracy_m', 'gps_captured_at', 'delivery_instructions'];
  return requestFingerprint({ ...Object.fromEntries(fields.map(key => [key, data[key] ?? ''])),
    parent_id: input.parent_id || '', delivery_zone_id: input.delivery_zone_id || '', delivery_days: input.delivery_days || '' });
}
