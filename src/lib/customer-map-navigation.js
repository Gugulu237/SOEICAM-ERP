import {hasCustomerLocation} from './customer-location';
import {googleMapsLibrary} from './google-maps';

const failure=code=>Object.assign(new Error(code),{code});
export const emptyNavigation=()=>({phase:'idle',stops:[],origin:null,route:null,error:''});

// The driver's ephemeral position is never a customer GPS update.
export function currentDeliveryPosition({geolocation=globalThis.navigator?.geolocation,signal,secure=globalThis.isSecureContext,timers=globalThis}={}){
  return new Promise((resolve,reject)=>{
    if(secure===false){reject(failure('GPS_INSECURE'));return;}
    if(!geolocation){reject(failure('GPS_UNAVAILABLE'));return;}
    let done=false,timer;
    const finish=(error,value)=>{if(done)return;done=true;timers.clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>finish(failure('CANCELLED'));
    if(signal?.aborted){abort();return;}
    signal?.addEventListener('abort',abort,{once:true});
    // Browser GPS timeout excludes time waiting for permission.
    timer=timers.setTimeout(()=>finish(failure('GPS_TIMEOUT')),20000);
    try{geolocation.getCurrentPosition(position=>{
      const c=position?.coords,lat=c?.latitude,lng=c?.longitude,accuracy=c?.accuracy;
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||!Number.isFinite(accuracy)||accuracy<0){finish(failure('GPS_UNAVAILABLE'));return;}
      if(accuracy>1000){finish(failure('GPS_INACCURATE'));return;}
      finish(null,{lat,lng,accuracy,timestamp:position.timestamp||Date.now()});
    },error=>finish(failure(error?.code===1?'GPS_DENIED':error?.code===3?'GPS_TIMEOUT':'GPS_UNAVAILABLE')),{enableHighAccuracy:true,maximumAge:0,timeout:15000});}
    catch{finish(failure('GPS_UNAVAILABLE'));}
  });
}

export function deliveryRouteRequest(origin,stops,language='fr'){
  if(!Number.isFinite(origin?.lat)||!Number.isFinite(origin?.lng)||Math.abs(origin.lat)>90||Math.abs(origin.lng)>180)throw failure('GPS_UNAVAILABLE');
  if(!Array.isArray(stops)||stops.length<1||stops.length>3||stops.some(p=>!hasCustomerLocation(p)))throw failure('ROUTE_INVALID_PIN');
  const location=p=>({lat:Number(p.gps_lat),lng:Number(p.gps_lng)});
  return {origin:{lat:origin.lat,lng:origin.lng},destination:location(stops.at(-1)),intermediates:stops.slice(0,-1).map(p=>({location:location(p)})),travelMode:'DRIVING',routingPreference:'TRAFFIC_UNAWARE',optimizeWaypointOrder:false,computeAlternativeRoutes:false,language:language==='fr'?'fr':'en',region:'cm',units:'METRIC',fields:['path','distanceMeters','durationMillis','legs','warnings']};
}

export async function computeDeliveryRoute(maps,origin,stops,language){
  const request=deliveryRouteRequest(origin,stops,language);
  try{
    const {Route}=await googleMapsLibrary(maps.importLibrary('routes'));
    if(!Route?.computeRoutes)throw failure('ROUTE_CONFIGURATION');
    const result=await googleMapsLibrary(Route.computeRoutes(request));
    const route=result?.routes?.[0];
    if(!route?.path?.length)throw failure('ROUTE_NOT_FOUND');
    return route;
  }catch(error){
    if(['ROUTE_CONFIGURATION','ROUTE_NOT_FOUND'].includes(error?.code))throw error;
    const diagnostic=String(error?.code||'')+' '+String(error?.message||'');
    if(/REQUEST_DENIED|PERMISSION_DENIED|API_NOT_ACTIVATED|API_KEY|BILLING|AUTHORI[ZS]|403|not enabled|not authorized/i.test(diagnostic))throw failure('ROUTE_CONFIGURATION');
    if(/QUOTA|RESOURCE_EXHAUSTED|429|OVER_QUERY_LIMIT/i.test(diagnostic))throw failure('ROUTE_QUOTA');
    if(/ZERO_RESULTS|NOT_FOUND/i.test(diagnostic))throw failure('ROUTE_NOT_FOUND');
    throw failure(error?.code==='MAPS_TIMEOUT'?'ROUTE_TIMEOUT':'ROUTE_UNAVAILABLE');
  }
}

// Latest explicit request wins; leaving or clearing prevents stale drawing.
export function createDeliveryNavigator({locate=currentDeliveryPosition,compute,draw,clear,onChange}){
  let revision=0,controller,disposed=false;
  const reset=()=>{revision++;controller?.abort();clear();};
  return {
    async start(stops,language){
      if(disposed)return;
      reset();const request=revision;controller=new AbortController();const signal=controller.signal;
      const snapshot=Array.isArray(stops)?stops.map(p=>({...p})):[];
      const emit=state=>{if(!disposed&&request===revision)onChange({...emptyNavigation(),stops:snapshot,...state});};
      try{
        deliveryRouteRequest({lat:0,lng:0},snapshot,language);
        emit({phase:'locating'});
        const origin=await locate({signal});if(disposed||request!==revision)return;
        emit({phase:'routing',origin});
        const route=await compute(origin,snapshot,language);if(disposed||request!==revision)return;
        draw(route,origin,snapshot);emit({phase:'ready',origin,route});
      }catch(error){if(error?.code!=='CANCELLED')emit({phase:'error',error:error?.code||'ROUTE_UNAVAILABLE'});}
    },
    clear(){reset();if(!disposed)onChange(emptyNavigation());},
    destroy(){disposed=true;reset();}
  };
}

export function deliveryNavigationMessage(code){
  return ({GPS_DENIED:'Allow location access in your browser to get directions from your position.',GPS_INSECURE:'Location access requires HTTPS or localhost.',GPS_UNAVAILABLE:'Your position is unavailable. Turn on device location and try again.',GPS_TIMEOUT:'Location timed out. Allow location access, then try again.',GPS_INACCURATE:'Your GPS position is too imprecise. Move outdoors and try again.',ROUTE_INVALID_PIN:'Choose one to three stops with valid saved GPS pins.',ROUTE_CONFIGURATION:'Routes access was refused. An administrator must enable Routes API and allow it on the current map key.',ROUTE_QUOTA:'The directions limit has been reached. Try again later.',ROUTE_NOT_FOUND:'No driving route was found to this pin. Check the delivery entrance.',ROUTE_TIMEOUT:'Directions took too long. Check your connection and try again.',ROUTE_GOOGLE_REQUIRED:'Directions require the Google map to be available.',ROUTE_UNAVAILABLE:'Directions could not load. Check your connection and try again.'})[code]||'Directions could not load. Check your connection and try again.';
}
