// Shared schedule math for previews and server posting. Money is rounded only
// at period boundaries so the final charge always reaches residual value.
const money = value => Math.round(Number(value) * 100) / 100;
export function assetMoney(value, label = 'amount') {
  if (!['number','string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e12) throw Error(`Enter a valid non-negative ${label}`);
  return money(value);
}
export function assetMonths(value) {
  if (!['number','string'].includes(typeof value)) throw Error('Enter the useful life in months');
  const months = Number(value);
  if (!Number.isInteger(months) || months < 1 || months > 1200) throw Error('Useful life must be a whole number from 1 to 1,200 months');
  return months;
}
export function assetDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value + 'T12:00:00Z')) || new Date(value + 'T12:00:00Z').toISOString().slice(0,10) !== value) throw Error('Enter a valid date');
  return value;
}
export function monthIndex(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') || Number(month.slice(0,4)) < 1900 || Number(month.slice(0,4)) > 9998) throw Error('Choose a valid month');
  return Number(month.slice(0,4)) * 12 + Number(month.slice(5)) - 1;
}
export function shiftMonth(month, count) {
  const index = monthIndex(month) + count;
  return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2,'0')}`;
}
export function monthEnd(month) {
  monthIndex(month);
  return new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5)), 0)).toISOString().slice(0,10);
}
export function depreciationPlan(asset) {
  const cost = assetMoney(asset.acquisition_cost, 'cost'), salvage = assetMoney(asset.salvage_value ?? 0, 'residual value');
  const accumulated = assetMoney(asset.accumulated_depreciation ?? 0, 'accumulated depreciation');
  if (salvage > cost || accumulated > money(cost - salvage)) throw Error(`${asset.name || 'Asset'} has an inconsistent residual value or accumulated depreciation`);
  const originalStart = assetDate(asset.in_service_date || asset.acquisition_date).slice(0,7);
  const nextMonth = asset.last_depreciation_date ? shiftMonth(assetDate(asset.last_depreciation_date).slice(0,7),1) : originalStart;
  if (asset.depreciation_plan) {
    const plan = asset.depreciation_plan;
    monthIndex(plan.start);
    return { ...plan, months: assetMonths(plan.months), basis: assetMoney(plan.basis), opening: assetMoney(plan.opening), nextMonth };
  }
  // Adopt an imported schedule prospectively; never backfill or rewrite its
  // recorded opening depreciation. Remaining historic months are retained.
  const elapsed = Math.max(0,monthIndex(nextMonth)-monthIndex(originalStart));
  return { start:nextMonth, months:Math.max(1,assetMonths(asset.useful_life_months)-elapsed), basis:money(cost-salvage-accumulated), opening:accumulated, nextMonth };
}
export function monthlyDepreciation(asset) {
  if (asset.depreciation_method !== 'straight_line' || ['fully_depreciated','disposed','written_off'].includes(asset.status)) return 0;
  try { const plan = depreciationPlan(asset); return money(plan.basis / plan.months); } catch { return 0; }
}
export const remainingDepreciable = asset => Math.max(0,money(Number(asset.acquisition_cost)-Number(asset.salvage_value || 0)-Number(asset.accumulated_depreciation || 0)));
export function scheduleThrough(asset, throughMonth) {
  monthIndex(throughMonth);
  if (asset.status !== 'active' || asset.depreciation_method !== 'straight_line') return [];
  const plan = depreciationPlan(asset), from = monthIndex(plan.nextMonth), start = monthIndex(plan.start);
  if (from < start) throw Error('The depreciation schedule has an invalid start month');
  const end = Math.min(monthIndex(throughMonth),start+plan.months-1);
  let accumulated = Number(asset.accumulated_depreciation || 0);
  const rows = [];
  for (let index = from; index <= end; index++) {
    const elapsed = index-start+1;
    const chargeToDate = elapsed === plan.months ? plan.basis : Math.min(plan.basis,money(money(plan.basis/plan.months)*elapsed));
    const target = money(plan.opening + chargeToDate);
    const amount = money(target-accumulated), month = shiftMonth(plan.start,index-start);
    if (amount < 0) throw Error('The recorded depreciation is ahead of this schedule; review the asset settings');
    accumulated = target;
    rows.push({ month, date:monthEnd(month), amount, accumulated_after:accumulated, net_book_value_after:money(Number(asset.acquisition_cost)-accumulated) });
  }
  return rows;
}
