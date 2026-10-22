import { normalizeProductText } from './product-images.js';

export const ITEM_METADATA_FIELDS = ['product_family', 'material_group', 'flavor', 'size', 'attributes'];
export const MAX_ITEM_ATTRIBUTES = 20;
export const attributeKey = value => normalizeProductText(value).trim().replace(/\s+/g, ' ');
const clean = value => value.trim().replace(/\s+/g, ' ');
const reserved = new Set(['family', 'product family', 'material group', 'flavor', 'flavour', 'size']);
const validText = (value, max) => typeof value === 'string' && value.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(value);

export function validateItemMetadata(input) {
  const result = {};
  for (const field of ITEM_METADATA_FIELDS.filter(f => f !== 'attributes')) if (Object.hasOwn(input, field)) {
    if (!validText(input[field], 80)) throw Error('Use an item classification of up to 80 characters without line breaks.');
    result[field] = clean(input[field]);
  }
  if (Object.hasOwn(input, 'attributes')) {
    if (!Array.isArray(input.attributes) || input.attributes.length > MAX_ITEM_ATTRIBUTES) throw Error('Use at most 20 item attributes.');
    const keys = new Set();
    result.attributes = input.attributes.map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(k => !['name','value'].includes(k)) || !validText(row.name, 50) || !validText(row.value, 120) || !row.name.trim() || !row.value.trim()) throw Error('Each attribute needs a name (up to 50 characters) and a value (up to 120 characters).');
      const key = attributeKey(row.name);
      if (reserved.has(key)) throw Error('Use the dedicated family, group, flavour or size fields for those attributes.');
      if (keys.has(key)) throw Error('Use each attribute name only once per item.');
      keys.add(key);
      return { name: clean(row.name), value: clean(row.value) };
    });
  }
  return result;
}

// Read presentation metadata defensively; saving still requires strict validation.
export function itemAttributes(item) {
  return Array.isArray(item?.attributes) ? item.attributes.filter(row => row && typeof row.name === 'string' && typeof row.value === 'string').map(row => ({name: clean(row.name), value: clean(row.value)})) : [];
}
export function itemSearchText(item) {
  return attributeKey([item.name,item.product_name,item.sku,item.asset_number,item.category,item.product_family,item.material_group,item.flavor,item.size,...itemAttributes(item).flatMap(row => [row.name,row.value])].filter(Boolean).join(' '));
}
export const matchesItemSearch = (item, query) => { const text=itemSearchText(item); return attributeKey(query).split(/\s+/).filter(Boolean).every(word => text.includes(word)); };

export function attributeFacets(items) {
  const groups = new Map();
  for (const item of items) for (const row of itemAttributes(item)) {
    const key = attributeKey(row.name), value = attributeKey(row.value);
    if (!key || !value) continue;
    if (!groups.has(key)) groups.set(key, { key, name: row.name, values: new Map() });
    groups.get(key).values.set(value, groups.get(key).values.get(value) || {key:value, label:row.value});
  }
  return [...groups.values()].map(group => ({...group, values:[...group.values.values()].sort((a,b) => a.label.localeCompare(b.label,undefined,{numeric:true}))})).sort((a,b) => a.name.localeCompare(b.name));
}
export function matchesAttributes(item, selected) {
  if (!Object.keys(selected).length) return true;
  const values = new Map(itemAttributes(item).map(row => [attributeKey(row.name), attributeKey(row.value)]));
  return Object.entries(selected).every(([key,value]) => !value || values.get(key) === value);
}
