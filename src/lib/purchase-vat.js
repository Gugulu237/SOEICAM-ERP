import {splitIncludedVat,STANDARD_VAT_RATE} from './sale-vat.js';

export const PURCHASE_VAT_TREATMENTS=['unverified','none','documented'];

const money=value=>Math.round(Number(value)*100)/100;
const quantityOf=value=>Math.round(Number(value)*1000)/1000;

export function purchaseQuoteAmounts(quantity,unitPrice,rate,includesVat){
  const amount=money(quantityOf(quantity)*money(unitPrice));
  if(includesVat)return splitIncludedVat(amount,rate);
  const tax=money(amount*Number(rate)/100);
  return {net:amount,tax,total:money(amount+tax)};
}

export function purchaseReceiptAmounts(line,quantity,includesVat){
  const rate=Number(line.tax_rate || 0);
  if(!includesVat){
    return splitIncludedVat(money(quantity*Number(line.unit_price)*(1+rate/100)),rate);
  }
  const received=quantityOf(Number(line.received_quantity || 0)+Number(quantity));
  const cumulative=purchaseQuoteAmounts(received,line.unit_price,rate,true);
  const prior=purchaseQuoteAmounts(line.received_quantity || 0,line.unit_price,rate,true);
  const total=money(cumulative.total-prior.total);
  const tax=money(cumulative.tax-prior.tax);
  return {total,tax,net:money(total-tax)};
}

export function isStandardPurchaseRate(rate){
  return rate===0 || rate===STANDARD_VAT_RATE;
}
