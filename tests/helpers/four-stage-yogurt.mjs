import {fixture,user,date} from './cashier.mjs';
import {yogurtAction} from '../../src/server/domain/yogurt-production.js';
import {newPhasedRecipe,productRecipeDraft,commitProductDraft} from '../../src/lib/yogurt-recipe-presets.js';
import {recipeBucketPlan} from '../../src/lib/yogurt-production.js';
export {user,date};
export const act=(f,action,extra={})=>yogurtAction(f.client,user,{action,orderId:f.order?.id,...extra});
export const asRole=(f,role)=>f.entities.Employee.update('cashier',{role,assigned_role:role});
export const quantity=async(f,item)=>(await f.entities.StockBalance.filter({product_id:item.id})).reduce((n,row)=>n+Number(row.quantity),0);
export async function fourStageFixture({db,family='brasse',flavors=['Non sucré','Nature','Chocolat','Vanille','Fraise'],bucketsPerProduct=2,createOrder=true}={}){
 const f=await fixture(db),s=f.entities;await asRole(f,'production_manager');
 const raw=await s.Warehouse.create({name:'Recipe ingredients',warehouse_type:'raw_material',is_active:true}),packs=await s.Warehouse.create({name:'Recipe packaging',warehouse_type:'packaging',is_active:true}),cold=await s.Warehouse.create({name:'Cold Room',warehouse_type:'cold_room',is_active:true});
 const make=async(name,unit,type='raw_material',cost=1,extra={})=>{const p=await s.Product.create({name,unit_of_measure:unit,inventory_type:type,is_active:true,configuration_status:'ready',...extra});await s.StockBalance.create({product_id:p.id,product_name:name,warehouse_id:type==='packaging'||extra.material_group==='Stickers'?packs.id:raw.id,quantity:10000,unit_cost:cost,total_value:10000*cost,lot_number:'LOT-'+p.id,qc_status:'approved',expiry_date:'2030-12-31'});return p;};
 const milk=await make('Milk powder','kg','raw_material',100),culture=await make('Culture','g','additive',2),sugar=await make('Sugar','kg','raw_material',50),martinal=await make('Martinal','g','additive',3);
 const additiveItems=await Promise.all(['Sorbate powder','Benzoate','Citric acid'].map(name=>make(name,'g','additive',2)));
 const flavourItems=await Promise.all(['Chocolat','Vanille','Fraise'].map(flavor=>make(flavor+' flavour','bottle','raw_material',10,{flavor})));
 const cups=await make('Yogurt cups','ea','packaging',1),labels=await Promise.all(flavors.map(flavor=>make(flavor+' stickers','ea','inventory_part',0.1,{material_group:'Stickers',flavor})));
 const products=await Promise.all(flavors.map((flavor,i)=>s.Product.create({name:family+' '+flavor,inventory_type:'assembly',unit_of_measure:'ea',is_active:true,configuration_status:'ready',product_family:family==='brasse'?'Yaourt brasse':'Yaourt a boire',flavor,size:family==='brasse'?'500 g':'330 g',shelf_life_days:14,components:[{product_id:cups.id,quantity:1,unit:'ea'},{product_id:labels[i].id,quantity:1,unit:'ea'}]})));
 const wip=await s.Account.create({account_number:'1315',account_type:'asset',normal_balance:'debit',balance:0,is_active:true,is_posting:true,name:'Recipe WIP'}),inventory=await s.Account.create({account_number:'1310',account_type:'asset',normal_balance:'debit',balance:0,is_active:true,is_posting:true,name:'Recipe ingredients'}),finished=await s.Account.create({account_number:'1320',account_type:'asset',normal_balance:'debit',balance:0,is_active:true,is_posting:true,name:'Recipe finished stock'});
 await s.PostingRule.create({rule_key:'raw_material_inventory',account_id:inventory.id,is_active:true});
 const items=await s.Product.filter({});let config=newPhasedRecipe(items,family);config.planned_buckets=products.length*bucketsPerProduct;
 // Synthetic calibration/doses are test data, never production recommendations.
 Object.assign(config.fermentation.find(line=>line.role==='culture'),{quantity_per_measure:5,quantity:10});
 config.additives.forEach((line,index)=>line.quantity=index+1);
 for(const product of products){const draft=productRecipeDraft(product,config,items);draft.output.buckets=bucketsPerProduct;const line=draft.blend.materials.find(row=>row.recipe_role==='martinal');if(line)line.unit='g';config=commitProductDraft(config,draft);}
 const recipe=(await act(f,'saveYogurtRecipe',{name:'Four stage '+family,config})).recipe;
 await act(f,'approveYogurtRecipe',{recipeId:recipe.id});
 const plan={recipe_id:recipe.id,...recipeBucketPlan(recipe.yogurt_config),production_date:date,material_warehouses:{}};
 const order=createOrder?(await act(f,'saveYogurtPlan',{plan,status:'awaiting_approval',requestKey:crypto.randomUUID()})).order:null;
 return {...f,raw,packs,cold,milk,culture,sugar,martinal,additiveItems,flavourItems,cups,labels,products,wip,inventory,finished,recipe,config:recipe.yogurt_config,plan,order};
}
export async function finishBase(f){
 await asRole(f,'admin');await act(f,'approveProductionOrder');await asRole(f,'warehouse_manager');await act(f,'issueYogurtStage',{stage:'fermentation'});await asRole(f,'production_manager');await act(f,'startFermentation');
 await f.entities.ProductionOrder.update(f.order.id,{fermentation_started_at:new Date(Date.now()-9*3600000).toISOString(),fermentation_due_at:new Date(Date.now()-3600000).toISOString()});
 return (await act(f,'finishYogurtFermentation',{notes:'Synthetic batch checks',actualLitres:f.plan.buckets*30-1})).order;
}
export async function readyToPack(f){
 await finishBase(f);await asRole(f,'warehouse_manager');await act(f,'issueYogurtStage',{stage:'additives'});await asRole(f,'production_manager');
 const measured=f.plan.allocations.map(a=>({flavor:a.flavor,kg:a.buckets*(f.config.family==='brasse'?26:33)+1}));
 const {order}=await act(f,'finishYogurtAdditives',{notes:'Synthetic additive checks',measured});
 if(order.yogurt_phase==='flavouring'){await asRole(f,'warehouse_manager');await act(f,'issueYogurtStage',{stage:'flavouring'});await asRole(f,'production_manager');return (await act(f,'finishYogurtFlavouring',{notes:'Synthetic blend weights',measured})).order;}
 return order;
}
