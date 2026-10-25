import { createHash } from 'node:crypto';
import { readRecords } from './commercial-workspace.js';

const fail = (message, status = 400) => Object.assign(Error(message), { status });
export const customerRemoved = customer => Boolean(customer?.customer_removed_at);

// A directory deletion is reversible. Referenced customer IDs, acquisition
// evidence, journals, receipts and sales are never physically deleted.
export async function customerLifecycle(context, stores, customerId, input) {
  if (context.role !== 'admin' || context.employee?.status && context.employee.status !== 'active') throw fail('Only the General Manager can delete or restore customers.', 403);
  if (!input || !['remove', 'restore'].includes(input.action) || !Number.isSafeInteger(input.revision) || input.revision < 0 || !/^[a-f0-9-]{36}$/i.test(input.requestKey || '')) throw fail('Refresh the customer before changing its directory status.');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 3 || reason.length > 1000) throw fail('Enter a reason of 3 to 1000 characters.');
  const customer = await stores.Customer.get(customerId);
  if (!customer) throw fail('Customer not found.', 404);
  const payload = JSON.stringify({ customerId, action: input.action, revision: input.revision, reason });
  const id = 'customer-lifecycle-' + createHash('sha256').update(context.user.id + ':' + input.requestKey).digest('hex');
  const previous = await stores.AuditLog.get(id);
  if (previous) {
    if (previous.customer_lifecycle_payload !== payload) throw fail('This confirmation was already used for different customer changes.', 409);
    return { customer: await stores.Customer.get(customerId), reused: true };
  }
  if (Number(customer.customer_lifecycle_revision || 0) !== input.revision) throw fail('This customer changed. Refresh before continuing.', 409);
  const removed = customerRemoved(customer);
  if (input.action === 'remove' ? removed : !removed) throw fail(input.action === 'remove' ? 'This customer is already deleted.' : 'This customer is already in the directory.', 409);
  const locations = await readRecords(stores.CustomerLocation, { customer_id: customerId });
  if (input.action === 'remove') {
    const [children, invoices, orders, sales] = await Promise.all([
      readRecords(stores.Customer, { parent_id: customerId }),
      readRecords(stores.Invoice, { customer_id: customerId }),
      readRecords(stores.SalesOrder, { customer_id: customerId }),
      readRecords(stores.FieldSale, { customer_id: customerId }),
    ]);
    if (!Number.isFinite(Number(customer.balance || 0)) || Math.abs(Number(customer.balance || 0)) >= 0.005 || invoices.some(row => !['cancelled', 'void', 'draft'].includes(row.status) && Number(row.balance || 0) > 0)) throw fail('Settle this customer’s outstanding balance before deletion.');
    if (children.some(row => !customerRemoved(row))) throw fail('Remove or reassign this customer’s branches before deletion.');
    if (orders.some(row => !['cancelled', 'closed', 'invoiced'].includes(row.status)) || invoices.some(row => ['draft', 'pending', 'confirmed'].includes(row.status)) || sales.some(row => ['draft', 'returned', 'submitted', 'under_review', 'posting_failed'].includes(row.status))) throw fail('Complete or cancel this customer’s open sales documents before deletion.');
  }
  const at = new Date().toISOString();
  const activeLocationIds = input.action === 'remove' ? locations.filter(row => row.is_active !== false).map(row => row.id) : customer.customer_removed_location_ids || [];
  for (const location of locations.filter(row => activeLocationIds.includes(row.id))) await stores.CustomerLocation.update(location.id, { is_active: input.action === 'restore' });
  const change = input.action === 'remove'
    ? { is_active: false, customer_removed_at: at, customer_removed_by: context.user.id, customer_removal_reason: reason, customer_removed_was_active: customer.is_active !== false, customer_removed_location_ids: activeLocationIds }
    : { is_active: customer.customer_removed_was_active === true, customer_removed_at: null, customer_removed_by: null, customer_removal_reason: null, customer_restored_at: at, customer_restored_by: context.user.id };
  const saved = await stores.Customer.update(customerId, { ...change, customer_lifecycle_revision: input.revision + 1 });
  await stores.AuditLog.create({ id, action: input.action === 'remove' ? 'remove_customer' : 'restore_customer', module: 'customers', entity_type: 'Customer', entity_id: customerId,
    user_id: context.user.id, user_name: context.employee?.full_name || context.user.full_name || context.user.id, reason,
    description: `${input.action === 'remove' ? 'Deleted from directory' : 'Restored'} customer ${customer.business_name}`,
    customer_lifecycle_payload: payload, customer_lifecycle_before: { is_active: customer.is_active, removed_at: customer.customer_removed_at || null },
    customer_lifecycle_after: { is_active: saved.is_active, removed_at: saved.customer_removed_at || null } });
  return { customer: saved };
}
