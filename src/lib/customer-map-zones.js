import {hasCustomerLocation} from './customer-location.js';
export const YAOUNDE_CENTER={lat:3.848,lng:11.5021};
export const CAMEROON_BOUNDS=[[1.6,8.4],[13.2,16.3]];
export const YAOUNDE_MUNICIPALITIES=Array.from({length:7},(_,i)=>({id:'yaounde_'+(i+1),label:'Yaoundé '+['I','II','III','IV','V','VI','VII'][i]}));
export const ZONE_SERVICE_STATUSES=['served','planned','paused'];
export const ZONE_MAP_COLOURS={amber:'#b45309',blue:'#2563eb',green:'#059669',purple:'#7c3aed',slate:'#64748b'};
const cross=(a,b,c)=>(b.lng-a.lng)*(c.lat-a.lat)-(b.lat-a.lat)*(c.lng-a.lng);
const onSegment=(a,b,p)=>Math.abs(cross(a,b,p))<1e-11&&p.lng>=Math.min(a.lng,b.lng)-1e-11&&p.lng<=Math.max(a.lng,b.lng)+1e-11&&p.lat>=Math.min(a.lat,b.lat)-1e-11&&p.lat<=Math.max(a.lat,b.lat)+1e-11;
function intersect(a,b,c,d){const ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);return ab1*ab2<0&&cd1*cd2<0||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);}
export function validateZoneBoundary(input){
  if(input==null)return [];
  if(!Array.isArray(input)||input.length>61)throw Error('Draw a delivery boundary with 3 to 60 corners.');
  const ring=input.map(p=>{if(!p||typeof p.lat!=='number'||typeof p.lng!=='number'||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)throw Error('Use valid GPS coordinates for the zone boundary.');return {lat:p.lat,lng:p.lng};});
  if(ring.length>1&&ring[0].lat===ring.at(-1).lat&&ring[0].lng===ring.at(-1).lng)ring.pop();
  if(!ring.length)return [];
  if(ring.length<3||ring.length>60||new Set(ring.map(p=>p.lat+':'+p.lng)).size!==ring.length)throw Error('Draw a delivery boundary with 3 to 60 distinct corners.');
  let area=0;
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a.lng*b.lat-b.lng*a.lat;for(let j=i+1;j<ring.length;j++){if(j===i+1||i===0&&j===ring.length-1)continue;if(intersect(a,b,ring[j],ring[(j+1)%ring.length]))throw Error('The delivery boundary crosses itself. Adjust its corners.');}}
  if(Math.abs(area)<1e-10)throw Error('Draw a delivery boundary with a visible area.');
  return ring;
}
export function pointInDeliveryBoundary(point,ring){
  if(!hasCustomerLocation(point)||!Array.isArray(ring)||ring.length<3)return false;
  const p={lat:Number(point.gps_lat),lng:Number(point.gps_lng)};let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i];if(onSegment(a,b,p))return true;
    if((a.lat>p.lat)!==(b.lat>p.lat)&&p.lng<(b.lng-a.lng)*(p.lat-a.lat)/(b.lat-a.lat)+a.lng)inside=!inside;
  }
  return inside;
}
export function zoneGpsMatches(points,zone){
  const inside=points.filter(p=>pointInDeliveryBoundary(p,zone.boundary));
  return {eligible:inside.filter(p=>p.gps_status==='ready'&&!p.zone_id),assigned:inside.filter(p=>p.zone_id===zone.id),otherZones:inside.filter(p=>p.zone_id&&p.zone_id!==zone.id),unverified:inside.filter(p=>p.gps_status!=='ready')};
}
