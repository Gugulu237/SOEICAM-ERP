import { ITEM_METADATA_FIELDS } from '../../lib/item-attributes.js';

const metadata = item => Object.fromEntries(ITEM_METADATA_FIELDS.map(key => [key,item?.[key] ?? (key==='attributes' ? [] : '')]));
export async function recordItemMetadataChange(stores, context, before, after) {
  const previous = metadata(before), next = metadata(after);
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  await stores.AuditLog.create({action:'update_item_attributes',module:'inventory',entity_type:'Product',entity_id:after.id,user_id:context.user.id,user_name:context.employee?.full_name || context.user.full_name || context.user.email || context.user.id,description:`Updated classification and attributes for ${after.name}`,item_metadata_before:previous,item_metadata_after:next});
}
