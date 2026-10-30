import {ui} from './i18n.js';
import { availableCustody, roundMoney } from './field-pos.js';
import { isFinishedProduct } from './product-images.js';

export const DRIVER_ACTIVITY_LABELS = {
  get stock_received(){return ui('Load receipt confirmed');}, get delivery_plan(){return ui('Delivery plan saved');},
  get trip_started(){return ui("Departed");}, get trip_returned(){return ui("Back at base");}, get delivery_completed(){return ui("Delivery reported complete");},
  get delivery_partial(){return ui("Partial delivery reported");}, get delivery_failed(){return ui("Delivery unsuccessful");}, get incident(){return ui("Incident reported");},
};
export const isDeliveryActivity = (activity) => activity.type?.startsWith('delivery_');
export function latestDeliveryReports(activities = []) {
  const latest = new Map();
  [...activities].sort((a, b) => (a.recorded_at || '').localeCompare(b.recorded_at || '') || (a.id || '').localeCompare(b.id || '')).forEach((a) => {
    if (isDeliveryActivity(a) && a.order_id) latest.set(a.order_id, a);
  });
  return latest;
}
export function commercialSnapshot(data) {
  const sales = data?.sales || [], date = data?.date || '', start = data?.monthStart || '';
  const approved = sales.filter((s) => s.status === 'approved_posted' && s.transaction_date >= start && s.transaction_date <= date);
  const customers = data?.customers || [];
  const monthlyCustomers = customers.filter(c => c.acquisition_date >= start && c.acquisition_date <= date);
  const verified = monthlyCustomers.filter(c => c.acquisition_verified === 'verified_unique').length;
  const acquiredIds = new Set(customers.map(c => c.id));
  const eligibleNet = roundMoney(approved.filter(s => acquiredIds.has(s.customer_id)).reduce((sum, s) => sum + Math.max(0, Number(s.subtotal) || 0), 0));
  const rate = data?.employee?.commission_rate_percent, bonus = data?.employee?.new_customer_bonus;
  const configured = typeof rate === 'number' || typeof bonus === 'number';
  const validRate = typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 0;
  const validBonus = typeof bonus === 'number' && Number.isFinite(bonus) && bonus >= 0 ? bonus : 0;
  return {
    today: roundMoney(approved.filter((s) => s.transaction_date === date).reduce((sum, s) => sum + Number(s.total || 0), 0)),
    month: roundMoney(approved.reduce((sum, s) => sum + Number(s.total || 0), 0)),
    cash: roundMoney((data?.cash || []).reduce((sum, c) => sum + Math.max(0, Number(c.outstanding_amount) || 0), 0)),
    registered: monthlyCustomers.length,
    verified,
    commission: { configured, rate: validRate, customerBonus: validBonus, eligibleNet, verified,
      salesEstimate: roundMoney(eligibleNet * validRate / 100), acquisitionEstimate: roundMoney(verified * validBonus),
      estimate: roundMoney(eligibleNet * validRate / 100 + verified * validBonus) },
    corrections: sales.filter((s) => s.status === 'returned'), drafts: sales.filter((s) => s.status === 'draft'),
    waiting: sales.filter((s) => ['submitted', 'under_review', 'posting_failed'].includes(s.status)),
    stock: (data?.products || []).filter((p) => p.is_active !== false && isFinishedProduct(p)).map((p) => ({ ...p, quantity: availableCustody(data.balances || [], p.id, date) })).filter((p) => p.quantity > 0),
  };
}
