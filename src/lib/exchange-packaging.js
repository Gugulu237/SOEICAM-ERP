import {isPackagingItem,packagingGroup} from './inventory-packaging.js';

export const exchangePackagingOverrideAllowed=product=>!!product&&isPackagingItem(product);
// A product must be referenced by the assembly. Container names alone never
// establish a relationship between finished goods and a packaging item.
export function exchangePackagingEnabled(component,product){
  if(!exchangePackagingOverrideAllowed(product))return false;
  if(typeof component?.recover_on_exchange==='boolean')return component.recover_on_exchange;
 return /^(yogurt cups|cups?|pots?|tubs?|bottles?|bouteilles?)$/i.test(packagingGroup(product).trim());
}
