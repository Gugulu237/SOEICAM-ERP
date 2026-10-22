import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialUI, hookRuntime } from './helpers/commercial-ui.mjs';
import { hotessePerformance } from '../src/lib/staff-performance.js';

test('Commercial performance and rewards appear only in their dedicated task view', async () => {
  const render = await commercialUI(), runtime = hookRuntime(); globalThis.__commercialUI = runtime;
  const data = { employee: { id: 'agent', commission_rate_percent: 5, new_customer_bonus: 1000 }, date: '2026-10-21', monthStart: '2026-10-01',
    customers: [{ id: 'customer', acquisition_date: '2026-10-01', acquisition_verified: 'verified_unique' }],
    sales: [{ customer_id: 'customer', status: 'approved_posted', transaction_date: '2026-10-21', subtotal: 10000, total: 11925 }] };
  try {
    runtime.beforeRender(); let html = render({ data });
    assert.doesNotMatch(html, /Commission estimate this month|Monthly goals|Cash awaiting clearance|To follow up/);
    const button = runtime.buttons.find(row => row.label === 'Performance & rewards'); assert.ok(button); button.onClick();
    runtime.beforeRender(); html = render({ data });
    assert.match(html, /Commission estimate this month/); assert.match(html, /1,500/);
    assert.match(html, /Tax and free replacements are excluded/); assert.match(html, /management must review and approve payment/);
    runtime.buttons.find(row => row.label === 'Sales').onClick(); runtime.beforeRender(); html = render({ data });
    assert.doesNotMatch(html, /Commission estimate this month|Monthly goals/);
  } finally { runtime.cleanup(); delete globalThis.__commercialUI; }
});
test('Hotesse starts at the assigned outlet daily report and opens performance separately', async () => {
  const render = await commercialUI(), runtime = hookRuntime(); globalThis.__commercialUI = runtime;
  const data = { employee: { bonus_plan: 'Performance review at month end.' }, date: '2026-10-21', locations: [{ id: 'point', customer_name: 'Partner shop', name: 'Main' }],
    outletProducts: { point: [{ id: 'product', name: 'YOLA', opening_quantity: 12 }] }, reports: [{ id: 'report', report_type: 'daily_sales', location_id: 'point', visit_date: '2026-10-20', status: 'reviewed', lines: [{ product_id: 'product', product_name: 'YOLA', unit: 'ea', sold_quantity: 7 }] }] };
  try {
    runtime.beforeRender(); let html = render({ data }, 'hotesse');
    assert.match(html, /Partner shop/); assert.match(html, /Record daily report/); assert.doesNotMatch(html, /Estimated rewards|Reports reviewed|Your shelves, your daily report/);
    runtime.buttons.find(row => row.label === 'Performance & rewards').onClick(); runtime.beforeRender(); html = render({ data }, 'hotesse');
    assert.match(html, /Reports reviewed/); assert.match(html, /7 ea/); assert.match(html, /Estimated rewards/); assert.match(html, /has not been configured/);
    assert.match(html, /Performance review at month end/); assert.doesNotMatch(html, /Record daily report|XAF/);
  } finally { runtime.cleanup(); delete globalThis.__commercialUI; }
});
test('Hotesse performance excludes shelf checks and other months, and keeps product units separate', () => {
  const line = { product_id: 'p', product_name: 'YOLA', unit: 'ea', sold_quantity: 5 };
  const report = { report_type: 'daily_sales', visit_date: '2026-10-21', location_id: 'point', status: 'reviewed', lines: [line] };
  const summary = hotessePerformance([report, { ...report, status: 'submitted', location_id: 'second', lines: [{ ...line, unit: 'kg', sold_quantity: 2.5 }] },
    { ...report, report_type: 'shelf_check' }, { ...report, visit_date: '2026-09-30' }, { ...report, visit_date: '2026-10-22' }], '2026-10-21');
  assert.equal(summary.submitted, 2); assert.equal(summary.reviewed, 1); assert.equal(summary.reportedToday, 2);
  assert.deepEqual(summary.products.map(row => [row.unit, row.sold]), [['ea', 5], ['kg', 2.5]]);
});
