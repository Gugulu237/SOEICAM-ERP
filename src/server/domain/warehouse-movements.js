import { recordScope, visibleRecord } from '../access.js';
import { assertModule } from './role-catalogue.js';
import { MOVEMENT_TYPES, defaultMovementFilters } from '../../lib/warehouse-workspace.js';

export function movementFilters(input = {}) {
  const defaults = defaultMovementFilters();
  const value = Object.fromEntries(Object.keys(defaults).map(key => [key,String(input[key] ?? defaults[key]).trim()]));
  const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
  if (!validDate(value.from) || !validDate(value.to) || value.from > value.to) throw Error('Choose a valid start and end date.');
  if (value.type && !MOVEMENT_TYPES.includes(value.type) || !['approved','pending','reversed','all'].includes(value.status)) throw Error('Choose a valid movement type and status.');
  if (['warehouse','source','destination','product'].some(key => value[key].length > 200)) throw Error('Invalid movement filter.');
  const page = Number(input.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw Error('Invalid page.');
  const query = {movement_date:{$gte:value.from,$lte:value.to}};
  if (value.type) query.movement_type=value.type;
  if (value.status !== 'all') query.status=value.status;
  if (value.product) query.product_id=value.product;
  if (value.warehouse) query.$or=[{source_warehouse_id:value.warehouse},{destination_warehouse_id:value.warehouse}];
  if (value.source) query.source_warehouse_id=value.source === '__none__' ? {$in:['',null]} : value.source;
  if (value.destination) query.destination_warehouse_id=value.destination === '__none__' ? {$in:['',null]} : value.destination;
  return {value,query,page};
}

export async function warehouseMovements(context,stores,input) {
  assertModule(context,'inventory');
  const scope = await recordScope(context,'StockMovement','filter',stores);
  const {value,query,page} = movementFilters(input);
  const scoped = {$and:[scope,query]}, approved = {$and:[scoped,{status:'approved'}]};
  const fields = ['id','movement_date','created_date','product_id','product_name','source_warehouse_id','destination_warehouse_id','lot_number','batch_number','expiry_date','quantity','unit_cost','total_value','movement_type','status','document_type','document_id','reason'];
  const display = row => Object.fromEntries(fields.map(key => [key,visibleRecord(context,'StockMovement',row)?.[key]]));
  if (input.export === '1') {
    const rows = await stores.StockMovement.filter(scoped,'-movement_date,-created_date',10001);
    if (rows.length > 10000) throw Error('This report contains more than 10,000 entries. Narrow the dates, item or warehouse and run it again.');
    return {filters:value,rows:rows.map(display),exportedAt:new Date().toISOString()};
  }
  const [result,groups] = await Promise.all([
    stores.StockMovement.filter(scoped,{sort:'-movement_date,-created_date',limit:40,skip:(page-1)*40}),
    stores.StockMovement.aggregate({query:approved,groupBy:['source_warehouse_id','destination_warehouse_id','movement_type'],sum:['total_value']}),
  ]);
  const routes = new Map();
  for (const row of groups.rows) {
    const key=JSON.stringify([row.source_warehouse_id || '',row.destination_warehouse_id || '',row.movement_type]);
    const route=routes.get(key) || {source_warehouse_id:row.source_warehouse_id || '',destination_warehouse_id:row.destination_warehouse_id || '',movement_type:row.movement_type,count:0,value:0};
    route.count+=Number(row.count);route.value+=Number(row.sum_total_value);routes.set(key,route);
  }
  const flows = [...routes.values()];
  const sum = predicate => flows.filter(predicate).reduce((n,row) => n+row.count,0);
  return {filters:value,rows:result.items.map(display),total:result.total,page,hasMore:result.has_more,
    summary:{approved:sum(() => true),transfers:sum(row => row.source_warehouse_id && row.destination_warehouse_id && row.source_warehouse_id !== row.destination_warehouse_id),
      incoming:sum(row => value.warehouse ? row.destination_warehouse_id === value.warehouse && row.source_warehouse_id !== value.warehouse : !row.source_warehouse_id && row.destination_warehouse_id),
      outgoing:sum(row => value.warehouse ? row.source_warehouse_id === value.warehouse && row.destination_warehouse_id !== value.warehouse : row.source_warehouse_id && !row.destination_warehouse_id)},
    flows:flows.sort((a,b) => b.count-a.count).slice(0,12)};
}
