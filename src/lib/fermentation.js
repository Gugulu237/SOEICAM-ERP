export const FERMENTATION_MS=8*60*60*1000;
export const FERMENTATION_WARNING_MS=30*60*1000;
export function fermentationTimes(now=new Date()) {
  const start=new Date(now).getTime();
  if(!Number.isFinite(start))throw Error('Invalid fermentation start time.');
  return {fermentation_started_at:new Date(start).toISOString(),fermentation_reminder_at:new Date(start+FERMENTATION_MS-FERMENTATION_WARNING_MS).toISOString(),fermentation_due_at:new Date(start+FERMENTATION_MS).toISOString(),fermentation_next_notification_at:new Date(start+FERMENTATION_MS-FERMENTATION_WARNING_MS).toISOString()};
}
export function fermentationRemaining(order,now=Date.now()) {
  const due=Date.parse(order?.fermentation_due_at);
  if(!Number.isFinite(due))return null;
  return Math.max(0,Math.ceil((due-Number(now))/60000));
}
