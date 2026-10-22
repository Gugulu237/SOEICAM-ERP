import { inventoryGroup } from './inventory-groups.js';
import { attributeKey, itemAttributes } from './item-attributes.js';
import { canonicalFlavour, canonicalSize, PRODUCT_FLAVOURS } from './product-variants.js';

export function assemblyRecordAvailable(record,type){
  return type==='fixed_asset'?['active','fully_depreciated'].includes(record.status):record.is_active!==false&&record.configuration_status!=='draft';
}

// Classification affects browsing only; selected records still use their registered type/U/M/cost.
export function assemblyComponentPath(item,type='inventory_part'){
  if(type==='fixed_asset')return ['Fixed assets'];
  if(type==='assembly')return ['Finished products / assemblies'];
  if(type==='service')return ['Services / labour'];
  const attributes=itemAttributes(item),attr=name=>attributes.find(a=>attributeKey(a.name)===name)?.value;
  const words=attributeKey([item.material_group,item.category,item.name,attr('packaging type')].filter(Boolean).join(' '));
  if(/\b(stickers?|labels?|etiquettes?|autocollants?)\b/.test(words)){
    const flavors=PRODUCT_FLAVOURS.filter(f=>f.aliases.some(a=>new RegExp('(?:^|\\W)'+attributeKey(a).replace(/ /g,'\\s+')+'(?:$|\\W)').test(attributeKey(item.name))));
    const flavor=canonicalFlavour(item.flavor || (flavors.length===1?flavors[0].value:'')) || 'Flavour not assigned';
    const namedSizes=[...attributeKey(item.name).matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/g)].map(m=>canonicalSize(m[1]+' '+m[2]));
    let size=canonicalSize(item.size || (new Set(namedSizes).size===1?namedSizes[0]:'')) || 'Size not assigned';
    size=size.replace(/^(\d+(?:\.\d+)?)\s*(ml|cl|l)$/i,(_,n,unit)=>n+' '+unit.toLowerCase());
    return ['Stickers',flavor,size];
  }
  const group=inventoryGroup(item),key=attributeKey(group);
  if(item.inventory_type==='packaging'||/^(packaging|emballages?)$/.test(key))return ['Packaging'];
  if(item.inventory_type==='additive'||/^(additives?|additifs?)$/.test(key))return ['Additives'];
  if(item.inventory_type==='raw_material'||/^(raw materials?|matieres? premieres?)$/.test(key))return ['Raw Material'];
  return [group || 'Other material'];
}

export function assemblyBrowseGroups(records,type,path=[]){
  const groups=new Map(),items=[];
  for(const record of records){const parts=assemblyComponentPath(record,type);if(!path.every((part,i)=>parts[i]===part))continue;
    if(parts.length===path.length)items.push(record);else groups.set(parts[path.length],(groups.get(parts[path.length]) || 0)+1);
  }
  const order=['Packaging','Stickers','Additives','Raw Material'];
  return {groups:[...groups].map(([name,count])=>({name,count})).sort((a,b)=>(order.includes(a.name)?order.indexOf(a.name):99)-(order.includes(b.name)?order.indexOf(b.name):99)||a.name.localeCompare(b.name,undefined,{numeric:true})),items:items.sort((a,b)=>String(a.name).localeCompare(String(b.name),undefined,{numeric:true}))};
}
