import { effectiveRole } from './roles.js';
import { isAssemblyInventoryType } from '../../lib/item-types.js';
import { isYogurt } from '../../lib/yogurt-production.js';

const denied = message => Object.assign(new Error(message), { status:403 });
const creating = operation => ['create','bulkCreate'].includes(operation);
const removing = operation => ['delete','deleteMany'].includes(operation);
const approvedHistory = row => Boolean(row?.approved_at || row?.approved_by || row?.approved_by_user_id || ['approved','superseded'].includes(row?.status));
const different = (left,right) => JSON.stringify(left ?? '') !== JSON.stringify(right ?? '');
function positive(value,label) {
  if (!['number','string'].includes(typeof value) || String(value).trim()==='' || !Number.isFinite(Number(value)) || Number(value)<=0 || Number(value)>1e12) throw Error(`Enter a positive ${label}.`);
  return Number(value);
}
function versionOf(row) {
  const version=positive(row.version ?? 1,'recipe version');
  if (!Number.isSafeInteger(version)) throw Error('Use a whole-number recipe version.');
  return version;
}
async function validateLine(stores,line) {
  positive(line.quantity,'component quantity');
  if (typeof line.material_id!=='string' || !line.material_id || typeof line.unit!=='string' || !line.unit.trim()) throw Error('Select a material and unit for every recipe component.');
  const material=await stores.Product.get(line.material_id);
  if (!material || material.is_active===false || material.configuration_status==='draft' || material.inventory_type==='service') throw Error('Select an active stock material for every recipe component.');
  const wastage=Number(line.expected_wastage_pct || 0);
  if (!Number.isFinite(wastage) || wastage<0 || wastage>100) throw Error('Recipe component wastage must be from 0 to 100 percent.');
}
async function validateApproval(stores,recipe) {
  const product=await stores.Product.get(recipe.product_id);
  if (!product || product.is_active===false || !isAssemblyInventoryType(product.inventory_type) || product.configuration_status==='draft') throw Error('Choose an active assembly before approving its recipe.');
  positive(recipe.batch_output,'batch output');
  const version=versionOf(recipe);
  const lines=await stores.RecipeLine.filter({recipe_id:recipe.id},'id',201);
  if (!lines.length || lines.length>200) throw Error('Save 1 to 200 recipe components before approval.');
  if (recipe.expected_component_count!=null && (recipe.components_save_complete!==true || Number(recipe.expected_component_count)!==lines.length)) throw Error('The recipe component save is incomplete. Finish saving the draft before approval.');
  for (const line of lines) await validateLine(stores,line);
  const history=await stores.Recipe.filter({product_id:recipe.product_id,status:{$in:['approved','superseded','archived']}},'id',201);
  if (history.length>200) throw Error('Review the recipe version history before approval.');
  if (history.some(row=>row.id!==recipe.id && approvedHistory(row) && versionOf(row)>=version)) throw Error('Use a newer recipe version than the previously approved versions.');
}

// Drafts may be prepared through the existing editor. Approval freezes the
// header and its actual saved components; a UI-selected status is not evidence.
export async function guardRecipeMutation(stores,context,entity,operation,input,existing=null) {
  if (!['Recipe','RecipeLine'].includes(entity)) return;
  if(isYogurt(existing) || 'recipe_kind' in input || Object.keys(input).some(key=>key.startsWith('yogurt_')))throw denied('Yogurt recipes use the checked phase recipe editor.');
  const role=effectiveRole(context.user,context.employee);
  if (!['admin','production_manager'].includes(role)) throw denied('Only authorized production management may change recipes.');
  if (entity==='RecipeLine') {
    if (existing && Object.hasOwn(input,'recipe_id') && input.recipe_id!==existing.recipe_id) throw denied('Recipe components cannot be moved to a different recipe.');
    const parent=await stores.Recipe.get(existing?.recipe_id || input.recipe_id);
    if(isYogurt(parent))throw denied('Yogurt formulas use the checked phase recipe editor.');
    if (!parent || parent.status!=='draft' || approvedHistory(parent)) throw denied('Approved recipe components are immutable. Create a new draft recipe version.');
    if (!removing(operation)) await validateLine(stores,{...existing,...input});
    return;
  }
  if (existing && approvedHistory(existing)) {
    if (removing(operation) || Object.entries(input).some(([key,value])=>different(value,existing[key]))) throw denied('Approved recipe content is immutable. Create a new draft recipe version.');
    return;
  }
  if (creating(operation) && input.status && input.status!=='draft') throw denied('New recipes must start as drafts and be approved after their components are saved.');
  if (removing(operation)) {
    if (existing?.status!=='draft') throw denied('Only an unapproved draft recipe may be deleted.');
    return;
  }
  const next={...existing,...input};
  if (next.batch_output!=null) positive(next.batch_output,'batch output');
  if (next.version!=null) versionOf(next);
  if (input.status==='superseded') throw denied('An approved replacement supersedes the previous recipe automatically.');
  if (input.components_save_complete===true) {
    const lines=await stores.RecipeLine.filter({recipe_id:existing?.id},'id',201);
    if (!existing || !Number.isInteger(Number(next.expected_component_count)) || Number(next.expected_component_count)<1 || Number(next.expected_component_count)>200 || lines.length!==Number(next.expected_component_count)) throw Error('The recipe component save is incomplete. Finish saving the draft before approval.');
    for (const line of lines) await validateLine(stores,line);
  }
  if (input.status==='approved') {
    if (!existing || existing.status!=='draft') throw denied('Only a saved draft recipe can be approved.');
    await validateApproval(stores,next);
  }
}

// Called inside the same checked transaction that approves the new version.
// An interrupted draft save never withdraws the last approved production BOM.
export async function finishRecipeApproval(stores,context,before,after) {
  if (after?.status!=='approved' || before?.status==='approved') return;
  const previous=await stores.Recipe.filter({product_id:after.product_id,status:'approved'},'id',201);
  if (previous.length>200) throw Error('Review the approved recipe version history.');
  for (const row of previous.filter(row=>row.id!==after.id)) {
    if (versionOf(row)>=versionOf(after)) throw Error('The approved recipe version changed. Refresh before approving.');
    await stores.Recipe.update(row.id,{status:'superseded',superseded_by_recipe_id:after.id,superseded_by_user_id:context.user.id,superseded_at:new Date().toISOString()});
    await stores.AuditLog.create({action:'supersede_recipe',module:'manufacturing',entity_type:'Recipe',entity_id:row.id,user_id:context.user.id,audit_source:'server_verified',description:`Recipe ${row.recipe_name || row.id} v${row.version || 1} superseded by approved v${after.version || 1}`,replacement_recipe_id:after.id});
  }
}
