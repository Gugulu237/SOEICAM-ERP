// Pure rules shared by the field handler and its offline checks.
import { businessDate } from '../../lib/business-date.js';
import { canViewAllCommercialReports } from '../../lib/operations-access.js';
export const finishedProduct = (p) => ['assembly', 'finished_product'].includes(p?.inventory_type);
const quantity = (n) => Math.round(Number(n) * 1000) / 1000;
const money = (n) => Math.round(Number(n || 0) * 100) / 100;

export function validateCustodyLines(lines, products, balances, issuing, date) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('Choose at least one finished product');
  const seen = new Set();
  return lines.map((line) => {
    const product = products.find((p) => p.id === line.product_id);
    if (!finishedProduct(product)) throw new Error('Commercial custody accepts only finished products and assemblies');
    if (issuing && product.is_active === false) throw new Error(`${product.name} is inactive`);
    if (seen.has(product.id)) throw new Error('Combine duplicate products into one line');
    seen.add(product.id);
    const qty = quantity(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Enter a positive quantity for ${product.name}`);
    const available = quantity(balances.filter((b) => b.product_id === product.id && Number(b.quantity) > 0
      && (!issuing || ((b.qc_status || 'approved') === 'approved' && (!b.expiry_date || b.expiry_date >= date))))
      .reduce((sum, b) => sum + Number(b.quantity), 0));
    if (qty > available) throw new Error(`Only ${available} available for ${product.name}`);
    return { product, quantity: qty };
  });
}

export function validCoordinates(value) {
  return typeof value?.gps_lat === 'number' && Number.isFinite(value.gps_lat) && Math.abs(value.gps_lat) <= 90
    && typeof value?.gps_lng === 'number' && Number.isFinite(value.gps_lng) && Math.abs(value.gps_lng) <= 180;
}

export function registrationData(input, employee, userId, now) {
  const text = (key, max = 200) => String(input[key] || '').trim().slice(0, max);
  if (!text('business_name')) throw new Error('Enter the customer or business name');
  const phone = text('phone', 40);
  if (phone.replace(/\D/g, '').length < 7) throw new Error('Enter a valid contact phone number');
  const gps = customerGpsData(input);
  const categories = ['supermarket', 'minimarket', 'wholesaler', 'shop', 'cash_customer', 'institutional'];
  return {
    business_name: text('business_name'), phone, contact_person: text('contact_person'),
    whatsapp: text('whatsapp', 40), address: text('address', 500), town: text('town'), neighbourhood: text('neighbourhood'),
    category: categories.includes(input.category) ? input.category : 'shop',
    ...gps, delivery_instructions: text('delivery_instructions', 1000),
    acquired_by_id: employee.id, acquired_by_name: employee.full_name, salesperson_id: employee.id,
    acquisition_date: businessDate(new Date(now)), acquisition_source: 'field_registration', acquisition_verified: 'pending',
    registered_by_id: userId, registered_by_name: employee.full_name, registered_at: now, is_active: true,
    credit_limit: 0, payment_terms_days: 0, balance: 0, credit_status: 'good',
  };
}

export const normalizedPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '').replace(/^00/, '');
  return digits.length === 9 ? `237${digits}` : digits;
};

export function customerGpsData(input) {
  if (!validCoordinates(input) || !Number.isFinite(input.gps_accuracy_m) || input.gps_accuracy_m < 0
    || !input.gps_captured_at || !Number.isFinite(Date.parse(input.gps_captured_at))) throw new Error('Capture the customer delivery location before saving');
  return { gps_lat: input.gps_lat, gps_lng: input.gps_lng, gps_accuracy_m: input.gps_accuracy_m, gps_captured_at: new Date(input.gps_captured_at).toISOString() };
}

export function reportScope(role, employee, requested) {
  if (canViewAllCommercialReports(role,employee)) return requested || '';
  if (role !== 'commercial' || !employee || (requested && requested !== employee.id)) throw new Error('You may view only your own commercial activity');
  return employee.id;
}

export function periodDates(from, to) {
  const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && Number.isFinite(Date.parse(`${s}T00:00:00Z`))
    && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  if (!valid(from) || !valid(to) || from > to) throw new Error('Choose a valid start and end date');
  return { from, to };
}

export function commercialReport({ agents, customers, sales, lines, from, to }) {
  const inPeriod = (date) => date && date.slice(0, 10) >= from && date.slice(0, 10) <= to;
  const approved = sales.filter((s) => s.status === 'approved_posted' && inPeriod(s.transaction_date));
  const saleMap = new Map(approved.map((s) => [s.id, s]));
  const registered = customers.filter((c) => c.acquired_by_id && inPeriod(c.acquisition_date || c.registered_at));
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const supplies = new Map();
  const summary = new Map(agents.map((a) => [a.id, { ...a, registered: 0, verified: 0, pending: 0, deliveries: 0, net: 0, total: 0, customers_supplied: 0 }]));
  const getAgent = (id, name) => {
    if (!summary.has(id)) summary.set(id, { id, full_name: name || 'Former commercial', registered: 0, verified: 0, pending: 0, deliveries: 0, net: 0, total: 0, customers_supplied: 0 });
    return summary.get(id);
  };
  for (const c of registered) {
    const agent = getAgent(c.acquired_by_id, c.acquired_by_name);
    agent.registered++;
    if (c.acquisition_verified === 'verified_unique') agent.verified++;
    if (!c.acquisition_verified || c.acquisition_verified === 'pending') agent.pending++;
  }
  for (const sale of approved) {
    const agent = getAgent(sale.commercial_id, sale.commercial_name);
    agent.deliveries++; agent.net = money(agent.net + Number(sale.subtotal || 0)); agent.total = money(agent.total + Number(sale.total || 0));
    const key = `${sale.commercial_id}:${sale.customer_id}`;
    if (!supplies.has(key)) {
      agent.customers_supplied++;
      supplies.set(key, { commercial_id: sale.commercial_id, commercial_name: sale.commercial_name,
        customer_id: sale.customer_id, customer_name: sale.customer_name, customer: customerMap.get(sale.customer_id),
        deliveries: 0, net: 0, total: 0, products: [] });
    }
    const row = supplies.get(key);
    row.deliveries++; row.net = money(row.net + Number(sale.subtotal || 0)); row.total = money(row.total + Number(sale.total || 0));
  }
  for (const line of lines) {
    const sale = saleMap.get(line.field_sale_id);
    if (!sale) continue;
    const row = supplies.get(`${sale.commercial_id}:${sale.customer_id}`);
    let product = row.products.find((p) => p.product_id === line.product_id && p.unit === line.unit);
    if (!product) { product = { product_id: line.product_id, name: line.product_name, unit: line.unit, quantity: 0 }; row.products.push(product); }
    product.quantity = quantity(product.quantity + Number(line.quantity || 0));
  }
  return { agents: [...summary.values()], registrations: registered, supplies: [...supplies.values()] };
}
