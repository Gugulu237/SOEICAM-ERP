import {assemblyEstimate} from './assembly-pricing.js';
import {isPackagingItem} from './inventory-packaging.js';

const scaled=(value,multiplier)=>value==null?null:Math.round(value*multiplier*1e6)/1e6;

// Read the same current registered costs and deliberate overrides as the main
// assembly estimate. Unknown component costs remain unknown, never zero.
export function assemblyDetailSummary(item,products=[]){
  const components=item.components||[],byId=new Map(products.map(product=>[product.id,product]));
  const configured=Number(item.yogurt_units_per_bucket),yieldUnits=['number','string'].includes(typeof item.yogurt_units_per_bucket)&&Number.isSafeInteger(configured)&&configured>0?configured:null;
  const packaging=components.filter(row=>{const product=byId.get(row.product_id);return product&&isPackagingItem(product);});
  const materials=components.filter(row=>!packaging.includes(row));
  const estimate=rows=>rows.length?assemblyEstimate(rows,products):0;
  const materialUnitCost=estimate(materials),packagingUnitCost=estimate(packaging);
  const otherComponents=materials.some(row=>row.asset_id||['service','fixed_asset','other'].includes(row.component_type)||byId.get(row.product_id)?.inventory_type==='service');
  return {
    yieldUnits,materials,packaging,otherComponents,
    materialUnitCost,packagingUnitCost,
    materialTotal:scaled(materialUnitCost,yieldUnits||1),
    packagingBucketCost:yieldUnits?scaled(packagingUnitCost,yieldUnits):null,
    totalUnitCost:components.length?assemblyEstimate(components,products):null,
  };
}

export function assemblyDetailLine(row,products=[],multiplier=1){
  const quantity=Number(row.quantity),cost=assemblyEstimate([row],products);
  const validQuantity=['number','string'].includes(typeof row.quantity)&&String(row.quantity).trim()!==''&&Number.isFinite(quantity)&&quantity>0;
  return {quantity:validQuantity?quantity*multiplier:null,unitCost:validQuantity&&cost!=null?cost/quantity:null,total:scaled(cost,multiplier)};
}
