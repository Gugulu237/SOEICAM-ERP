import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueFromStored, validateRoleProfile, decorateEmployee, assertModule, assertEntityModule, moduleForPath, TEMPLATE_MODULES } from '../src/server/domain/role-catalogue.js';
import { effectiveRole } from '../src/server/domain/roles.js';
import { purchasePermissions, purchaseSections } from '../src/lib/purchase-workspace.js';
import { ROLE_DEFINITIONS, roleLabel } from '../src/lib/permissions.js';
import { organizeRoles, moveOrganigramRole, validateOrganigramLayout } from '../src/lib/role-organigram.js';

test('organigram places production support with Operations, field partners together, and GM at the root', () => {
  const custom = [
    { key:'route_coordinator',label:'Route Coordinator',category:'Operations',template_role:'driver' },
    { key:'stock_controller',label:'Stock Controller',category:'Management',template_role:'warehouse_manager' },
    { key:'payments_clerk',label:'Payments Clerk',category:'Finance',template_role:'cashier' },
    { key:'productionassistants',label:'Production Assistants',category:'Operations',template_role:'warehouse_manager' },
  ];
  const chart = organizeRoles([...ROLE_DEFINITIONS,...custom]);
  assert.equal(chart.generalManager.key,'admin');
  const group = key => chart.groups.find(item => item.key === key).roles.map(role => role.key);
  assert.deepEqual(group('leadership'),['production_manager','supply_chain_manager','stock_controller']);
  assert.deepEqual(group('production'),['employee','productionassistants']);
  assert.deepEqual(group('field'),['commercial','driver','hotesse','route_coordinator']);
  assert.deepEqual(group('stock'),['procurement','warehouse_manager']);
  assert.deepEqual(group('finance'),['cashier','payments_clerk']);
  const shown = [chart.generalManager.key,...chart.groups.flatMap(group => group.roles.map(role => role.key))];
  assert.equal(new Set(shown).size,shown.length);
  assert.deepEqual(new Set(shown),new Set([...ROLE_DEFINITIONS,...custom].map(role => role.key)));
  const moved = moveOrganigramRole(chart.layout,'productionassistants','field','driver');
  assert.deepEqual(moved.field,['commercial','productionassistants','driver','hotesse','route_coordinator']);
  assert.ok(!moved.production.includes('productionassistants'));
  assert.deepEqual(validateOrganigramLayout(moved,[...ROLE_DEFINITIONS,...custom]),moved);
  assert.throws(() => validateOrganigramLayout({ ...moved,field:[...moved.field,'admin'] },[...ROLE_DEFINITIONS,...custom]));
  assert.throws(() => validateOrganigramLayout({ ...moved,field:[...moved.field,'driver'] },[...ROLE_DEFINITIONS,...custom]));
  assert.deepEqual(organizeRoles([...ROLE_DEFINITIONS,...custom],moved).layout,moved);
});

test('Supply Chain Manager appears with the management roles, including older saved profiles', () => {
  assert.equal(ROLE_DEFINITIONS.find(role => role.key === 'supply_chain_manager')?.category,'Management');
  assert.equal(roleLabel('admin'),'General Manager');
  const previouslySaved = { revision:1,roles:{ supply_chain_manager:{ ...catalogueFromStored().roles.supply_chain_manager,category:'Operations' } } };
  assert.equal(catalogueFromStored(previouslySaved).roles.supply_chain_manager.category,'Management');
  assert.throws(() => validateRoleProfile({ ...catalogueFromStored().roles.supply_chain_manager,category:'Operations' },catalogueFromStored().roles.supply_chain_manager),/Management team/);
});

test('Supply Chain Manager inherits warehouse checks and operational modules, never GM rights', () => {
  const catalogue = catalogueFromStored(null);
  const profile = catalogue.roles.supply_chain_manager;
  assert.equal(profile.template_role,'warehouse_manager');
  assert.ok(profile.modules.includes('distribution'));
  assert.ok(profile.modules.includes('purchases'));
  assert.ok(!profile.modules.includes('admin'));
  const user = { role:'user' }, employee = decorateEmployee(user,{ role:'supply_chain_manager', status:'active' },catalogue);
  assert.equal(effectiveRole(user,employee),'warehouse_manager');
  assert.equal(employee.role_label,'Supply Chain Manager');
  assert.doesNotThrow(() => assertModule({ role:'warehouse_manager',employee },'distribution'));
  assert.doesNotThrow(() => assertModule({ role:'warehouse_manager',employee },'accounting'));
  assert.throws(() => assertModule({ role:'warehouse_manager',employee },'payroll'),{ status:403 });
});

