const money=value=>Math.round(Number(value)*100)/100;
// Configured selling prices are the final amounts charged to the customer.
export function splitIncludedVat(gross,rate=0){
 const total=money(gross),vatRate=Number(rate);
 if(!Number.isFinite(total)||total<0||!Number.isFinite(vatRate)||vatRate<0||vatRate>100)throw Error('Enter a valid sale amount and VAT rate.');
 const tax=money(total*vatRate/(100+vatRate));
 return {total,tax,net:money(total-tax)};
}
export function inclusiveSaleLine(quantity,unitPrice,rate=0,discountPct=0){
 const q=Number(quantity),p=Number(unitPrice),discountRate=Number(discountPct);
 if(!Number.isFinite(q)||q<0||!Number.isFinite(p)||p<0||!Number.isFinite(discountRate)||discountRate<0||discountRate>100)throw Error('Enter valid sale quantities, prices and discounts.');
 const gross=money(q*p),discount=money(gross*discountRate/100);
 return {...splitIncludedVat(money(gross-discount),rate),gross,discount};
}
