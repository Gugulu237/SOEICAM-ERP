import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,user} from './helpers/cashier.mjs';
import {fourStageFixture,act,asRole} from './helpers/four-stage-yogurt.mjs';
import {supplierAction} from '../src/server/domain/supplier-workspace.js';
import {supplierMaterial,supplierCatalogue} from '../src/lib/supplier-catalogue.js';
import {catalogueFromStored} from '../src/server/domain/role-catalogue.js';
import {employeeRoleChange} from '../src/server/domain/employee-role-change.js';
import {staffRoleAction} from '../src/server/domain/staff-role-management.js';
import {isPackagingItem,isStickerItem} from '../src/lib/inventory-packaging.js';
import {yogurtItemFlavour,yogurtPackingMaterials} from '../src/lib/yogurt-product-materials.js';
import {productRecipeDraft} from '../src/lib/yogurt-recipe-presets.js';
import {recipeBucketPlan,yogurtRequirements} from '../src/lib/yogurt-production.js';
import {idelleCashierAssignment} from '../src/server/domain/local-staff-reassignment.js';

test('supplier catalogues accept every stock component and exclude own finished products and services',async()=>{
  const f=await fixture(),s=f.entities;await s.Employee.update('cashier',{role:'procurement'});
  const materials=await Promise.all(['raw_material','inventory_part','inventory_item','consumable','additive','packaging'].map((type,i)=>s.Product.create({name:type+' component',inventory_type:type,unit_of_measure:i%2?'ea':'kg',is_active:true})));
  const forbidden=await Promise.all(['assembly','finished_product','service'].map(type=>s.Product.create({name:type,inventory_type:type,is_active:true,unit_of_measure:'ea'})));
  const call=body=>supplierAction(f.client,user,body),list=await call({action:'supplierWorkspace'});
  assert.ok(materials.every(item=>list.products.some(row=>row.id===item.id)));assert.ok(forbidden.every(item=>!list.products.some(row=>row.id===item.id)));
  const body={action:'saveSupplier',requestKey:crypto.randomUUID(),supplier:{name:'Component vendor',supplier_items:materials.map(item=>({product_id:item.id,unit_price:10}))}};
  const {supplier}=await call(body);assert.equal(supplier.supplier_items.length,materials.length);
  assert.equal(supplierCatalogue(supplier,list.products).length,materials.length);
  for(const item of forbidden){assert.equal(supplierMaterial(item),false);await assert.rejects(call({...body,requestKey:crypto.randomUUID(),supplier:{...body.supplier,supplier_items:[{product_id:item.id,unit_price:1}]}}),/registered active items/);}
});

test('primary-role changes preserve the employee account and salary while clearing the previous active role',async()=>{
  const catalogue=catalogueFromStored(null),person={id:'idelle-fixture',full_name:'Idelle',role:'warehouse_manager',staff_active_role:'warehouse_manager',user_id:'same-sign-in',base_salary:125000,staff_roles_revision:2,staff_role_assignments:[{role_key:'cashier',from_date:'2026-01-01',notes:'Cover cashier'}]},context={user:{id:'gm'},role:'admin'};
  const saved={...person,...employeeRoleChange(person,{role:'cashier'},catalogue,context)};
  assert.equal(saved.id,person.id);assert.equal(saved.user_id,person.user_id);assert.equal(saved.base_salary,person.base_salary);assert.equal(saved.role,'cashier');assert.equal(saved.staff_active_role,'cashier');assert.equal(saved.staff_roles_revision,3);assert.deepEqual(saved.staff_role_assignments,[]);
  assert.throws(()=>employeeRoleChange(person,{role:'cashier'},catalogue,{user:{id:'other'},role:'warehouse_manager'}),{status:403});
  assert.equal(employeeRoleChange(saved,{phone:'123'},catalogue,context).phone,'123');
});

