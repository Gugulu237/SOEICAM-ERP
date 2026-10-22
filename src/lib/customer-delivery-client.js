import { invokeFieldOps } from './field-ops';
export async function customerDeliveryRequest(body) {
  const result=await invokeFieldOps(body);if(result.data.error)throw Error(result.data.error);return result.data;
}
