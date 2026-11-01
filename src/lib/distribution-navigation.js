import {ui} from './i18n.js';
import {canManageDeliveries} from './operations-access.js';
export const DISTRIBUTION_PATH='/distribution';
export function distributionSections(role){
  if(role==='driver')return [{key:'deliveries',label:ui('My deliveries')}];
  if(role!=='admin')return [];
  return [
    ...(canManageDeliveries(role)?[{key:'stock',label:ui('Field stock')}]:[]),
    {key:'deliveries',label:ui('Deliveries')},
    {key:'fleet',label:ui('Fleet')},
    {key:'dispatches',label:ui('Dispatches')},
    {key:'requests',label:ui('Issue records')},
    {key:'routes',label:ui('Routes')},
    {key:'vehicles',label:ui('Vehicles')},
    ...(['admin','warehouse_manager'].includes(role)?[{key:'exchanges',label:ui('Expired exchanges')}]:[]),
  ];
}
export function distributionPath(tab='stock',search={}){
  const query=new URLSearchParams();for(const [key,value] of search instanceof URLSearchParams?search.entries():Object.entries(search))for(const item of Array.isArray(value)?value:[value])if(item!=null)query.append(key,String(item));query.set('tab',tab);return DISTRIBUTION_PATH+'?'+query.toString();
}
