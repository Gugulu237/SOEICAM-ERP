import { assemblyCost, priceComponent, validateComponentNumbers } from './assembly-components.js';
const amount=value=>['number','string'].includes(typeof value)&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;

// Read current item definitions for an estimate; never rewrite carrying values,
// saved production plans or deliberate per-assembly cost overrides.
function resolver(products) {
  const byId=products instanceof Map?products:new Map((products||[]).map(p=>[p.id,p])),cache=new Map(),path=new Set();
  const resolve=id=>{
    if(cache.has(id))return cache.get(id);
    const product=byId.get(id);if(!product)throw Error('Missing component');
    if(path.has(id))throw Error('Cyclic assembly');
    if(path.size>50)throw Error('Assembly nesting is too deep');
    if(!['assembly','finished_product'].includes(product.inventory_type)||!product.components?.length)return product;
    path.add(id);
    try{const components=price(product.components),cost=assemblyCost(components);const current={...product,components,standard_cost:cost};cache.set(id,current);return current;}finally{path.delete(id);}
  };
  const price=components=>components.map(row=>{
    if(!row.product_id&&!row.asset_id&&row.component_type!=='other')throw Error('Choose a component');
    const current=priceComponent(row,row.product_id?resolve(row.product_id):null);validateComponentNumbers(current);return current;
  });
  return {resolve,price};
}
export function pricedAssemblyProducts(products) {
  const values=products instanceof Map?[...products.values()]:products,engine=resolver(products);
  return values.map(product=>{try{return engine.resolve(product.id);}catch{return product;}});
}
export function assemblyEstimate(components, products) {
  if(!Array.isArray(components)||!components.length)return null;
  try{const cost=assemblyCost(resolver(products).price(components));return Number.isFinite(cost)?cost:null;}catch{return null;}
}
export function assemblyProfitability(cost, sellingPrice) {
  const basis=amount(cost),price=amount(sellingPrice);
  if(basis==null||price==null)return {profit:null,markup:null,margin:null};
  const profit=price-basis;
  return {profit,markup:basis>0?profit/basis*100:null,margin:price>0?profit/price*100:null};
}
