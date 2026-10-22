/* localized-metadata */
import {ui} from './i18n.js';
import { normalizeRole } from '../server/domain/roles.js';

export const QUALITY_PATH='/manufacturing';
export const QUALITY_ROLES=['admin','production_manager','warehouse_manager','employee'];
export const QUALITY_SECTIONS=[
  {key:'release',get label(){return ui("Batch release");},description:'Review held stock and release accepted batches for sale.',roles:['admin','production_manager']},
  {key:'inspections',get label(){return ui("Inspections");},description:'Review recorded batch inspection results.',roles:['admin','production_manager']},
  {key:'expiry',get label(){return ui("Expiry risk");},description:'Prioritise stock at risk and check batches already supplied.',roles:QUALITY_ROLES},
  {key:'traceability',get label(){return ui("Traceability");},description:'Find batch origins, current locations and customers supplied.',roles:['admin','production_manager','warehouse_manager']},
];
export const qualitySections=role=>QUALITY_SECTIONS.filter(section=>section.roles.includes(normalizeRole(role)));
export function qualitySection(role,requested){const sections=qualitySections(role);return sections.find(s=>s.key===requested) || sections[0] || null;}
export const isQualityPath=path=>['/quality','/expiry','/traceability'].includes(path?.replace(/\/+$/,''));
export function qualityPath(section='release',search={}){
  const params=new URLSearchParams();
  const entries=search instanceof URLSearchParams?search.entries():Object.entries(search);
  for(const [key,value] of entries)for(const entry of Array.isArray(value)?value:[value])if(entry!=null)params.append(key,String(entry));
  params.set('section','quality');
  params.set('quality',QUALITY_SECTIONS.some(s=>s.key===section)?section:'release');
  return QUALITY_PATH+'?'+params.toString();
}
