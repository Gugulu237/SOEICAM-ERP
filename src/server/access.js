import { COMPANY_PROFILE_FIELDS } from '../lib/company-profile.js';
import { effectiveRole } from './domain/roles.js';
import { assertEntityModule, assertModule } from './domain/role-catalogue.js';
import { canReadManagementAccounting } from '../lib/management-access.js';
import { CASH_ACCOUNT_TYPES } from '../lib/treasury-access.js';
import { guardEmployeeAttribution } from './domain/employee-action-access.js';

const readRoles = {
  Account:['cashier'], AccountingPeriod:['cashier','production_manager','warehouse_manager','procurement','employee'], AuditLog:[],
  Bill:['cashier','procurement'], Branch:['cashier','production_manager','warehouse_manager','procurement','employee'], Budget:['cashier','production_manager','procurement','warehouse_manager','employee'],
  CashCollection:['cashier','commercial'], CashHandover:['cashier','commercial'], CashHandoverAllocation:['cashier'], CompanySettings:['cashier','production_manager','warehouse_manager','procurement','employee','commercial','driver','hotesse'],
  Customer:['cashier','commercial','employee','production_manager'], CustomerLocation:['commercial','employee','warehouse_manager','production_manager'], Department:['cashier','production_manager','warehouse_manager','procurement','employee'],
  DepreciationEntry:[], Dispatch:['warehouse_manager','employee','production_manager'], DispatchLine:['warehouse_manager','employee','production_manager'], DispatchRequest:['warehouse_manager','employee','production_manager'], DriverActivity:[],
  Employee:['cashier','production_manager','warehouse_manager','procurement','employee','commercial','driver','hotesse'], ExpenseRequest:['cashier','production_manager','warehouse_manager','procurement','employee'],
  FieldSale:['commercial'], FieldSaleLine:['commercial'], FixedAsset:[], GoodsReceipt:['warehouse_manager','procurement','cashier'], GoodsReceiptLine:['warehouse_manager','procurement','cashier'],
  Invoice:['cashier','employee'], InvoiceLine:['cashier','employee'], JournalEntry:[], JournalLine:[], OutletVisit:[],
  Payment:['cashier','procurement','production_manager'], PaymentAllocation:['cashier'], PayrollLine:[], PayrollRun:[], PostingRule:['cashier','warehouse_manager','production_manager','employee','procurement'],
  Product:['cashier','warehouse_manager','production_manager','employee','procurement','commercial'], ProductionMaterial:['production_manager','warehouse_manager'], ProductionOrder:['production_manager','warehouse_manager'],
  PurchaseItem:['procurement','warehouse_manager','production_manager','employee','cashier'], PurchaseOrder:['procurement','warehouse_manager','production_manager','employee','cashier'], PurchaseOrderLine:['procurement','warehouse_manager','production_manager','employee','cashier'],
  QualityCheck:['production_manager','warehouse_manager'], Recipe:['production_manager','warehouse_manager'], RecipeLine:['production_manager','warehouse_manager'], Route:['warehouse_manager','employee','production_manager'],
  SalesOrder:['employee','warehouse_manager','cashier','production_manager'], SalesOrderLine:['employee','warehouse_manager','cashier','production_manager'], SpoilageRecord:['warehouse_manager','production_manager','employee'],
  StockBalance:['warehouse_manager','production_manager','procurement','commercial','employee'], StockMovement:['warehouse_manager','production_manager','procurement','employee'], Supplier:['procurement','cashier'],
  TreasuryAccount:['cashier'], TreasuryTransaction:['cashier'], User:['cashier','production_manager','warehouse_manager','procurement','employee','commercial','driver','hotesse'], Vehicle:['warehouse_manager','employee','production_manager'], Warehouse:['warehouse_manager','production_manager','procurement','commercial','employee'],
};
const writeRoles = {
  Account:[], AccountingPeriod:[], AuditLog:['cashier','production_manager','warehouse_manager','procurement','employee'], Bill:['procurement','cashier','warehouse_manager'], Branch:[], Budget:[],
  CashCollection:[], CashHandover:[], CashHandoverAllocation:[], CompanySettings:['cashier','production_manager','warehouse_manager','procurement','employee'], Customer:['employee','cashier'], CustomerLocation:['employee'], Department:[], DepreciationEntry:['cashier'],
  Dispatch:['warehouse_manager','employee','production_manager'], DispatchLine:['warehouse_manager','employee','production_manager'], DispatchRequest:['warehouse_manager','employee','production_manager'], DriverActivity:[], Employee:[], ExpenseRequest:['cashier','production_manager','warehouse_manager','procurement','employee'],
  FieldSale:[], FieldSaleLine:[], FixedAsset:['cashier'], GoodsReceipt:['warehouse_manager','procurement'], GoodsReceiptLine:['warehouse_manager','procurement'], Invoice:['cashier','employee'], InvoiceLine:['cashier','employee'],
  JournalEntry:['cashier'], JournalLine:['cashier'], OutletVisit:[], Payment:['cashier','production_manager'], PaymentAllocation:['cashier'], PayrollLine:[], PayrollRun:[], PostingRule:[],
  Product:['warehouse_manager','procurement','production_manager'], ProductionMaterial:['production_manager','warehouse_manager'], ProductionOrder:['production_manager','warehouse_manager'],
  PurchaseItem:['procurement','production_manager','warehouse_manager','employee'], PurchaseOrder:['procurement','production_manager','warehouse_manager','employee'], PurchaseOrderLine:['procurement','production_manager','warehouse_manager','employee'],
  QualityCheck:['production_manager'], Recipe:['production_manager'], RecipeLine:['production_manager'], Route:['warehouse_manager','employee','production_manager'], SalesOrder:['employee','warehouse_manager','cashier'], SalesOrderLine:['employee','warehouse_manager','cashier'],
  SpoilageRecord:['warehouse_manager','production_manager','employee'], StockBalance:['warehouse_manager','production_manager','employee'], StockMovement:['warehouse_manager','production_manager','employee'], Supplier:['procurement'], TreasuryAccount:['cashier'], TreasuryTransaction:['cashier'], User:[], Vehicle:['warehouse_manager','production_manager'], Warehouse:['warehouse_manager','production_manager'],
};
export const entityPolicies = { readRoles, writeRoles };
export const forbidden = message => Object.assign(new Error(message || 'Your role does not permit this action.'), { status:403 });
export function requireActiveContext(context) {
  const role = effectiveRole(context.user,context.employee);
  if (!context.user) throw Object.assign(new Error('Please sign in.'),{ status:401 });
  if (context.employee?.status && context.employee.status !== 'active') throw forbidden('This staff account is not active. Contact the General Manager.');
  if (role !== 'admin' && (!context.employee || (context.employee.status && context.employee.status !== 'active'))) throw forbidden('An active linked staff account is required. Ask the General Manager to link your login in Employees.');
  return role;
}
export function assertEntityAccess(context, entity, operation) {
  const role = requireActiveContext(context), reading = ['get','list','filter','aggregate','count'].includes(operation);
  if (!Object.hasOwn(readRoles,entity)) throw forbidden('Unknown table permission.');
  if (['DriverActivity','OutletVisit'].includes(entity)) throw forbidden('Use the assigned staff reporting workflow.');
  if (!reading && ['FieldSale','FieldSaleLine','CashCollection','CashHandover','CashHandoverAllocation'].includes(entity)) throw forbidden('Use the checked Commercial transaction workflow.');
  assertEntityModule(context,entity,operation);
  if (role === 'admin') return role;
  if (reading && ['Account','JournalEntry','JournalLine'].includes(entity) && canReadManagementAccounting(role,context.employee)) return role;
  if (!(reading ? readRoles : writeRoles)[entity]?.includes(role)) throw forbidden();
  return role;
}
export async function recordScope(context, entity, operation, stores) {
  const role = assertEntityAccess(context,entity,operation), employeeId = context.employee?.id;
  if (role === 'admin') return {};
  if (['production_manager','warehouse_manager'].includes(role) && canReadManagementAccounting(role,context.employee)) {
    if (entity==='JournalEntry') return {status:'posted'};
    if (entity==='JournalLine') {
      const ids=[];
      for(let skip=0;;skip+=200){const page=await stores.JournalEntry.filter({status:'posted'},'id',200,skip);ids.push(...page.map(j=>j.id));if(page.length<200)break;}
      return {journal_id:{$in:ids}};
    }
  }
  if (role === 'cashier') {
    if(entity==='Account')return {account_type:{$in:['expense','other_expense']}};
    if(entity==='TreasuryAccount')return {account_type:{$in:CASH_ACCOUNT_TYPES}};
    if(entity==='TreasuryTransaction')return {treasury_account_id:{$in:(await stores.TreasuryAccount.filter({account_type:{$in:CASH_ACCOUNT_TYPES}})).map(a=>a.id)}};
    if(entity==='Payment') {const banks=await stores.TreasuryAccount.filter({account_type:{$nin:CASH_ACCOUNT_TYPES}});return {payment_method:{$nin:['bank','bank_transfer']},treasury_account_id:{$nin:banks.map(a=>a.id)}};}
  }
  if (entity === 'User') return { id:context.user.id };
  if (entity === 'Employee') {
    if (['warehouse_manager','employee','production_manager'].includes(role)) return { $or:[{ id:employeeId }, { role:{ $in:['commercial','driver','employee'] }, status:'active' }] };
    if (role === 'commercial') return { $or:[{ id:employeeId }, { role:'cashier', status:'active' }] };
    return { id:employeeId };
  }
  if (role === 'production_manager' && entity === 'Payment') return { payment_method:'cheque' };
  if (role === 'commercial') {
    if (entity === 'Warehouse') return { warehouse_type:'commercial_custody', custodian_employee_id:employeeId };
    if (entity === 'StockBalance') return { warehouse_id:{ $in:(await stores.Warehouse.filter({ warehouse_type:'commercial_custody',custodian_employee_id:employeeId })).map(row=>row.id) } };
    if (entity === 'Product') return { inventory_type:{ $in:['assembly','finished_product'] } };
    if (['FieldSale','CashCollection','CashHandover'].includes(entity)) return { commercial_id:employeeId };
    if (entity === 'FieldSaleLine') return { field_sale_id:{ $in:(await stores.FieldSale.filter({ commercial_id:employeeId })).map(row=>row.id) } };
  }
  if (entity === 'ExpenseRequest' && !['cashier','production_manager'].includes(role)) return { requester_id:employeeId };
  return {};
}
export function guardMutation(context, entity, operation, payload, existing) {
  const role = assertEntityAccess(context,entity,operation);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key=>key.startsWith('$'))) throw forbidden('Only direct field changes are accepted.');
  const value = payload;
  if(role==='cashier' && entity==='Payment' && ['bank','bank_transfer'].includes(value.payment_method || existing?.payment_method))throw forbidden('Bank accounts are restricted to administrators.');
  if(entity==='Customer' && (Object.keys(value).some(key=>/^customer_(removed_|restored_|removal_|lifecycle_)/.test(key)) || existing?.customer_removed_at))throw forbidden('Delete or restore customers through the checked customer edit workflow.');
  if(entity==='AuditLog' && ([value,existing].some(row=>row && (['remove_customer','restore_customer'].includes(row.action) || 'customer_lifecycle_payload' in row || String(row.id||'').startsWith('customer-lifecycle-')))))throw forbidden('Customer directory deletion records are managed by the checked customer workflow.');
  if(entity==='Employee' && (['delete','deleteMany'].includes(operation) || Object.keys(value).some(key=>key.startsWith('employee_removed_') || key.startsWith('employee_restored_') || ['employee_removal_reason','employee_lifecycle_revision'].includes(key))))throw forbidden('Remove or restore employees through the checked employee directory workflow.');
  if(entity==='Employee' && existing?.employee_removed_at)throw forbidden('Restore this removed employee through the employee directory before editing the profile.');
  if(Object.keys(value).some(key=>key.startsWith('yogurt_') && !(entity==='Product' && ['yogurt_units_per_bucket','yogurt_net_weight_g'].includes(key)) || key==='recipe_kind') || entity==='ProductionOrder' && existing?.recipe_kind==='yogurt_phased_v1')throw forbidden('Yogurt phases, recipes and output records use the checked manufacturing workflow.');
  if(entity==='AuditLog' && [value,existing].some(row=>row && (['remove_employee','restore_employee'].includes(row.action) || 'employee_lifecycle_payload' in row || /^employee-lifecycle-[a-f0-9]{64}$/.test(row.id||''))))throw forbidden('Employee removal and restoration audits are managed only by the checked employee workflow.');
  if(role!=='admin' && entity==='TreasuryAccount' && ((value.account_type && !CASH_ACCOUNT_TYPES.includes(value.account_type)) || existing && !CASH_ACCOUNT_TYPES.includes(existing.account_type)))throw forbidden('Bank accounts are restricted to administrators.');
  guardEmployeeAttribution({...context,role},entity,operation,value,existing);
  if(Object.keys(value).some(key=>key.startsWith('inventory_recovery_') || key.startsWith('notification_')) || ['ExpiryRecovery'].includes(value.document_type || value.entity_type || value.source_document_type) || ['expiry_recovery'].includes(value.module || value.source_module) || /^ERD-|^FN-|^FA-/.test(value.document_id || value.source_document_id || '') || entity==='AuditLog' && ['fermentation_notification','acknowledge_fermentation_notification','start_fermentation'].includes(value.action))throw forbidden('Recovery and notification records must use the checked workflow.');
  if(entity==='StockBalance' && existing?.inventory_recovery_id && ['qc_status','qc_notes','qc_released_by','qc_released_by_user_id','qc_released_at'].some(key=>key in value))throw forbidden('Release recovered packaging through the checked inspection workflow.');
  if(entity==='ProductionOrder' && Object.keys(value).some(key=>key.startsWith('fermentation_')))throw forbidden('Start fermentation through the checked manufacturing workflow.');
  if(entity==='ProductionOrder' && existing?.fermentation_started_at && 'status' in value && value.status!==existing.status)throw forbidden('Change a fermenting batch through the checked manufacturing workflow.');
  if(Object.keys(value).some(key=>key.startsWith('payroll_')) || Object.keys(existing || {}).some(key=>key.startsWith('payroll_')) || [value.payment_type,existing?.payment_type].includes('salary_payment') || [value.source,existing?.source,value.source_module,existing?.source_module].includes('payroll') || [value.document_type,value.source_document_type,existing?.source_document_type].includes('PayrollPayment'))throw forbidden('Salary payments, payslip reviews and payroll postings use the checked Payroll workflow.');
  if(entity==='StockBalance' && (['create','bulkCreate','delete','deleteMany'].includes(operation) || ['quantity','total_value','unit_cost','warehouse_id','product_id'].some(key=>key in value)))throw forbidden('Stock quantities and values must use the checked stock workflow with special adjustment access.');
  if(entity==='AuditLog' && [value,existing].some(row=>row && (row.action==='delete_unused_account' || 'deleted_account_id' in row || /^AD-[a-f0-9]{40}$/.test(row.id || ''))))throw forbidden('Account deletion records are managed only by the checked account workflow.');
  if (entity==='ExpenseRequest') {
    if (['create','bulkCreate'].includes(operation) && !['draft','pending_approval'].includes(value.status || 'draft')) throw forbidden('New expense requests must be saved as a draft or submitted for approval.');
    if ('amount' in value && (!Number.isFinite(Number(value.amount)) || Number(value.amount)<=0)) throw forbidden('Enter a positive expense amount.');
  }
  if (Object.keys(value).some(key => key.startsWith('warehouse_adjustment_')) || Object.keys(existing || {}).some(key => key.startsWith('warehouse_adjustment_')) || [value.entity_type,existing?.entity_type,value.document_type,existing?.document_type,value.source_document_type,existing?.source_document_type].includes('WarehouseAdjustment') || [value.module,existing?.module,value.source_module,existing?.source_module].includes('inventory_adjustment') || /^WA-[a-f0-9]{40}$/.test(value.source_document_id || value.document_id || '')) throw forbidden('Warehouse quantity adjustments and their journals are managed by the checked warehouse form.');
  if (Object.keys(value).some(key => key.startsWith('inventory_audit_')) || Object.keys(existing || {}).some(key => key.startsWith('inventory_audit_'))) throw forbidden('Inventory audit records are managed only by the checked accounting count workflow.');
  if ([value.entity_type, existing?.entity_type, value.document_type, existing?.document_type, value.source_document_type, existing?.source_document_type].includes('InventoryAudit') || [value.module, existing?.module, value.source_module, existing?.source_module].includes('inventory_audit')) throw forbidden('Inventory audit records and journals are immutable outside the checked accounting count workflow.');
  if (/^IA-[a-f0-9]{32}$/.test(value.source_document_id || '') || /^IA-[a-f0-9]{32}$/.test(value.document_id || '')) throw forbidden('Inventory count references cannot be attached to generic record changes.');
  if (['FixedAsset','DepreciationEntry'].includes(entity)) throw forbidden('Use the checked fixed asset workspace for asset and depreciation changes.');
  if (['asset_request_payload','asset_result','depreciation_entry_id','replacement_target'].some(key=>key in value)) throw forbidden('Asset posting and funding records are managed by the fixed asset workspace.');
  if (entity==='TreasuryTransaction' && [value.source,existing?.source].some(source=>['asset_replacement','asset_acquisition','asset_disposal'].includes(source))) throw forbidden('Asset treasury movements are immutable; retain their linked journals.');
  if (entity==='JournalEntry' && ([value.source_module,existing?.source_module].includes('assets') || ['DepreciationEntry','AssetReplacementFunding','FixedAsset','AssetDisposal'].includes(value.source_document_type) || /^(DEP-|AS-|disposal-AS-)/.test(value.source_document_id||''))) throw forbidden('Asset journals are posted only through the fixed asset workspace.');
  if (entity === 'StockMovement' && (value.document_type === 'WarehouseTransfer' || Object.hasOwn(value,'warehouse_transfer_payload'))) throw forbidden('Record warehouse transfers through the checked Warehouse transfer form.');
  if (entity === 'Warehouse') {
    assertModule(context,'inventory');
    if (['delete','deleteMany'].includes(operation)) throw forbidden('Make an empty warehouse inactive to preserve its stock and movement history.');
  }
  if(entity==='CompanySettings' && (Object.hasOwn(value,'company_profile_revision') || Object.keys(value).some(k=>COMPANY_PROFILE_FIELDS.includes(k))))throw forbidden('Manage legal, fiscal and language details through Administration company settings.');
  if(entity==='CompanySettings' && ['delivery_zones','delivery_zones_revision'].some(k=>Object.hasOwn(value,k)))throw forbidden('Manage delivery zones through the checked customer delivery workspace.');
  if(entity==='CompanySettings' && Object.hasOwn(value,'staff_role_catalogue'))throw forbidden('Manage staff roles through the checked General Manager role editor.');
  if(Object.keys(value).some(key=>key.startsWith('sales_supply_')) || Object.keys(existing||{}).some(key=>key.startsWith('sales_supply_')) || value.module==='sales_supply' || /^SSO-[a-f0-9]{40}$/.test(value.id||''))throw forbidden('Recorded customer supplies must use the checked Sales workflow.');
  if (['Invoice','InvoiceLine'].includes(entity)) throw forbidden('Use the checked Sales invoice workspace to issue or customize invoices. Payments use the customer receipt workflow.');
  if (entity==='SalesOrder' && (existing?.status==='invoiced' || value.status==='invoiced')) throw forbidden('An invoiced sales order is read-only. Open its invoice in Sales.');
  if(entity==='StockMovement'&&('legacy_return_payload' in value||value.document_type==='CustodyReturn'))throw forbidden('Recover individual custody stock through checked Distribution control.');
  if(entity==='DispatchRequest'&&('distribution_request_key' in value||'distribution_request_payload' in value||existing?.status==='processed'))throw forbidden('Issued stock request references and processed run records are read-only. Use Distribution stock control.');
  if (entity === 'Supplier' && ['delete','deleteMany'].includes(operation)) throw forbidden('Set the supplier inactive to preserve purchase and payment history.');
  if (['supplier_request_key','supplier_request_payload'].some(key=>key in value)) throw forbidden('Supplier save references are managed by the checked supplier workflow.');
  if (entity === 'GoodsReceipt' && existing?.supplier_request_key) throw forbidden('A confirmed supplier receipt is immutable; retain its stock and bill records.');
  if (entity === 'Bill' && (existing?.accounting_source === 'goods_receipt' || value.accounting_source === 'goods_receipt')) throw forbidden('Use the checked receiving and bill-payment workflow for receipt-linked bills.');
  if (entity === 'Payment' && existing?.bill_id && ['bill_id','po_id','party_id','amount','treasury_account_id','payment_method'].some(key=>key in value && value[key]!==existing[key])) throw forbidden('A bill payment request cannot be reassigned or have its approved amounts changed.');
  if (entity === 'Payment' && existing?.bill_id && ['delete','deleteMany'].includes(operation)) throw forbidden('Keep the bill payment request and its approval history.');
  if (entity === 'Payment' && (value.payment_type === 'supplier_payment' || existing?.payment_type === 'supplier_payment') && (value.po_id || existing?.po_id) && (value.payment_method || existing?.payment_method) !== 'cheque') throw forbidden('Use Purchases or the checked Cashier workflow to request, authorize and release purchase payments.');
  if (entity === 'ProductionOrder' && ['delete', 'deleteMany'].includes(operation) && existing && (existing.status !== 'draft' || Number(existing.actual_output)>0)) throw forbidden('Submitted or produced batches cannot be deleted; retain their production and trace records.');
  if (entity === 'ProductionOrder' && value.status === 'awaiting_approval') throw forbidden('Submit production plans through the checked manufacturing workflow so raw-material stock is verified.');
  if (entity === 'ProductionOrder' && (['create','bulkCreate'].includes(operation) || Object.keys(value).some(key=>key.startsWith('production_requested_by_') || key==='production_requester_role'))) throw forbidden('Prepare production requests through the checked manufacturing workflow. Requester details come from the signed-in account.');
  if (entity === 'ProductionMaterial') throw forbidden('Material requirements and issued quantities are managed by the checked manufacturing workflow.');
  if (entity === 'ProductionOrder' && (Object.keys(value).some(key=>key.startsWith('production_authorization_')) || ['approved','materials_issued','in_production','awaiting_qc'].includes(value.status) || ['approved_by','approved_at','materials_issued_by','materials_issued_at','material_issue_journal_id','actual_output','total_material_cost','material_warehouses'].some(key=>key in value))) throw forbidden('Use the checked manufacturing workflow for approval, material issue and production output.');
  if (entity === 'JournalEntry' && (value.source_document_type==='ProductionMaterialIssue' || existing?.source_document_type==='ProductionMaterialIssue' || String(value.source_document_id || '').startsWith('production-issue:'))) throw forbidden('Production material journals are managed by the checked manufacturing workflow.');
  if (entity === 'StockMovement' && existing && existing.status !== 'pending') throw forbidden('Recorded stock movements are immutable. Record a correction movement instead.');
  if (entity === 'StockMovement' && value.movement_type === 'production_output') throw forbidden('Complete production through the checked batch workflow.');
  if (entity === 'StockMovement' && value.movement_type === 'production_issue') throw forbidden('Issue all production materials through the checked manufacturing workflow.');
  if (entity === 'StockBalance' && existing?.production_order_id && ['lot_number','expiry_date','production_order_id','product_id'].some(key => key in value && value[key] !== existing[key])) throw forbidden('Preserve the recorded production batch, product and printed expiry on this stock lot.');
  if (['id','created_date','created_by','auth_user_id','extra_data','__proto__','constructor'].some(key=>Object.hasOwn(value,key))) throw forbidden('System fields cannot be supplied in a record change.');
  if (entity === 'AuditLog' && operation !== 'create' && operation !== 'bulkCreate') throw forbidden('Audit records are append-only.');
  if (entity === 'SpoilageRecord' && (['field_expired_return', 'field_expired_request'].includes(value.record_type) || ['field_expired_return', 'field_expired_request'].includes(existing?.record_type))) throw forbidden('Use the checked expired collection and replacement workflow.');
  if (entity === 'Employee') {
    for (const [key, max] of [['commission_rate_percent', 100], ['new_customer_bonus', 1e9]]) {
      if (Object.hasOwn(value, key) && value[key] != null && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > max)) throw forbidden('Enter a valid non-negative Commercial commission rate or customer bonus.');
    }
  }
  if (role === 'admin') return;
  if (entity==='ExpenseRequest' && existing && 'requester_id' in value && value.requester_id!==existing.requester_id) throw forbidden('Expense ownership cannot be reassigned.');
  if (entity==='ExpenseRequest' && role==='production_manager') {
    if (value.status==='paid') throw forbidden('Expense payments must be released through the checked Cashier workflow.');
    if ((['approved','rejected'].includes(value.status) || ['approved_by','approved_at','rejected_by','rejected_at'].some(key=>key in value)) && existing?.requester_id===context.employee?.id) throw forbidden('Your own expense request requires General Manager approval.');
    if (existing && ['approved','paid'].includes(existing.status) && (['delete','deleteMany'].includes(operation) || Object.keys(value).some(key=>!['receipt_url','receipt_collected_at'].includes(key)))) throw forbidden('Approved expense amounts and ownership are locked; finance handles payment.');
  }
  if (role === 'cashier' && entity === 'Payment') {
    if (['approved', 'confirmed', 'posted', 'rejected'].includes(value.status)) throw forbidden('Use the checked cash release workflow after General Manager approval.');
    if (existing && ['pending_approval', 'approved', 'confirmed', 'posted'].includes(existing.status)) throw forbidden('A submitted or approved payment cannot be changed by the Cashier.');
  }
  if (role === 'cashier' && entity === 'ExpenseRequest') {
    if (existing && ['approved', 'paid'].includes(existing.status) && ['delete', 'deleteMany'].includes(operation)) throw forbidden('Approved and paid expense vouchers cannot be deleted by the Cashier.');
    if (['approved', 'rejected', 'paid'].includes(value.status) || ['approved_by', 'approved_at', 'rejected_by', 'rejected_at'].some(key => key in value)) throw forbidden('Managers approve expense requests; use the checked cash desk to pay them.');
    if (existing && ['approved', 'paid'].includes(existing.status) && Object.keys(value).some(key => !['receipt_url', 'receipt_collected_at'].includes(key))) throw forbidden('An approved or paid expense may only have its receipt filed by the Cashier.');
  }
  if (entity === 'Payment' && (value.payment_type === 'customer_payment' || existing?.payment_type === 'customer_payment')) throw forbidden('Use the customer receipt approval workflow.');
  if (entity === 'Payment' && ['cheque_gm_signed_at','cheque_gm_signed_by','approved_by','approved_at'].some(key=>key in value)) throw forbidden('This payment signature requires the General Manager.');
  if (entity === 'Payment' && role !== 'production_manager' && ['cheque_pm_signed_at','cheque_pm_signed_by'].some(key=>key in value)) throw forbidden('This signature requires the Operations Manager.');
  if (entity === 'ExpenseRequest' && value.requester_id && value.requester_id !== context.employee?.id && !['cashier','production_manager'].includes(role)) throw forbidden('Expense ownership cannot be reassigned.');
  if (entity === 'CompanySettings') {
    if (operation !== 'update' || Object.keys(value).some(key=>!key.startsWith('next_') || !Number.isInteger(value[key]) || value[key] !== Number(existing?.[key] || 1)+1)) throw forbidden('Only the next document sequence can be advanced.');
  }
  if (entity === 'Payment' && role === 'production_manager' && (operation !== 'update' || Object.keys(value).some(key=>!['cheque_pm_signed_at','cheque_pm_signed_by','status'].includes(key)))) throw forbidden('Operations Manager can only add their cheque signature.');
  if (entity === 'Payment' && role === 'production_manager' && value.status && (value.status !== 'confirmed' || !existing?.cheque_gm_signed_by || !(value.cheque_pm_signed_by || existing?.cheque_pm_signed_by))) throw forbidden('Both cheque signatures are required before confirmation.');
  if (entity === 'Payment' && role === 'cashier' && existing?.payment_method === 'cheque' && ['confirmed','posted'].includes(value.status) && (!existing.cheque_gm_signed_by || !existing.cheque_pm_signed_by)) throw forbidden('Both cheque signatures are required before payment.');
  if (entity === 'PurchaseOrder' && (value.status === 'approved' || ['approved_by','approved_at'].some(key=>key in value))) throw forbidden('Purchase orders require General Manager approval.');
  if (entity === 'ProductionOrder' && (value.status === 'approved' || ['approved_by','approved_at'].some(key=>key in value))) throw forbidden('Production orders require General Manager approval.');
  if (entity === 'ExpenseRequest' && !['production_manager','cashier'].includes(role) && (['approved','paid','rejected'].includes(value.status) || ['approved_by','approved_at'].some(key=>key in value))) throw forbidden('This expense decision requires a manager.');
}
export function visibleRecord(context, entity, row) {
  if (!row || effectiveRole(context.user,context.employee) === 'admin') return row;
  if (entity === 'Employee' && row.id !== context.employee?.id) return Object.fromEntries(['id','full_name','role','status'].map(key=>[key,row[key]]));
  if (entity === 'User') { const { auth_user_id, ...profile } = row; return profile; }
  return row;
}
