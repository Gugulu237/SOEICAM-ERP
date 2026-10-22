import { componentType } from './assembly-components.js';
import { stockUnit } from './item-units.js';

// Assembly components are per one output unit. Labour, assets and overhead
// remain costing components; they must not become warehouse stock issues.
export function assemblyRecipeDraft(product, products) {
  const lines=[],excluded=[];
  for(const row of product?.components || []) {
    const material=products.find(p=>p.id===row.product_id), type=componentType(row,products);
    if(!['inventory_part','assembly'].includes(type) || !material || material.is_active===false || material.configuration_status==='draft' || material.id===product.id){excluded.push(row);continue;}
    lines.push({material_id:material.id,material_name:material.name,material_type:material.inventory_type==='packaging'?'primary_packaging':material.inventory_type==='consumable'?'consumable':'ingredient',quantity:row.quantity,unit:row.unit || stockUnit(material),expected_wastage_pct:0,sequence:lines.length+1});
  }
  return {form:{product_id:product.id,recipe_name:product.name,batch_output:1,output_unit:stockUnit(product)},lines,excluded};
}
