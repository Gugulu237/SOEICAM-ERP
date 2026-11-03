export function validProductQuantity(value, maximum) {
  if(value==null || !['string','number'].includes(typeof value) || String(value).trim()==='')return false;
  const quantity=Number(value),limit=Number(maximum);
  return Number.isFinite(quantity)&&Number.isFinite(limit)&&quantity>0&&quantity<=limit&&Math.round(quantity*1000)/1000===quantity;
}

// Sale and replacement lines share the same physical stock.
export function quantityAfterReplacements(product, replacements=[]) {
  const available=Number(product.available??product.quantity);
  const replaced=replacements.filter(row=>row.product_id===product.id).reduce((total,row)=>total+Math.max(0,Number(row.quantity||0)),0);
  if(!Number.isFinite(available)||!Number.isFinite(replaced))return 0;
  return Math.max(0,Math.round((available-Math.max(0,replaced))*1000)/1000);
}
