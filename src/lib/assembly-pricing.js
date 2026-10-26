import { assemblyCost, priceComponent, validateComponentNumbers } from './assembly-components.js';
const amount=value=>['number','string'].includes(typeof value)&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;

// Read current item definitions for an estimate; never rewrite carrying values,
// saved production plans or deliberate per-assembly cost overrides.
export function assemblyEstimate(components, products) {
  if(!Array.isArray(components)||!components.length)return null;
  const byId=products instanceof Map?products:new Map((products||[]).map(p=>[p.id,p]));
  try {
    const rows=components.map(row=>{
      if(row.product_id&&!byId.has(row.product_id))throw Error('Missing component');
      if(!row.product_id&&!row.asset_id&&row.component_type!=='other')throw Error('Choose a component');
      const current=priceComponent(row,byId.get(row.product_id));
      validateComponentNumbers(current);
      return current;
    });
    const cost=assemblyCost(rows);
    return Number.isFinite(cost)?cost:null;
  }catch{return null;}
}
export function assemblyProfitability(cost, sellingPrice) {
  const basis=amount(cost),price=amount(sellingPrice);
  if(basis==null||price==null)return {profit:null,markup:null,margin:null};
  const profit=price-basis;
  return {profit,markup:basis>0?profit/basis*100:null,margin:price>0?profit/price*100:null};
}
