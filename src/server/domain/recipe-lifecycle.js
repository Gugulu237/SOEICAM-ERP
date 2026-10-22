export async function removeManufacturingRecipe(stores,context,body){
  if(!['admin','production_manager'].includes(context.role))throw Object.assign(Error('Only authorized production management may remove recipes.'),{status:403});
  const recipe=await stores.Recipe.get(body.recipeId);if(!recipe)throw Error('Recipe not found.');
  if(recipe.recipe_deleted_at)return {recipe,reused:true};
  const reason=String(body.reason||'Recipe no longer required').trim();if(!reason||reason.length>500)throw Error('Use a recipe removal reason of up to 500 characters.');
  const orders=await stores.ProductionOrder.filter({recipe_id:recipe.id},'id',1);
  const status=orders.length||recipe.approved_at||['approved','superseded','archived'].includes(recipe.status)?'archived':'deleted';
  const saved=await stores.Recipe.update(recipe.id,{status,recipe_deleted_at:new Date().toISOString(),recipe_deleted_by:context.user.id,recipe_deletion_reason:reason});
  await stores.AuditLog.create({action:'remove_manufacturing_recipe',module:'manufacturing',entity_type:'Recipe',entity_id:recipe.id,user_id:context.user.id,actor_employee_id:context.employee?.id||'',audit_source:'server_verified',description:'Removed recipe from planning; historical content and production records retained',reason,previous_status:recipe.status,status});
  return {recipe:saved,archived:status==='archived'};
}
