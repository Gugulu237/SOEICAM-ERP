export const CASHIER_SECTIONS = ['handovers','customers','expenses','payments','accounts'];
export const cashierSection = value => CASHIER_SECTIONS.includes(value) ? value : 'handovers';
export function cashierHandoverPath(query = {}) {
  const get = key => query instanceof URLSearchParams ? query.get(key) : query[key];
  const params = new URLSearchParams({section:'handovers'});
  const commercial = get('commercial');
  if(typeof commercial==='string' && commercial)params.set('commercial',commercial);
  if(get('handover_view')==='history' || get('tab')==='history')params.set('handover_view','history');
  return '/cashier?'+params;
}
