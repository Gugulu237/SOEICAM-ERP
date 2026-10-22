import { invokeFieldOps } from './field-ops';
export async function searchBatches(term='') { return (await invokeFieldOps({action:'batchCatalogue',term})).data.batches; }
export async function traceBatch(lotNumber,productId) { return (await invokeFieldOps({action:'batchTrace',lotNumber,productId})).data; }
// Compatibility helpers keep batch identity scoped to its product.
export async function traceBackward(lotNumber,productId) { return (await traceBatch(lotNumber,productId)).backward; }
export async function traceForward(lotNumber,productId) { return (await traceBatch(lotNumber,productId)).forward; }
export async function getBatchMovements(lotNumber,productId) { return (await traceForward(lotNumber,productId)).movements; }
