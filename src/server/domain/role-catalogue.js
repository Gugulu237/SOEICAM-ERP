// A managed role inherits its existing server-side transaction checks from a
// non-admin template. The module selection may only narrow those permissions.
import { ROLE_KEYS, normalizeRole } from './roles.js';
import {ui} from '../../lib/i18n.js';
import { activeStaffRole,deletedRoleKeys } from '../../lib/staff-role-assignments.js';
import { businessDate } from '../../lib/business-date.js';

export const MODULES = [
  ['purchases','Purchases & suppliers'], ['inventory','Inventory'], ['inventory_adjustments','Inventory quantity adjustments'],
  ['manufacturing','Manufacturing production'], ['quality','Manufacturing quality & batches'],
  ['distribution','Distribution & deliveries'], ['sales','Sales'],
  ['customers','Customers'], ['commercial','Commercial workspace'],
  ['outlets','Outlet reporting'], ['cashier','Cashier & handovers'],
  ['accounting','Accounting'], ['expenses','Expenses'], ['approvals','Operational approvals'],
  ['employees','Employees & roles'], ['payroll','Payroll'], ['admin','Administration'],
  ['reports','Reports & cockpit'], ['sales_reports','Sales analysis (read only)'],
].map(([key,label]) => ({ key,get label(){return ui(label);} }));

export const TEMPLATE_MODULES = {
  admin: MODULES.map(m => m.key),
  procurement:['purchases','inventory','expenses','approvals'],
  warehouse_manager:['purchases','inventory','inventory_adjustments','manufacturing','quality','distribution','expenses','approvals'],
  production_manager:['accounting','purchases','inventory','manufacturing','quality','distribution','sales','commercial','cashier','expenses','approvals'],
  cashier:['purchases','cashier','payroll','accounting','expenses'],
  employee:['purchases','inventory','distribution','sales','customers','expenses'],
  commercial:['commercial','customers','cashier'],
  driver:['distribution'],
  hotesse:['outlets'],
};

export const SUPPLY_CHAIN_MANAGER = {
  key:'supply_chain_manager', label:'Supply Chain Manager', category:'Management',
  summary:'Coordinates suppliers, purchasing, receiving, inventory, quality and deliveries.',
  duties:['Maintains suppliers and plans replenishment orders','Oversees receiving, stock and batch quality','Coordinates vehicle loads, returns and deliveries'],
  template_role:'warehouse_manager', modules:[...TEMPLATE_MODULES.warehouse_manager,'sales_reports','sales','accounting'],
};
const keyPattern = /^[a-z][a-z0-9_]{2,39}$/;
const categories = ['Management','Finance','Operations','Commercial'];
const defaults = Object.fromEntries(ROLE_KEYS.map(key => [key,{ template_role:key, modules:[...TEMPLATE_MODULES[key]] }]));
const baseLabels = { admin:'General Manager',procurement:'Procurement Officer',warehouse_manager:'Warehouse Manager',production_manager:'Operations / Production Manager',cashier:'Cashier',employee:'Employee',commercial:'Commercial Agent',driver:'Driver',hotesse:'Hotesse' };