test('the local Idelle correction requires a unique active warehouse employee and is safe to retry',()=>{
 const catalogue=catalogueFromStored(null),employee={id:'idelle-only',full_name:'Idelle Example',role:'warehouse_manager',status:'active'};
 assert.equal(idelleCashierAssignment([employee],catalogue).employee.id,employee.id);
 assert.equal(idelleCashierAssignment([{...employee,role:'cashier',staff_active_role:'cashier'}],catalogue).reused,true);
 assert.throws(()=>idelleCashierAssignment([employee,{...employee,id:'another'}],catalogue),/exactly one/);
 assert.throws(()=>idelleCashierAssignment([{...employee,role:'commercial'}],catalogue),/not Warehouse Keeper/);
 assert.throws(()=>idelleCashierAssignment([{...employee,status:'terminated'}],catalogue),/inactive/);
});

test('explicit employee reassignment is version checked, audited and safe to retry',async()=>{
  const f=await fixture(),s=f.entities;await s.Employee.update('cashier',{full_name:'Idelle',role:'warehouse_manager',staff_active_role:'warehouse_manager',base_salary:125000,staff_roles_revision:0});
  const context={user:{id:'gm'},role:'admin'},options={loadSettings:async()=>({id:'settings'}),saveSettings:async()=>{}},body={action:'changePrimaryRole',employeeId:'cashier',roleKey:'cashier',revision:0,reason:'Owner requested reassignment',useRoleResponsibilities:true};
  const result=await staffRoleAction(s,context,body,options);assert.equal(result.employee.role,'cashier');assert.equal(result.employee.staff_active_role,'cashier');assert.equal(result.employee.base_salary,125000);
  assert.equal((await staffRoleAction(s,context,body,options)).reused,true);
  assert.equal((await s.AuditLog.filter({action:'reassign_primary_staff_role'})).length,1);
  await assert.rejects(staffRoleAction(s,context,{...body,roleKey:'warehouse_manager'},options),{status:409});
});

test('unclassified inventory-part stickers are recognized as packaging and one 500 g bucket requires 52 stickers',async()=>{
  const f=await fourStageFixture({flavors:['Nature'],bucketsPerProduct:1,createOrder:false}),s=f.entities,label=f.labels[0];
  await s.Product.update(label.id,{name:'Étiquette Nature 500g',material_group:''});
  assert.equal(isStickerItem(await s.Product.get(label.id)),true);assert.equal(isPackagingItem(await s.Product.get(label.id)),true);
  const saved=(await act(f,'saveYogurtRecipe',{name:'One bucket with sticker',config:f.config})).recipe;
  await act(f,'approveYogurtRecipe',{recipeId:saved.id});
  const rows=yogurtRequirements(saved.yogurt_config,recipeBucketPlan(saved.yogurt_config));assert.equal(rows.find(row=>row.material_id===label.id).quantity,52);
  const lot=(await s.StockBalance.filter({product_id:label.id}))[0];await s.StockBalance.update(lot.id,{quantity:51,total_value:5.1});
  const result=await act(f,'saveYogurtPlan',{plan:{...f.plan,recipe_id:saved.id},status:'awaiting_approval',requestKey:crypto.randomUUID()});
  assert.equal(result.blocked,true);assert.ok(result.shortages.some(row=>row.material_id===label.id&&row.required===52));assert.equal((await s.ProductionOrder.filter({})).length,0);
});