test('GM changes narrow existing and custom roles immediately; invalid privileges fail closed', () => {
  const template = catalogueFromStored().roles.warehouse_manager;
  const narrowed = validateRoleProfile({ ...template, key:'warehouse_manager', label:'Warehouse Manager', category:'Operations', summary:'Warehouse', duties:[], modules:['inventory'] },template);
  const catalogue = catalogueFromStored({ revision:2,roles:{ warehouse_manager:narrowed } });
  const employee = decorateEmployee({ role:'user' },{ role:'warehouse_manager' },catalogue);
  assert.deepEqual(employee.allowed_modules,['inventory']);
  assert.throws(() => assertEntityModule({ role:'warehouse_manager',employee },'Dispatch','create'),{ status:403 });
  assert.throws(() => assertModule({ role:'warehouse_manager',employee },'distribution'),{ status:403 });
  assert.deepEqual(validateRoleProfile({ ...narrowed,modules:['inventory','admin','sales_reports'] },template).modules,['inventory','admin','sales_reports']);
  assert.throws(() => validateRoleProfile({ ...narrowed,modules:['unknown_module'] },template));
  assert.throws(() => validateRoleProfile({ ...narrowed,key:'admin',template_role:'admin' }));
  const custom = validateRoleProfile({ key:'logistics_coordinator', label:'Logistics Coordinator', category:'Operations', summary:'Coordinate stock', duties:[], template_role:'warehouse_manager',modules:['inventory','distribution'] });
  assert.deepEqual(custom.modules,['inventory','distribution']);
  assert.ok(!TEMPLATE_MODULES.warehouse_manager.includes('accounting'));
  assert.equal(moduleForPath('/purchases/new'),'purchases');
  assert.equal(purchasePermissions('warehouse_manager','supply_chain_manager').suppliers,true);
  assert.equal(purchasePermissions('warehouse_manager','supply_chain_manager').pay,false);
  assert.equal(purchasePermissions('warehouse_manager').suppliers,false);
  assert.ok(purchaseSections('warehouse_manager','supply_chain_manager').some(section => section.key === 'suppliers'));
});

test('legacy string-encoded role catalogues retain saved roles and revisions for editing', () => {
  const custom = validateRoleProfile({ key:'productionassistants', label:'Production Assistants', category:'Operations', summary:'Production support', duties:[], template_role:'employee', modules:['inventory'] });
  const legacy = JSON.stringify({ revision:1, roles:{ productionassistants:custom } });
  const catalogue = catalogueFromStored(legacy);
  assert.equal(catalogue.revision,1);
  assert.equal(catalogue.roles.productionassistants.label,'Production Assistants');
  assert.deepEqual(decorateEmployee({ role:'user' },{ role:'productionassistants' },catalogue).allowed_modules,['inventory']);
  const edited = validateRoleProfile({ ...catalogue.roles.productionassistants, label:'Production Support', modules:['inventory','expenses'] },catalogue.roles.productionassistants);
  assert.equal(edited.label,'Production Support');
  assert.deepEqual(catalogueFromStored('{invalid').roles.productionassistants,undefined);
});

test('Unknown legacy employee roles cannot gain active modules', () => {
  const employee = decorateEmployee({ role:'user' },{ role:'unrecognized' },catalogueFromStored());
  assert.deepEqual(employee.allowed_modules,[]);
  assert.equal(effectiveRole({ role:'user' },employee),'employee');
  assert.throws(() => assertEntityModule({ role:'employee',employee },'Customer','list'),{ status:403 });
});

test('Super Admin can edit installed modules and operational templates for every role while retaining its recovery controls',()=>{
  const catalogue=catalogueFromStored(),warehouse=catalogue.roles.warehouse_manager;
  const changed=validateRoleProfile({...warehouse,label:'Warehouse Manager',category:'Operations',summary:'Stock and reporting',template_role:'production_manager',modules:['inventory','sales_reports','accounting']},warehouse);
  assert.equal(changed.template_role,'production_manager');
  assert.deepEqual(catalogueFromStored({roles:{warehouse_manager:changed}}).roles.warehouse_manager.modules,changed.modules);
  assert.throws(()=>validateRoleProfile({...changed,template_role:'admin'}));
  assert.throws(()=>validateRoleProfile({...changed,template_role:'constructor'}));
  const admin=validateRoleProfile({...catalogue.roles.admin,label:'Super Admin',category:'Management',summary:'System administrator',modules:['admin','employees','sales_reports']},catalogue.roles.admin);
  const context={role:'admin',roleCatalogue:catalogueFromStored({roles:{admin}})};
  assert.doesNotThrow(()=>assertModule(context,'sales_reports'));
  assert.doesNotThrow(()=>assertModule(context,'admin'));
  assert.throws(()=>assertModule(context,'payroll'),{status:403});
  assert.throws(()=>assertEntityModule(context,'PayrollLine','filter'),{status:403});
  assert.throws(()=>validateRoleProfile({...admin,modules:['sales_reports']}));
  assert.equal(moduleForPath('/sales-reports'),'sales_reports');
});

test('Supply Chain receives sales-report access on legacy profiles and an explicit revocation stays revoked',()=>{
  const current=catalogueFromStored().roles.supply_chain_manager;
  assert.ok(current.modules.includes('sales_reports'));
  const legacy={...current,modules:['inventory','distribution']};delete legacy.module_permissions_version;
  assert.ok(catalogueFromStored({roles:{supply_chain_manager:legacy}}).roles.supply_chain_manager.modules.includes('sales_reports'));
  const revoked=validateRoleProfile({...current,modules:['inventory']},current);
  assert.deepEqual(catalogueFromStored({roles:{supply_chain_manager:revoked}}).roles.supply_chain_manager.modules,['inventory']);
});

test('inventory adjustment is a separate role permission; upgrades preserve warehouse access and later revocations remain revoked',()=>{
 const old=catalogueFromStored({roles:{warehouse_manager:{template_role:'warehouse_manager',modules:['inventory'],module_permissions_version:3},cashier:{template_role:'cashier',modules:['accounting'],module_permissions_version:3}}});
 assert.ok(old.roles.warehouse_manager.modules.includes('inventory_adjustments'));assert.ok(!old.roles.cashier.modules.includes('inventory_adjustments'));
 const narrowed=validateRoleProfile({...old.roles.warehouse_manager,label:'Warehouse',category:'Operations',modules:['inventory']});assert.equal(narrowed.module_permissions_version,5);assert.ok(!catalogueFromStored({roles:{warehouse_manager:narrowed}}).roles.warehouse_manager.modules.includes('inventory_adjustments'));
});
