/* localized-metadata */
import {ui} from './i18n.js';
import { DASHBOARD_ROLES } from './staff-dashboard.js';
// Read-only illustrative layouts. These objects are never saved to Base44.
export function dashboardPreview(mode) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Douala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const products = [
    { id: 'example-bottle', name: 'YOLA Nature 330 ml', inventory_type: 'assembly', storage_unit: 'bottles', selling_price: 500, image_url: '/products/yola/drink-nature-330ml.jpg' },
    { id: 'example-cup', name: 'YOLA Brassé Fraise 500 g', inventory_type: 'assembly', storage_unit: 'cups', selling_price: 1000, image_url: '/products/yola/brasse-fraise-500g.jpg' },
    { id: 'example-tub', name: 'YOLA Vanille 1 kg', inventory_type: 'assembly', storage_unit: 'tubs', selling_price: 2000, image_url: '/products/yola/tub-vanille-1kg.jpg' },
  ];
  const shared = { isExample: true, mode, date, monthStart: date.slice(0, 8) + '01', employee: { id: 'example-employee', full_name: 'Example ' + (DASHBOARD_ROLES.find(role => role.value === mode)?.label || 'staff') }, products };
  if (mode === 'commercial') return { ...shared,
    balances: products.map((p, i) => ({ product_id: p.id, quantity: [36, 24, 12][i], qc_status: 'approved' })),
    sales: [{ id: 'example-approved', customer_name: 'Example shop', sale_number: 'SAMPLE-01', transaction_date: date, created_date: date, status: 'approved_posted', total: 25000 },
      { id: 'example-draft', customer_name: 'Example minimarket', sale_number: 'SAMPLE-02', transaction_date: date, created_date: date, status: 'draft', total: 12500 },
      { id: 'example-correction', customer_name: 'Example outlet', sale_number: 'SAMPLE-03', transaction_date: date, created_date: date, status: 'returned', total: 8000 }],
    customers: [{ id: 'example-customer-1', acquisition_verified: 'verified_unique' }, { id: 'example-customer-2', acquisition_verified: 'pending' }],
    cash: [{ outstanding_amount: 15000 }],
  };
  const cash = {
    accounts: [{ id: 'example-account-1', name: 'Example cash desk', account_type: 'cash', balance: 485000 }, { id: 'example-account-2', name: 'Example bank account', account_type: 'bank', balance: 1350000 }, { id: 'example-account-3', name: 'Example mobile account', account_type: 'mobile_money', balance: 120000 }],
    movements: [{ id: 'example-receipt', transaction_date: date, transaction_type: 'receipt', amount: 185000 }, { id: 'example-expense', transaction_date: date, transaction_type: 'expense', amount: 42000 }],
    handovers: [{ id: 'example-handover-1', handover_number: 'SAMPLE-H01', commercial_name: 'Example Commercial A', status: 'submitted', offered_amount: 75000, received_amount: 0 }, { id: 'example-handover-2', handover_number: 'SAMPLE-H02', commercial_name: 'Example Commercial B', status: 'partially_received', offered_amount: 45000, received_amount: 30000 }],
    payments: [{ id: 'example-payment', payment_number: 'SAMPLE-P01', party_name: 'Example packaging supplier', status: 'approved', payment_method: 'bank_transfer', amount: 80000 }, { id: 'example-cheque', payment_number: 'SAMPLE-P02', party_name: 'Example supplier', status: 'draft', payment_method: 'cheque', amount: 140000 }],
    expenses: [{ id: 'example-expense-request', request_number: 'SAMPLE-E01', get title(){return ui("Example delivery fuel");}, amount: 20000, status: 'approved' }],
  };
  const production = {
    orders: products.map((product, i) => ({ id: 'example-batch-' + i, order_number: 'SAMPLE-B0' + (i + 1), product_id: product.id, product_name: product.name, production_date: date, planned_output: [240, 180, 60][i], actual_output: [120, 176, 0][i], rejected_output: i === 1 ? 4 : 0, batch_number: 'SAMPLE-LOT-' + (i + 1), status: ['in_production', 'awaiting_qc', 'awaiting_approval'][i] })),
    riskLots: [{ id: 'example-risk', product_id: products[1].id, product_name: products[1].name, quantity: 12, qc_status: 'quarantined', expiry_date: date }],
    cheques: [{ id: 'example-cheque', payment_number: 'SAMPLE-P02', party_name: 'Example supplier', amount: 140000 }],
    productionApprovals: [{ key: 'recipes', get title(){return ui("Recipes to approve");}, count: 2, path: '/approvals' }, { key: 'expenses', get title(){return ui("Expense requests to review");}, count: 1, path: '/approvals' }],
  };
  if (mode === 'cashier') return { ...shared, ...cash };
  if (mode === 'production_manager') return { ...shared, ...production };
  if (mode === 'supply_chain_manager') return { ...shared,
    purchaseOrders:[{ id:'example-purchase',order_number:'SAMPLE-PO-01',supplier_name:'Example supplier',status:'pending_approval' }],
    dispatches:[{ id:'example-dispatch',dispatch_number:'SAMPLE-RUN-01',driver_name:'Example driver',status:'in_transit' }],
    riskLots:production.riskLots,
  };
  if (mode === 'hotesse') return { ...shared,
    outletDeliveries: {
      'example-outlet-1': [{ key: 'example-delivery-1', document_number: 'SAMPLE-SUPPLY-01', date, shelf_check_id: '', lines: products.map((product, index) => ({ product_id: product.id, product_name: product.name, image_url: product.image_url,
        unit: product.storage_unit, quantity: [36, 24, 12][index], lot_number: 'SAMPLE-LOT-' + (index + 1), expiry_date: '' })) }],
      'example-outlet-2': [{ key: 'example-delivery-2', document_number: 'SAMPLE-SUPPLY-02', date, shelf_check_id: '', lines: [{ product_id: products[0].id, product_name: products[0].name, image_url: products[0].image_url, unit: products[0].storage_unit, quantity: 18, lot_number: 'SAMPLE-LOT-1', expiry_date: '' }] }],
    },
    outletProducts: {
      'example-outlet-1': products.map((product, index) => ({ ...product, opening_quantity: [36, 24, 12][index], cumulative_supplied: [36, 24, 12][index], last_report_date: null })),
      'example-outlet-2': products.slice(0, 1).map(product => ({ ...product, opening_quantity: 18, cumulative_supplied: 18, last_report_date: null })),
    },
    locations: [{ id: 'example-outlet-1', customer_id: 'example-customer-1', customer_name: 'Example supermarket', name: 'Main outlet', address: 'Outlet address appears here', town: 'Yaounde', contact_person: 'Outlet contact', assigned_hotesse_ids: ['example-employee'] }, { id: 'example-outlet-2', customer_id: 'example-customer-2', customer_name: 'Example minimarket', name: 'Neighbourhood outlet', address: 'Outlet address appears here', town: 'Yaounde', assigned_hotesse_ids: ['example-employee'] }],
    reports: [{ id: 'example-visit-1', employee_id: 'example-employee', employee_name: 'Example Hotesse', location_id: 'example-outlet-1', location_name: 'Main outlet', customer_name: 'Example supermarket', visit_date: date, recorded_at: date + 'T10:00:00Z', status: 'submitted', has_concerns: true, notes: 'Example observation: the shelf needs replenishing.', lines: [{ product_id: products[0].id, product_name: products[0].name, unit: 'bottles', availability: 'low_stock', issue: 'none', quantity: 3 }], proof_file_uris: [] }],
  };
  if (mode === 'admin') {
    const day = offset => { const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() - offset); return value.toISOString().slice(0, 10); };
    return { ...shared, ...cash, ...production,
      invoices: [185000, 240000, 160000, 310000, 275000, 220000, 355000].map((total, i) => ({ id: 'example-invoice-' + i, invoice_date: day(6 - i), status: 'posted', total })),
      receivables: [{ id: 'example-receivable', invoice_number: 'SAMPLE-I01', customer_name: 'Example supermarket', due_date: day(3), status: 'overdue', balance: 125000 }],
      dispatches: [{ id: 'example-run', status: 'in_transit', route_name: 'Example delivery route' }],
      approvalQueues: [{ key: 'field', get title(){return ui("Field sales");}, count: 3, path: '/field-review' }, { key: 'purchase', get title(){return ui("Purchase orders");}, count: 2, path: '/approvals' }, { key: 'production', get title(){return ui("Production orders");}, count: 1, path: '/approvals' }, { key: 'cash', get title(){return ui("Cash disbursements");}, count: 1, path: '/approvals' }],
      pendingAcquisitions: 4, pendingOutletReports: 2,
    };
  }
  return { ...shared, dispatches: [{ id: 'example-run', dispatch_number: 'SAMPLE-RUN', dispatch_date: date, status: 'loaded', route_name: 'Example delivery route', vehicle_name: 'Assigned vehicle', notes: 'Check the manifest and customer delivery instructions before departure.' }],
    manifest: products.map((p, i) => ({ id: 'example-manifest-' + i, dispatch_id: 'example-run', product_id: p.id, product_name: p.name, unit: p.storage_unit, requested_quantity: [36, 24, 12][i], loaded_quantity: [36, 24, 12][i] })),
    stops: [{ id: 'example-order', dispatch_id: 'example-run', order_number: 'SAMPLE-ORDER', customer_name: 'Example shop', status: 'ready', location: { address: 'Customer delivery address', delivery_instructions: 'Delivery entrance and contact instructions appear here.' } }],
    orderLines: products.slice(0, 2).map((p, i) => ({ id: 'example-line-' + i, order_id: 'example-order', product_id: p.id, product_name: p.name, unit: p.storage_unit, quantity: 12 })), activities: [],
  };
}
