import { saveItem } from './item-save.js';

// The caller wraps this operation in the normal serializable transaction.
export async function quickEditItem(context, stores, input) {
  return saveItem(context,stores,input,{quick:true});
}
