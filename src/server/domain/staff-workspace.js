import {canUseTreasury,visibleTreasuryDocuments} from '../../lib/treasury-access.js';
import { readRecords } from './commercial-workspace.js';
import { canReadPurchase } from './purchase-workspace.js';
import { productionReadyForIssue } from '../../lib/production-handoff.js';

const pick = (row, fields) => Object.fromEntries(fields.map(key => [key, row?.[key]]));
const view = (rows, fields) => rows.map(row => pick(row, fields));
const plusDays = (date, days) => { const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const productFields = ['id', 'name', 'inventory_type', 'image_url', 'storage_unit', 'size', 'flavor', 'is_active'];
const issueFields = ['id','order_number','product_name','status','planned_output','production_date','batch_number','approved_by','approved_at','production_authorization_role','production_authorization_name','production_requested_by_name','recipe_kind','yogurt_phase','yogurt_issued_stages'];
async function productsFor(svc, ids) {
  const unique = [...new Set(ids)].filter(Boolean), products = [];
  for (let i = 0; i < unique.length; i += 100) products.push(...await readRecords(svc.entities.Product, { id: { $in: unique.slice(i, i + 100) } }));
  return view(products, productFields);
}

export async function cashierData(svc, date, role='cashier') {
  const [accounts, movements, handovers, payments, expenses] = await Promise.all([
    readRecords(svc.entities.TreasuryAccount),
    readRecords(svc.entities.TreasuryTransaction, { transaction_date: date }),
    readRecords(svc.entities.CashHandover, { status: { $in: ['submitted', 'partially_received', 'disputed'] } }),
    readRecords(svc.entities.Payment, { payment_type: 'supplier_payment', status: { $in: ['draft', 'pending_approval', 'approved'] } }),
    readRecords(svc.entities.ExpenseRequest, { status: 'approved' }),
  ]);
  return {
    accounts: view(accounts.filter(a=>a.is_active===true&&canUseTreasury(role,a)), ['id', 'name', 'account_type', 'balance']),
    movements: view(movements.filter(m=>role==='admin'||accounts.some(a=>a.id===m.treasury_account_id&&canUseTreasury(role,a))), ['id', 'transaction_type', 'transaction_date', 'amount']),
    handovers: view(handovers, ['id', 'handover_number', 'commercial_name', 'status', 'offered_amount', 'received_amount', 'submitted_at']),
    payments: view(visibleTreasuryDocuments(role,payments,accounts), ['id', 'payment_number', 'party_name', 'amount', 'status', 'payment_method', 'cheque_gm_signed_at', 'cheque_pm_signed_at', 'created_date']),
    expenses: view(expenses, ['id', 'request_number', 'title', 'amount', 'status']),
  };
}

export async function productionData(svc, date, allowedModules = null) {
  const can = module => !allowedModules || allowedModules.includes(module);
  const [orders, balances, cheques, recipes, expenses] = await Promise.all([
    can('manufacturing') ? readRecords(svc.entities.ProductionOrder, { $or: [
      { status: { $in: ['draft', 'awaiting_approval', 'approved', 'materials_reserved', 'materials_issued', 'in_production', 'awaiting_qc', 'completed'] } },
      { production_date: date, status: 'released' },
    ] }) : [],
    can('inventory') || can('quality') ? readRecords(svc.entities.StockBalance, { quantity: { $gt: 0 }, $or: [
      { qc_status: { $in: ['quarantine', 'quarantined', 'rejected'] } }, { expiry_date: { $lte: plusDays(date, 7) } },
    ] }) : [],
    can('cashier') ? readRecords(svc.entities.Payment, { payment_method: 'cheque', status: 'draft' }) : [],
    can('approvals') && can('manufacturing') ? readRecords(svc.entities.Recipe, { status: 'draft' }) : [],
    can('approvals') && can('expenses') ? readRecords(svc.entities.ExpenseRequest, { status: 'pending_approval' }) : [],
  ]);
  return {
    orders: view(orders, ['id', 'order_number', 'product_id', 'product_name', 'production_date', 'planned_output', 'actual_output', 'rejected_output', 'batch_number', 'status']),
    riskLots: view(balances, ['id', 'product_id', 'product_name', 'batch_number', 'expiry_date', 'quantity', 'qc_status', 'warehouse_name']),
    products: await productsFor(svc, [...orders, ...balances].map(row => row.product_id)),
    cheques: view(cheques.filter(p => !p.cheque_pm_signed_at), ['id', 'payment_number', 'party_name', 'amount']),
    productionApprovals: [
      { key: 'recipes', title: 'Recipes to approve', count: recipes.length, path: '/approvals' },
      { key: 'expenses', title: 'Expense requests to review', count: expenses.length, path: '/approvals' },
    ],
  };
}

export async function supplyChainData(svc, date, allowedModules = null) {
  const can = module => !allowedModules || allowedModules.includes(module);
  const [orders, balances, dispatches, batches] = await Promise.all([
    can('purchases') ? readRecords(svc.entities.PurchaseOrder, { status: { $in: ['draft', 'pending_approval', 'approved', 'partially_received'] } }) : [],
    can('inventory') || can('quality') ? readRecords(svc.entities.StockBalance, { quantity: { $gt: 0 }, $or: [
      { qc_status: { $in: ['quarantine', 'quarantined', 'rejected'] } }, { expiry_date: { $lte: plusDays(date, 7) } },
    ] }) : [],
    can('distribution') ? readRecords(svc.entities.Dispatch, { status: { $in: ['approved', 'loaded', 'in_transit', 'returned'] } }) : [],
    can('manufacturing') ? readRecords(svc.entities.ProductionOrder,{$or:[{status:'approved'},{recipe_kind:'yogurt_phased_v1',status:'in_production'}]}) : [],
  ]);
  return {
    purchaseOrders:view(orders,['id','po_number','supplier_name','order_date','status','total']),
    riskLots:view(balances,['id','product_id','product_name','batch_number','expiry_date','quantity','qc_status']),
    dispatches:view(dispatches,['id','dispatch_number','driver_name','vehicle_name','route_name','status']),
    materialIssueOrders:view(batches.filter(productionReadyForIssue),issueFields),
  };
}

export async function managerData(svc, date) {
  const monthStart = date.slice(0, 8) + '01';
  const since = monthStart < plusDays(date, -6) ? monthStart : plusDays(date, -6);
  const invoiceStatuses = ['posted', 'partially_paid', 'paid', 'overdue'];
  const [cash, production, invoices, receivables, dispatches, fieldSales, pos, requests, expenses, payments, recipes, payroll, acquisitions, outletReports, recordedFieldSales] = await Promise.all([
    cashierData(svc, date, 'admin'), productionData(svc, date),
    readRecords(svc.entities.Invoice, { invoice_date: { $gte: since, $lte: date }, status: { $in: invoiceStatuses } }),
    readRecords(svc.entities.Invoice, { status: { $in: invoiceStatuses }, balance: { $gt: 0 } }),
    readRecords(svc.entities.Dispatch, { status: { $in: ['approved', 'loaded', 'in_transit', 'returned'] } }),
    readRecords(svc.entities.FieldSale, { status: { $in: ['submitted', 'under_review', 'posting_failed'] } }),
    readRecords(svc.entities.PurchaseOrder, { status: 'pending_approval' }),
    readRecords(svc.entities.DispatchRequest, { status: 'pending_approval' }),
    readRecords(svc.entities.ExpenseRequest, { status: 'pending_approval' }),
    readRecords(svc.entities.Payment, { status: { $in: ['pending_approval', 'approved'] } }),
    readRecords(svc.entities.Recipe, { status: 'draft' }),
    readRecords(svc.entities.PayrollRun, { status: 'calculated' }),
    readRecords(svc.entities.Customer, { acquisition_verified: 'pending', acquired_by_id: { $ne: '' } }),
    readRecords(svc.entities.OutletVisit, { status: 'submitted' }),
    readRecords(svc.entities.FieldSale, { status: 'approved_posted', transaction_date: { $gte: since, $lte: date } }),
  ]);
  const queue = (key, title, count, path) => ({ key, title, count, path });
  return { ...cash, ...production,
    invoices: view(invoices, ['id', 'invoice_date', 'status', 'total']),
    recordedFieldSales: view(recordedFieldSales.filter(sale => sale.status === 'approved_posted' && typeof sale.journal_id === 'string' && sale.journal_id.trim() && sale.transaction_date >= since && sale.transaction_date <= date), ['id', 'transaction_date', 'status', 'total', 'journal_id']),
    receivables: view(receivables, ['id', 'invoice_number', 'customer_name', 'due_date', 'status', 'balance']),
    dispatches: view(dispatches, ['id', 'dispatch_number', 'driver_name', 'vehicle_name', 'route_name', 'status']),
    approvalQueues: [
      queue('field', 'Field sales', fieldSales.length, '/field-review'),
      queue('purchase', 'Purchase orders', pos.length, '/?section=approvals'),
      queue('production', 'Production orders', production.orders.filter(o => o.status === 'awaiting_approval').length, '/?section=approvals'),
      queue('cash', 'Cash disbursements', payments.filter(p => p.payment_type === 'supplier_payment' && p.status === 'pending_approval').length, '/?section=approvals'),
      queue('receipts', 'Customer receipts', payments.filter(p => p.payment_type === 'customer_payment').length, '/?section=approvals'),
      queue('expense', 'Expense requests', expenses.length, '/?section=approvals'),
      queue('dispatch', 'Stock requests', requests.length, '/?section=approvals'),
      queue('recipe', 'Recipes', recipes.length, '/?section=approvals'),
      queue('payroll', 'Payroll runs', payroll.length, '/?section=approvals'),
    ],
    pendingAcquisitions: acquisitions.filter(c => c.acquired_by_id).length,
    pendingOutletReports: outletReports.length,
  };
}

export async function operationalStaffData(svc, mode, date, allowedModules, employee, actorRole) {
  const can = module => !allowedModules || allowedModules.includes(module);
  const production = mode === 'warehouse_manager' && can('manufacturing');
  const [orders, riskLots, dispatches, batches, expenses] = await Promise.all([
    can('purchases') ? readRecords(svc.entities.PurchaseOrder, { status: { $in: ['draft','pending_approval','approved','partially_received'] } }) : [],
    can('inventory') || can('quality') ? readRecords(svc.entities.StockBalance, { quantity: { $gt: 0 }, $or: [
      { qc_status: { $in: ['quarantine','quarantined','rejected'] } }, { expiry_date: { $lte: plusDays(date,7) } },
    ] }) : [],
    can('distribution') && mode !== 'procurement' ? readRecords(svc.entities.Dispatch, { status: { $in: ['approved','loaded','in_transit','returned'] } }) : [],
    production ? readRecords(svc.entities.ProductionOrder, { status: { $in: ['approved','materials_reserved','materials_issued','in_production','awaiting_qc'] } }) : [],
    can('expenses') && employee?.id ? readRecords(svc.entities.ExpenseRequest, { requester_id: employee.id, status: { $in: ['draft','pending_approval','approved'] } }) : [],
  ]);
  return {
    purchaseOrders: view(orders.filter(order => canReadPurchase(actorRole === 'admin' ? 'admin' : mode, employee, order)), ['id','po_number','supplier_name','status','expected_date','total']),
    riskLots: view(riskLots,['id','product_name','batch_number','quantity','expiry_date','qc_status']),
    dispatches: view(dispatches,['id','dispatch_number','driver_name','vehicle_name','status']),
    orders: view(batches,['id','order_number','product_name','status','production_date','batch_number']),
    materialIssueOrders:view(batches.filter(productionReadyForIssue),issueFields),
    expenses: view(expenses,['id','request_number','title','amount','status']),
  };
}

export async function staffDashboardData(svc, mode, date, allowedModules = null, employee = null, actorRole = mode) {
  if (mode === 'cashier') return cashierData(svc, date);
  if (mode === 'production_manager') return productionData(svc, date, allowedModules);
  if (mode === 'supply_chain_manager') return supplyChainData(svc, date, allowedModules);
  if (mode === 'admin') return managerData(svc, date);
  if (['warehouse_manager','procurement','employee'].includes(mode)) return operationalStaffData(svc,mode,date,allowedModules,employee,actorRole);
  throw new Error('Unknown staff dashboard');
}
