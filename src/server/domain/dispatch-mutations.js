import { requireActiveContext, forbidden } from '../access.js';
import { canManageDeliveries } from '../../lib/operations-access.js';

const dispatchDraftFields = new Set([
  'dispatch_number', 'dispatch_date', 'source', 'request_id', 'vehicle_id', 'vehicle_name',
  'driver_id', 'driver_name', 'salesperson_id', 'salesperson_name', 'route_id', 'route_name',
  'warehouse_id', 'warehouse_name', 'notes', 'status',
]);
const lineDraftFields = new Set(['dispatch_id', 'product_id', 'product_name', 'unit', 'requested_quantity', 'loaded_quantity', 'unit_price', 'notes']);
const removal = operation => ['delete', 'deleteMany'].includes(operation);
const creation = operation => ['create', 'bulkCreate'].includes(operation);
const allowFields = (payload, allowed) => {
  if (Object.keys(payload).some(key => !allowed.has(key))) throw forbidden('Use the checked dispatch workflow for approval, stock movements and recorded load values.');
};

// Generic record edits can prepare a draft. Approval, loading and returns run
// exclusively through fieldOps, which validates and moves stock atomically.
export async function guardDispatchMutation(context, entity, operation, payload, existing, stores) {
  if (!['Dispatch', 'DispatchLine'].includes(entity)) return;
  const role = requireActiveContext(context), manager = canManageDeliveries(role);
  if (entity === 'DispatchLine') {
    if (!removal(operation)) allowFields(payload, lineDraftFields);
    if (existing && Object.hasOwn(payload, 'dispatch_id') && payload.dispatch_id !== existing.dispatch_id) throw forbidden('A load-list row cannot be moved to a different dispatch.');
    const dispatchId = existing?.dispatch_id || payload.dispatch_id;
    if (typeof dispatchId !== 'string' || !dispatchId) throw forbidden('Choose an existing draft dispatch for this load-list row.');
    // Read the real parent inside the write transaction; a caller cannot claim
    // that a submitted or loaded manifest is still editable.
    const parent = await stores.Dispatch.get(dispatchId);
    if (!parent || parent.status !== 'draft') throw forbidden('Only a draft dispatch load list can be edited.');
    return;
  }
  if (creation(operation)) {
    allowFields(payload, dispatchDraftFields);
    if (payload.status !== undefined && payload.status !== 'draft') throw forbidden('Create a draft dispatch, then use the checked approval and loading workflow.');
    return;
  }
  if (!existing) throw forbidden('The dispatch could not be verified.');
  if (removal(operation)) {
    if (existing.status !== 'draft') throw forbidden('Only an unsubmitted draft dispatch can be deleted.');
    return;
  }
  const next = payload.status;
  if (next === 'cancelled') {
    if (!manager || !['draft', 'pending_approval', 'approved'].includes(existing.status) || existing.loaded_at || existing.loaded_by || Number(existing.total_loaded_value) > 0) throw forbidden('Only dispatch management can cancel an unloaded run. Return loaded stock through the checked workflow.');
    allowFields(payload, new Set(['status']));
    return;
  }
  if (existing.status === 'draft') {
    allowFields(payload, dispatchDraftFields);
    if (next !== undefined && !['draft', 'pending_approval'].includes(next)) throw forbidden('Submit the draft for approval before using the checked dispatch workflow.');
    return;
  }
  if (next === 'in_transit') throw forbidden('Departure must be reported by the assigned driver from their own workspace.');
  if (manager && existing.status === 'returned' && next === 'completed') {
    throw forbidden('Close the run through checked Distribution stock reconciliation.');
  }
  throw forbidden('The submitted dispatch is read-only. Use the checked dispatch workflow for approval, loading and stock returns.');
}
