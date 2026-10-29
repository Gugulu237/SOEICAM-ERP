import {pricedAssemblyProducts} from '../../lib/assembly-pricing.js';
import {isAssemblyInventoryType} from '../../lib/item-types.js';
import {readRecords} from './commercial-workspace.js';

// Definition costs follow the configured component price. Posted production
// costs, stock layers, quantities, invoices and journals are never changed here.
export async function refreshAssemblyPrices(stores,sourceId) {
  const products=await readRecords(stores.Product),affected=new Set([sourceId]);
  let added=true;
  while(added){
    added=false;
    for(const p of products)if(!affected.has(p.id)&&isAssemblyInventoryType(p.inventory_type)&&p.components?.some(row=>row.cost_source!=='manual'&&affected.has(row.product_id))){affected.add(p.id);added=true;}
  }
  const assemblies=pricedAssemblyProducts(products).filter(p=>p.id!==sourceId&&affected.has(p.id)&&isAssemblyInventoryType(p.inventory_type));
  if(!assemblies.length)return;
  const balances=stores.StockBalance?await readRecords(stores.StockBalance,{product_id:{$in:assemblies.map(p=>p.id)}}):[];
  const stocked=new Set(balances.filter(b=>Number(b.quantity)!==0).map(b=>b.product_id));
  const original=new Map(products.map(p=>[p.id,p]));
  for(const p of assemblies){
    const old=original.get(p.id);
    if(p.standard_cost===old.standard_cost&&JSON.stringify(p.components)===JSON.stringify(old.components))continue;
    await stores.Product.update(p.id,{components:p.components,standard_cost:p.standard_cost,...(!stocked.has(p.id)?{current_cost:p.standard_cost}:{})});
  }
}
