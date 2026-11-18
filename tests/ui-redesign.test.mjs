import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileNavigationItems,groupNavigationItems} from '../src/lib/ui-navigation.js';
import {readableError} from '../src/lib/ui-errors.js';
import {registerFormGuard,canLeaveForms} from '../src/lib/form-navigation-guard.js';
import {formatXAF,formatAccountingXAF} from '../src/lib/formatters.js';
import {setLanguage} from '../src/lib/i18n.js';

const items=['/','/sales','/commercial','/inventory','/customers','/cashier','/expenses','/team-workspaces','/manufacturing','/accounting','/sales-reports'].map(path=>({path}));
test('frequent navigation follows job responsibilities and never inserts an unauthorized destination',()=>{
  const paths=role=>mobileNavigationItems(role,items).map(item=>item.path);
  assert.deepEqual(paths('commercial'),['/','/commercial','/customers','/sales-reports']);
  assert.deepEqual(paths('cashier'),['/','/cashier','/expenses','/team-workspaces']);
  assert.deepEqual(paths('production_manager'),['/','/manufacturing','/inventory','/sales-reports']);
  assert.deepEqual(paths('warehouse_manager'),['/','/accounting','/inventory','/sales-reports']);
  const permitted=items.filter(item=>['/','/sales-reports'].includes(item.path));
  assert.deepEqual(mobileNavigationItems('commercial',permitted).map(item=>item.path),['/','/sales-reports']);
  assert.ok(!paths('hotesse').includes('/commercial'));
  assert.equal(new Set(groupNavigationItems(items).map(item=>item.path)).size,items.length);
});
test('navigation is blocked by an edited form until the employee accepts or the form is cleared',()=>{
  let allow=false;const dispose=registerFormGuard(()=>allow);
  try{assert.equal(canLeaveForms(),false);allow=true;assert.equal(canLeaveForms(),true);allow=false;assert.equal(canLeaveForms(),false);}finally{dispose();}
  assert.equal(canLeaveForms(),true,'unmounted or saved forms cannot trap later navigation');
});
test('actionable business errors remain intact while session, network and database details are readable',()=>{
  assert.equal(readableError('Only 3 units are available.'),'Only 3 units are available.');
  assert.match(readableError('Failed to fetch'),/connection failed/i);
  assert.match(readableError('PostgresError: invalid input syntax for type uuid: secret-id'),/operation could not be completed/);
  assert.doesNotMatch(readableError('PostgresError: invalid input syntax for type uuid: secret-id'),/secret-id|uuid|Postgres/);
  assert.match(readableError('Unauthorized',401),/session has expired/);
});
test('FCFA displays preserve negative balances and accounting precision in both languages',()=>{
  for(const language of ['en','fr']){setLanguage(language);assert.match(formatXAF(1234500),/FCFA$/);assert.match(formatXAF(-12),/^-/);assert.match(formatAccountingXAF(12.25),language==='fr'?/12,25 FCFA/:/12\.25 FCFA/);assert.doesNotMatch(formatAccountingXAF(null),/^0/);}
  setLanguage('en');
});
