import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_DEFINITIONS } from '../src/lib/permissions.js';
import { normalizeOrganigramLayout, sortEmployeesByHierarchy, organizeRoles, validateOrganigramLayout } from '../src/lib/role-organigram.js';

test('directory sorts GM, operational leadership, team responsibilities and staff before applying pagination',()=>{
  const definitions=[...ROLE_DEFINITIONS,{key:'assistant',category:'Operations',label:'Production assistant',template_role:'employee'},{key:'controller',category:'Management',label:'Controller',template_role:'warehouse_manager'}];
  const records=[{id:'x',role:'unknown',full_name:'Unknown'},...definitions.map((role,i)=>({id:String(i),role:role.key,full_name:role.label})).reverse()];
  const before=structuredClone(records),rows=sortEmployeesByHierarchy(records,definitions);
  assert.deepEqual(rows.slice(0,4).map(r=>r.role),['admin','production_manager','supply_chain_manager','controller']);
  assert.equal(rows.at(-1).role,'hotesse');assert.deepEqual(records,before);
  assert.ok(rows.findIndex(r=>r.role==='warehouse_manager')<rows.findIndex(r=>r.role==='commercial'));
});
test('staff in a shared role sort predictably by name and ID without assuming extra authority from their template',()=>{
  const rows=sortEmployeesByHierarchy([{id:'b',role:'commercial',full_name:'Zoe'},{id:'d',role:'commercial',full_name:'Alice'},{id:'a',role:'commercial',full_name:'Alice'},{id:'custom',role:'custom',full_name:'A'}],[...ROLE_DEFINITIONS,{key:'custom',label:'Custom',category:'Operations',template_role:'admin'}]);
  assert.deepEqual(rows.filter(r=>r.role==='commercial').map(r=>r.id),['a','d','b']);assert.notEqual(rows[0].role,'admin');
});
test('formation shows every role once and separates outlet reporting from production while preserving saved team placements',()=>{
  const defs=[...ROLE_DEFINITIONS,{key:'assistant',label:'Production Assistants',category:'Operations',template_role:'employee'}],fresh=organizeRoles(defs);
  assert.equal(fresh.generalManager.key,'admin');assert.ok(fresh.layout.field.includes('hotesse'));assert.ok(!fresh.layout.production.includes('hotesse'));
  const shown=[fresh.generalManager.key,...fresh.groups.flatMap(g=>g.roles.map(r=>r.key))];assert.equal(new Set(shown).size,defs.length);
  const saved=normalizeOrganigramLayout(defs,{production:['hotesse','assistant'],field:['commercial','driver']});
  assert.ok(organizeRoles(defs,saved).layout.production.includes('hotesse'));assert.deepEqual(validateOrganigramLayout(saved,defs),saved);
});
test('custom assistant roles follow their actual function rather than being classified as factory staff by their title',()=>{
  const chart=organizeRoles([
    ...ROLE_DEFINITIONS,
    {key:'sales_assistant',label:'Sales Assistant',category:'Commercial',template_role:'commercial'},
    {key:'accounting_assistant',label:'Accounting Assistant',category:'Finance',template_role:'cashier'},
    {key:'production_director',label:'Production Director',category:'Management',template_role:'production_manager'},
  ]);
  assert.ok(chart.layout.field.includes('sales_assistant'));assert.ok(chart.layout.finance.includes('accounting_assistant'));assert.ok(chart.layout.leadership.includes('production_director'));
});
