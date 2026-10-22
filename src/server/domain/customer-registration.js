import { createHash } from 'node:crypto';
import { requireStaff, audit } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { normalizedPhone } from './commercial-rules.js';
import { prepareDeliveryDefinition } from './customer-delivery.js';
import { effectiveRole } from './roles.js';
import { businessDate } from '../../lib/business-date.js';

export const CUSTOMER_REGISTRATION_ACTIONS = ['customerAcquisitionOptions', 'registerManagedCustomer'];
const textLimits = { business_name: 200, phone: 40, contact_person: 200, whatsapp: 40, email: 200, category: 40,
  financial_centralization_mode: 40, parent_id: 100, address: 500, town: 200, neighbourhood: 200, notes: 2000,
  delivery_zone_id: 100, delivery_days: 100, delivery_instructions: 2000, gps_captured_at: 100 };
const numbers = ['credit_limit', 'max_overdue_days', 'payment_terms_days'];
const gps = ['gps_lat', 'gps_lng', 'gps_accuracy_m'];
const allowed = new Set([...Object.keys(textLimits), ...numbers, ...gps, 'is_active']);
const eligible = employee => employee?.status === 'active' && effectiveRole({ role: 'user' }, employee) === 'commercial';

function customerInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.has(key))) throw Error('Use the customer form; acquisition, registration and financial balances are managed by the server.');
  const data = {};
  for (const [key, max] of Object.entries(textLimits)) {
    if (input[key] != null && (typeof input[key] !== 'string' || input[key].length > max)) throw Error('Enter a valid customer field: ' + key);
    data[key] = (input[key] || '').trim();
  }
  if (!data.business_name) throw Error('Business name is required');
  if (data.phone && normalizedPhone(data.phone).length < 7) throw Error('Enter a valid contact phone number');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw Error('Enter a valid customer email address');
  data.category ||= 'shop';
  data.financial_centralization_mode ||= 'centralized';
  if (!['supermarket', 'minimarket', 'wholesaler', 'shop', 'cash_customer', 'institutional'].includes(data.category)
    || !['centralized', 'decentralized'].includes(data.financial_centralization_mode)) throw Error('Choose an available customer category and payment organization');
  for (const key of numbers) {
    const value = input[key] ?? (key === 'max_overdue_days' ? 30 : 0);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12 || key !== 'credit_limit' && (!Number.isInteger(value) || value > 3650)) throw Error('Enter a valid non-negative customer limit or payment term');
    data[key] = value;
  }
  for (const key of gps) if (input[key] != null && input[key] !== '') data[key] = input[key];
  if (input.is_active != null && typeof input.is_active !== 'boolean') throw Error('Choose a valid customer active status');
  data.is_active = input.is_active !== false;
  return data;
}

// Management registration is its own operation. Selecting an acquisition
// beneficiary never substitutes that employee for the authenticated registrar.
export async function customerRegistrationAction(client, user, body) {
  const actor = await requireStaff(client, user, ['admin'], 'management customer registration');
  if (actor.employee?.status && actor.employee.status !== 'active') throw Error('An active administrator account is required');
  client.auth.assertModule?.('customers');
  const svc = client.asServiceRole, stores = svc.entities;
  if (body.action === 'customerAcquisitionOptions') {
    const staff = await readRecords(stores.Employee, { status: 'active' });
    return { employees: staff.filter(eligible).map(row => ({ id: row.id, full_name: row.full_name }))
      .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name))) };
  }
  if (body.action !== 'registerManagedCustomer') throw Error('Unknown customer registration action');
  if (Object.keys(body).some(key => !['action', 'requestKey', 'customer', 'acquiredById'].includes(key))) throw Error('Unexpected customer registration fields');
  if (typeof body.requestKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestKey)) throw Error('Invalid registration request; reopen the form');
  if (body.acquiredById != null && typeof body.acquiredById !== 'string') throw Error('Choose an active Commercial employee');
  const acquiredById = (body.acquiredById || '').trim(), data = customerInput(body.customer);
  const hash = createHash('sha256').update(JSON.stringify([acquiredById, data])).digest('hex');
  const prior = await readRecords(stores.Customer, { registration_request_key: body.requestKey });
  if (prior.length) {
    if (prior.length !== 1 || prior[0].registration_request_hash !== hash || prior[0].registered_by_id !== user.id) throw Error('This registration reference was already used for different details or another administrator');
    return { customer: prior[0], reused: true };
  }
  const agent = acquiredById ? await stores.Employee.get(acquiredById) : null;
  if (acquiredById && !eligible(agent)) throw Error('Choose an active Commercial employee');
  if (agent && !data.phone) throw Error('Enter a valid contact phone number for an acquired customer');
  const parent = data.parent_id ? await stores.Customer.get(data.parent_id) : null;
  if (data.parent_id && (!parent || parent.is_active === false || parent.parent_id)) throw Error('Choose an active main partner for this branch');
  const customers = await readRecords(stores.Customer), phone = normalizedPhone(data.phone);
  const sameName = row => String(row.business_name || '').trim().toLocaleLowerCase() === data.business_name.toLocaleLowerCase();
  if (customers.some(row => sameName(row) && (!phone || normalizedPhone(row.phone) === phone))) throw Error('This customer name and phone are already registered. Select the existing customer.');
  const sharedPhone = !!phone && customers.some(row => normalizedPhone(row.phone) === phone);
  const now = new Date().toISOString();
  const notes = [sharedPhone ? 'Shared phone number: check for an existing customer before verifying.' : '',
    parent && agent ? 'Branch of an existing partner: verify a distinct acquisition before awarding a bonus.' : ''].filter(Boolean).join(' ');
  const definition = await prepareDeliveryDefinition(stores, { ...data, parent_name: parent?.business_name || '',
    balance: 0, credit_status: 'good', registered_by_id: user.id, registered_by_name: user.full_name || user.email || 'General Manager', registered_at: now,
    acquisition_source: 'management_entry', ...(agent ? { acquired_by_id: agent.id, acquired_by_name: agent.full_name, salesperson_id: agent.id,
      acquisition_date: businessDate(new Date(now)), acquisition_verified: 'pending', acquisition_notes: notes } : {}) }, null, { user });
  const settings = (await readRecords(stores.CompanySettings))[0];
  if (!settings) throw Error('Company settings are not configured');
  const highest = customers.reduce((max, row) => Math.max(max, /^C-\d+$/.test(row.customer_number || '') ? Number(row.customer_number.slice(2)) : 0), 0);
  const next = Math.max(Number(settings.next_customer_number) || 1, highest + 1);
  if (!Number.isSafeInteger(next) || next < 1 || next >= Number.MAX_SAFE_INTEGER) throw Error('Customer numbering needs administrator review');
  await stores.CompanySettings.update(settings.id, { next_customer_number: next + 1 });
  const customer = await stores.Customer.create({ ...definition, customer_number: 'C-' + String(next).padStart(4, '0'),
    registration_request_key: body.requestKey, registration_request_hash: hash });
  await audit(svc, { action: 'register_management_customer', module: 'customers', entityType: 'Customer', entityId: customer.id, userId: user.id,
    description: `Registered ${customer.customer_number} / ${customer.business_name}; acquisition credited to ${agent ? agent.full_name + ' (' + agent.id + ')' : 'no employee'}; bonuses require acquisition verification` });
  return { customer };
}