export function parseStoredRoleCatalogue(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function catalogueFromStored(stored) {
  stored = parseStoredRoleCatalogue(stored);
  const roles = { ...Object.fromEntries(Object.entries(defaults).map(([key,value]) => [key,{ ...value,key,label:baseLabels[key] }])), supply_chain_manager:SUPPLY_CHAIN_MANAGER };
  for (const [key,profile] of Object.entries(stored?.roles || {})) {
    if (['constructor','prototype','__proto__'].includes(key) || !keyPattern.test(key) || !profile || typeof profile !== 'object') continue;
    const template = key === 'admin' ? 'admin' : profile.template_role || defaults[key]?.template_role || (key === 'supply_chain_manager' ? 'warehouse_manager' : '');
    if (!template || (template === 'admin' && key !== 'admin') || !Object.hasOwn(TEMPLATE_MODULES,template)) continue;
    const max = MODULES.map(m=>m.key);
    const managementDefaults=['admin','production_manager','supply_chain_manager'].includes(key) && Number(profile.module_permissions_version || 0)<3 ? ['sales','accounting','expenses'] : [];
    const adjustmentDefaults=['admin','warehouse_manager','supply_chain_manager'].includes(key) && Number(profile.module_permissions_version || 0)<4 && (!Array.isArray(profile.modules) || profile.modules.includes('inventory'))?['inventory_adjustments']:[];
    const payrollDefaults=template==='cashier' && Number(profile.module_permissions_version || 0)<5 && (!Array.isArray(profile.modules) || profile.modules.includes('cashier'))?['payroll']:[];
    roles[key] = {
      ...profile, key, template_role:template,
      ...(key === 'supply_chain_manager' ? { category:'Management' } : {}),
      modules:Array.isArray(profile.modules) ? [...new Set([...profile.modules.filter(module => max.includes(module)),...managementDefaults,...adjustmentDefaults,...payrollDefaults,...(key==='supply_chain_manager'&&Number(profile.module_permissions_version||0)<2?['sales_reports']:[])])] : [...(key==='supply_chain_manager'?SUPPLY_CHAIN_MANAGER.modules:TEMPLATE_MODULES[template])],
    };
  }
  roles.admin={...roles.admin,key:'admin',template_role:'admin',category:'Management',modules:[...new Set([...(roles.admin.modules||[]),'admin','employees'])]};
  const deleted=deletedRoleKeys(stored);
  for(const key of deleted)if(key!=='admin')delete roles[key];
  return { revision:Number(stored?.revision) || 0, roles, deleted_roles:[...deleted], layout:stored?.layout || null };
}

export function validateRoleProfile(input, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter the role details.');
  const key = String(input.key || '').trim().toLowerCase();
  if (!keyPattern.test(key) || ['__proto__','constructor','prototype'].includes(key)) throw new Error('Use a unique role key with lowercase letters, numbers and underscores. The General Manager role is protected.');
  const template = key==='admin'?'admin':String(input.template_role || defaults[key]?.template_role || '');
  if (!template || (template === 'admin' && key !== 'admin') || !Object.hasOwn(TEMPLATE_MODULES,template) || (key === 'admin' && input.template_role !== 'admin')) throw new Error('Choose an available operational access template. Super Admin authority cannot be inherited.');
  const label = String(input.label || '').trim(), summary = String(input.summary || '').trim();
  if (!label || label.length > 80 || summary.length > 500) throw new Error('Enter a role name (up to 80 characters) and a short description (up to 500).');
  if (!categories.includes(input.category)) throw new Error('Choose a role category.');
  if (key === 'supply_chain_manager' && input.category !== 'Management') throw new Error('Supply Chain Manager belongs to the Management team.');
  if (!Array.isArray(input.modules) || input.modules.length > MODULES.length || input.modules.some(module => !MODULES.some(m=>m.key===module))) throw new Error('Choose existing application modules from the full module catalogue.');
  if(key==='admin'&&(!input.modules.includes('admin')||!input.modules.includes('employees')))throw new Error('Super Admin must retain Administration and Employees & roles access.');
  const duties = Array.isArray(input.duties) ? input.duties.map(v => String(v).trim()).filter(Boolean) : [];
  if (duties.length > 8 || duties.some(v => v.length > 200)) throw new Error('Add up to eight concise responsibilities.');
  return { key,label,category:input.category,summary,duties,template_role:template,modules:[...new Set(input.modules)],module_permissions_version:5 };
}

export function decorateEmployee(user, employee, catalogue) {
  if (!employee || String(user?.role || '').toLowerCase() === 'admin') return employee;
  const primary=normalizeRole(employee.role) || employee.role;
  const profile=activeStaffRole(employee,catalogue,businessDate()),key=profile?.key || primary;
  if (!profile) return { ...employee, access_template:'employee', allowed_modules:[], assigned_role:key, role_label:'Unrecognized role' };
  return { ...employee, primary_role:primary, access_template:profile.template_role, allowed_modules:profile.modules, assigned_role:key, role_label:profile.label || key };
}

export function assertModule(context, module) {
  if(!module)return;
  if(context.role==='admin'){const modules=context.roleCatalogue?.roles?.admin?.modules;if(!modules||['admin','employees'].includes(module)||modules.includes(module))return;throw Object.assign(new Error('This module is disabled in the Super Admin role configuration.'),{status:403});}
  if (!context.employee || !Array.isArray(context.employee.allowed_modules)) return;
  if (!context.employee?.allowed_modules?.includes(module)) throw Object.assign(new Error(`Your role does not allow ${MODULES.find(m => m.key === module)?.label || module}.`), { status:403 });
}

export const entityModules = {
  Product:['inventory','purchases','manufacturing','quality','commercial','outlets'],StockBalance:['inventory','distribution','quality','commercial','outlets'],StockMovement:['inventory','distribution','quality'],Warehouse:['inventory','distribution','commercial'],
  PurchaseOrder:['purchases','approvals'],PurchaseOrderLine:['purchases'],PurchaseItem:['purchases'],GoodsReceipt:['purchases','inventory'],GoodsReceiptLine:['purchases'],Supplier:['purchases'],Bill:['purchases','accounting','cashier'],
  ProductionOrder:['manufacturing','quality'],ProductionMaterial:['manufacturing'],Recipe:['manufacturing'],RecipeLine:['manufacturing'],QualityCheck:['quality'],SpoilageRecord:['quality','distribution'],
  Dispatch:['distribution'],DispatchLine:['distribution'],DispatchRequest:['distribution','approvals'],Route:['distribution','customers'],Vehicle:['distribution'],
  SalesOrder:['sales','commercial','distribution'],SalesOrderLine:['sales'],Invoice:['sales','accounting','cashier'],InvoiceLine:['sales','accounting'],Customer:['customers','sales','commercial','distribution','outlets'],CustomerLocation:['customers','commercial','distribution'],
  CashHandover:['cashier','commercial'],CashCollection:['cashier','commercial'],FieldSale:['commercial'],FieldSaleLine:['commercial'],OutletVisit:['outlets'],
  Payment:['cashier','accounting','purchases'],PaymentAllocation:['cashier','accounting'],TreasuryAccount:['cashier','accounting'],TreasuryTransaction:['cashier','accounting'],
  Account:['accounting','cashier','inventory','manufacturing'],AccountingPeriod:['accounting','manufacturing'],JournalEntry:['accounting'],JournalLine:['accounting'],PostingRule:['accounting','inventory','manufacturing','commercial'],FixedAsset:['accounting'],DepreciationEntry:['accounting'],
  ExpenseRequest:['expenses','approvals'],Budget:['expenses'],PayrollRun:['payroll'],PayrollLine:['payroll'],Employee:['employees','distribution','commercial','outlets'],User:['employees'],Department:['employees','expenses'],Branch:['admin','distribution'],CompanySettings:['admin','inventory','distribution','sales','purchases'],AuditLog:['admin'],
};

export function assertEntityModule(context, entity, operation) {
  if(context.role==='admin'){const modules=context.roleCatalogue?.roles?.admin?.modules;if(!modules)return;const choices=entityModules[entity]||[];if(choices.some(m=>['admin','employees'].includes(m)||modules.includes(m)))return;throw Object.assign(new Error('This module is disabled in the Super Admin role configuration.'),{status:403});}
  if (!context.employee || !Array.isArray(context.employee.allowed_modules)) return;
  const choices = entityModules[entity] || [];
  const writes = ['create','bulkCreate','update','updateMany','delete','deleteMany'].includes(operation);
  const required = writes && entity === 'Product' ? ['inventory'] : writes && entity === 'Supplier' ? ['purchases'] : choices;
  if (!required.some(module => context.employee?.allowed_modules?.includes(module))) throw Object.assign(new Error('Your role does not allow this module.'),{ status:403 });
}

export function moduleForPath(path) {
  const [pathname,query='']=String(path || '').split('?');
  const root = '/' + pathname.split('/').filter(Boolean)[0];
  if(root==='/team-workspaces'&&new URLSearchParams(query).get('section')==='payroll')return 'payroll';
  if(root==='/manufacturing' && pathname.replace(/\/+$/,'')==='/manufacturing' && new URLSearchParams(query).get('section')==='quality')return 'quality';
  const paths = { '/purchases':'purchases','/suppliers':'purchases','/inventory':'inventory','/items':'inventory','/manufacturing':'manufacturing','/quality':'quality','/expiry':'quality','/traceability':'quality','/distribution':'distribution','/driver':'distribution','/custody':'distribution','/supply-chain':'inventory','/sales':'sales','/sales-reports':'sales_reports','/customers':'customers','/field-customers':'customers','/commercial':'commercial','/field-sales':'commercial','/commercial-performance':'commercial','/outlet-reports':'outlets','/hotesse':'outlets','/cashier':'cashier','/cash-handovers':'cashier','/accounting':'accounting','/finance-pulse':'accounting','/expenses':'expenses','/approvals':'approvals','/employees':'employees','/team-workspaces':'employees','/payroll':'payroll','/admin':'admin','/reports':'reports','/cockpit':'reports' };
  return paths[root] || null;
}
