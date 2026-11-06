import {readRecords} from './commercial-workspace.js';

// The picker, supply validation and billing must see the same available points.
export async function salesDeliveryPoints(stores,customerId){
  const [locations,branches]=await Promise.all([
    readRecords(stores.CustomerLocation,{customer_id:customerId,is_active:{$ne:false}}),
    readRecords(stores.Customer,{parent_id:customerId,is_active:{$ne:false}}),
  ]);
  return [
    ...locations.map(point=>({...point,kind:'location',label:point.name})),
    ...branches.filter(point=>!point.customer_removed_at).map(point=>({...point,kind:'branch',name:point.business_name,label:point.business_name})),
  ];
}