test('sticker selection distinguishes flavours and sizes and never guesses between duplicate matching labels',()=>{
  const product={id:'finished',name:'Brasse Nature 500g',inventory_type:'assembly',product_family:'Yaourt brasse',flavor:'Nature',size:'500 g',components:[{product_id:'cups',quantity:1,unit:'ea'}]},cup={id:'cups',name:'Cup',inventory_type:'packaging',unit_of_measure:'ea'},label={id:'label',name:'Sticker Nature 500g',inventory_type:'inventory_part',unit_of_measure:'ea',is_active:true};
  const rows=yogurtPackingMaterials(product,[cup,label],{require_sticker:true});assert.deepEqual(rows.find(row=>row.material_id==='label'),{material_id:'label',quantity:1,unit:'ea'});
  assert.throws(()=>yogurtPackingMaterials(product,[cup,label,{...label,id:'second'}],{require_sticker:true}),/Select the matching sticker/);
  assert.throws(()=>yogurtPackingMaterials(product,[cup,{...label,name:'Sticker Strawberry 500g'}],{require_sticker:true,sticker_material_id:'label'}),/must match/);
  assert.throws(()=>yogurtPackingMaterials(product,[cup,{...label,name:'Sticker Nature 250g'}],{require_sticker:true,sticker_material_id:'label'}),/must match/);
});

test('pure unsweetened is recognized from Nature non-sucre names, has no flavour ingredients and does not require a sugar inventory item',async()=>{
  assert.equal(yogurtItemFlavour({name:'YOLA Yaourt Nature Non Sucré 500g'}),'Non sucré');
  const f=await fourStageFixture({flavors:['Non sucré'],bucketsPerProduct:1,createOrder:false}),s=f.entities;
  const stale=structuredClone(f.config);stale.blends[0].materials=[{recipe_role:'sugar',material_id:f.sugar.id,quantity:2.5,unit:'kg'}];
  const draft=productRecipeDraft(f.products[0],stale,await s.Product.filter({}));assert.deepEqual(draft.blend.materials,[]);assert.equal(stale.blends[0].materials.length,1);
  await s.Product.deleteMany({id:f.sugar.id});
  const saved=(await act(f,'saveYogurtRecipe',{name:'Pure unsweetened',config:f.config})).recipe;
  assert.deepEqual(saved.yogurt_config.blends[0].materials,[]);assert.equal(yogurtRequirements(saved.yogurt_config,recipeBucketPlan(saved.yogurt_config)).some(row=>row.stage==='flavouring'),false);
});

test('a recipe save retried after an interrupted response does not create a second draft',async()=>{
  const f=await fourStageFixture({flavors:['Nature'],bucketsPerProduct:1,createOrder:false}),body={name:'Retry-safe recipe',config:f.config,recipeId:f.recipe.id,requestKey:crypto.randomUUID()};
  const first=await act(f,'saveYogurtRecipe',body),second=await act(f,'saveYogurtRecipe',body);
  assert.equal(first.recipe.id,second.recipe.id);assert.equal(second.reused,true);assert.equal((await f.entities.Recipe.filter({recipe_name:body.name})).length,1);
  await assert.rejects(act(f,'saveYogurtRecipe',{...body,name:'Changed payload'}),/already used/);
});

test('removing an existing recipe preserves production history and prevents new plans; retry does not duplicate its audit',async()=>{
  const f=await fourStageFixture({flavors:['Nature'],bucketsPerProduct:1}),s=f.entities,original=await s.ProductionOrder.get(f.order.id),stock=await s.StockBalance.filter({});
  await asRole(f,'warehouse_manager');await assert.rejects(act(f,'removeManufacturingRecipe',{recipeId:f.recipe.id}),{status:403});await asRole(f,'production_manager');
  const result=await act(f,'removeManufacturingRecipe',{recipeId:f.recipe.id,reason:'Replace formula'});assert.equal(result.archived,true);assert.equal(result.recipe.status,'archived');
  assert.deepEqual(await s.ProductionOrder.get(f.order.id),original);assert.deepEqual(await s.StockBalance.filter({}),stock);
  assert.equal((await act(f,'removeManufacturingRecipe',{recipeId:f.recipe.id})).reused,true);assert.equal((await s.AuditLog.filter({action:'remove_manufacturing_recipe'})).length,1);
  await assert.rejects(act(f,'saveYogurtPlan',{plan:f.plan,status:'awaiting_approval',requestKey:crypto.randomUUID()}),/approved yogurt recipe/);
});
