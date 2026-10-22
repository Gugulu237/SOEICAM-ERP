const serverFields=new Set(['id','created_date','updated_date','created_by','auth_user_id','extra_data']);
export function editableFields(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  return Object.fromEntries(Object.entries(record).filter(([key])=>!serverFields.has(key)));
}
// Existing forms may hold the complete loaded record. Retain the original ID in
// the request path and send only editable fields; server checks remain mandatory.
export function entityArguments(operation,args) {
  const result=[...args];
  if (operation === 'create') result[0]=editableFields(result[0]);
  if (operation === 'bulkCreate' && Array.isArray(result[0])) result[0]=result[0].map(editableFields);
  if (operation === 'update' || operation === 'updateMany') result[1]=editableFields(result[1]);
  return result;
}
