import {isAssemblyInventoryType} from './item-types.js';
import {stockUnit,unitFactor} from './item-units.js';
import {variantFamily} from './product-variants.js';
import {yogurtItemSize} from './yogurt-product-materials.js';

const definitionFields = [
  'product_family','category','size','unit_of_measure','purchase_unit','storage_unit','production_unit','sales_unit',
  'purchase_to_storage_factor','storage_to_production_factor','storage_to_sales_factor','costing_method',
  'cogs_account_id','revenue_account_id','inventory_account_id','selling_price','tax_rate',
  'lot_tracking','expiry_tracking','shelf_life_days',
];

// A blueprint is an editable definition. Stock, product identity and saved
// production records never become part of the new product draft.
export function copyAssemblyBlueprint(source,target=null) {
  if (!isAssemblyInventoryType(source?.inventory_type) || source.item_removed_at || !source.components?.length) {
    throw Error('Choose an assembly with saved components to copy.');
  }
  if (target) {
    const family=variantFamily(target),size=yogurtItemSize(target);
    if ((family && family!==variantFamily(source)) || (size && size!==yogurtItemSize(source))) {
      throw Error('Choose a blueprint with the same product family and size.');
    }
    if (unitFactor(stockUnit(target),stockUnit(source))!==1) {
      throw Error('Choose a blueprint with the same output unit.');
    }
  }
  const changes=target?{}:Object.fromEntries(definitionFields.filter(key=>source[key]!=null).map(key=>[key,source[key]]));
  const family=source.product_family || (variantFamily(source)==='brasse'?'Yaourt brassé':variantFamily(source)==='boire'?'Yaourt à boire':'');
  changes.yogurt_units_per_bucket=source.yogurt_units_per_bucket ?? '';
  changes.yogurt_net_weight_g=source.yogurt_net_weight_g ?? '';
  if (!target) {
    changes.inventory_type='assembly';
    changes.unit_of_measure=stockUnit(source);
    changes.product_family=family;
    changes.size=yogurtItemSize(source);
  } else {
    if (!variantFamily(target)) changes.product_family=family;
    if (!yogurtItemSize(target)) changes.size=yogurtItemSize(source);
  }
  return {changes,components:source.components.map(row=>({...row}))};
}
