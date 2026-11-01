export function validProductQuantity(value, maximum) {
  if(value==null || !['string','number'].includes(typeof value) || String(value).trim()==='')return false;
  const quantity=Number(value),limit=Number(maximum);
  return Number.isFinite(quantity)&&Number.isFinite(limit)&&quantity>0&&quantity<=limit&&Math.round(quantity*1000)/1000===quantity;
}
