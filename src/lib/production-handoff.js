export const MATERIAL_WAREHOUSE_TYPES = ['raw_material','packaging','wip','finished_goods','cold_room'];

export const productionReadyForIssue = order => !!order?.approved_by && !!order?.approved_at && (order.status==='approved' && !(order.recipe_kind==='yogurt_phased_v1' && order.yogurt_phase==='packaging') || order.recipe_kind==='yogurt_phased_v1' && order.status==='in_production' && ['additives','flavouring'].includes(order.yogurt_phase) && !order.yogurt_issued_stages?.[order.yogurt_phase]);

export function productionHandoff(status) {
  return {
    draft: {owner:'Operations / Production',task:'Review materials and submit the plan'},
    awaiting_approval: {owner:'Operations / Production',task:'Review materials and submit the production order'},
    approved: {owner:'Warehouse',task:'Issue materials or request missing goods'},
    materials_reserved: {owner:'Warehouse',task:'Reconcile the reserved materials before issuing'},
    materials_issued: {owner:'Operations / Production',task:'Start the eight-hour fermentation timer'},
    in_production: {owner:'Operations / Production',task:'Monitor fermentation, then record actual output'},
    awaiting_qc: {owner:'Production quality control',task:'Inspect and release the finished batch'},
    released: {owner:'Warehouse / distribution',task:'Prepare released goods for delivery'},
  }[status] || null;
}
