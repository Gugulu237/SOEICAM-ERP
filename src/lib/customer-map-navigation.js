import {hasCustomerLocation} from './customer-location';
import {googleMapsLibrary} from './google-maps';

const failure=code=>Object.assign(new Error(code),{code});
export const emptyNavigation=()=>({phase:'idle',stops:[],origin:null,route:null,error:'',providerCode:'',failureStage:''});

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
  return {origin:{lat:origin.lat,lng:origin.lng},destination:location(stops.at(-1)),intermediates:stops.slice(0,-1).map(p=>({location:location(p)})),travelMode:'DRIVING',routingPreference:'TRAFFIC_UNAWARE',optimizeWaypointOrder:false,computeAlternativeRoutes:false,language:language==='fr'?'fr':'en',region:'cm',fields:['path','distanceMeters','durationMillis','legs','warnings']};
}

// Keep only an allowlisted provider status, never a raw message, key, URL or GPS.
export function deliveryRouteFailure(error){
  const text=[],numbers=[],seen=new Set();
  function inspect(value,depth=0){
    if(value==null||depth>4||seen.has(value))return;
    if(typeof value==='string'){text.push(value);return;}
    if(typeof value!=='object')return;
    seen.add(value);
    for(const key of ['name','code','status','statusCode','reason','message']){
      if(typeof value[key]==='string'){
        if(['code','status','statusCode'].includes(key)&&/^\d{1,3}$/.test(value[key]))numbers.push(Number(value[key]));
        else text.push(value[key]);
      }
      else if(typeof value[key]==='number')numbers.push(value[key]);
    }
    for(const key of ['cause','error','details','response','data']){
      const nested=value[key];
      if(Array.isArray(nested))nested.slice(0,10).forEach(item=>inspect(item,depth+1));
      else inspect(nested,depth+1);
    }
  }
  inspect(error);const diagnostic=text.join(' ');
  const result=(code,providerCode)=>Object.assign(failure(code),{providerCode});
  if(/PERMISSION_DENIED|REQUEST_DENIED|UNAUTHENTICATED|API_KEY|API_NOT_ACTIVATED|SERVICE_DISABLED|BILLING|AUTHORI[ZS]|not enabled|not authorized|access denied/i.test(diagnostic)||numbers.some(n=>[7,16,401,403].includes(n)))return result('ROUTE_CONFIGURATION',/SERVICE_DISABLED|API_NOT_ACTIVATED|not enabled/i.test(diagnostic)?'SERVICE_DISABLED':'PERMISSION_DENIED');
  if(/QUOTA|RESOURCE_EXHAUSTED|OVER_QUERY_LIMIT|OVER_DAILY_LIMIT/i.test(diagnostic)||numbers.some(n=>[8,429].includes(n)))return result('ROUTE_QUOTA','RESOURCE_EXHAUSTED');
  if(/INVALID_ARGUMENT|INVALID_REQUEST|InvalidValueError|Unknown UnitSystem|not an accepted value|invalid field mask/i.test(diagnostic)||numbers.some(n=>[3,400].includes(n)))return result('ROUTE_INVALID_REQUEST','INVALID_ARGUMENT');
  if(/ZERO_RESULTS|NOT_FOUND/i.test(diagnostic)||numbers.some(n=>[5,404].includes(n)))return result('ROUTE_NOT_FOUND','NOT_FOUND');
  if(/MAPS_TIMEOUT|DEADLINE_EXCEEDED|timed out/i.test(diagnostic)||numbers.some(n=>[4,408,504].includes(n)))return result('ROUTE_TIMEOUT','DEADLINE_EXCEEDED');
  if(/MAPS_NETWORK|Failed to fetch|NetworkError|ERR_NETWORK|ERR_BLOCKED|Load failed/i.test(diagnostic))return result('ROUTE_NETWORK','NETWORK_ERROR');
  return result('ROUTE_UNAVAILABLE','UNKNOWN');
}

export async function computeDeliveryRoute(maps,origin,stops,language){
  const request=deliveryRouteRequest(origin,stops,language);
  try{
    const {Route}=await googleMapsLibrary(maps.importLibrary('routes'));
    if(!Route?.computeRoutes)throw failure('ROUTE_CONFIGURATION');
    // The JS SDK uses its numeric UnitSystem enum (METRIC = 0), not the
    // REST API string "METRIC", which fails before a network request is sent.
    if(typeof maps.UnitSystem?.METRIC==='number')request.units=maps.UnitSystem.METRIC;
    const result=await googleMapsLibrary(Route.computeRoutes(request));
    const route=result?.routes?.[0];
    if(!route?.path?.length)throw failure('ROUTE_NOT_FOUND');
    return route;
  }catch(error){
    if(['ROUTE_CONFIGURATION','ROUTE_NOT_FOUND'].includes(error?.code))throw error;
    throw deliveryRouteFailure(error);
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
      let origin=null,failureStage='location';
      try{
        deliveryRouteRequest({lat:0,lng:0},snapshot,language);
        emit({phase:'locating'});
        origin=await locate({signal});if(disposed||request!==revision)return;
        failureStage='request';
        emit({phase:'routing',origin});
        const route=await compute(origin,snapshot,language);if(disposed||request!==revision)return;
        failureStage='display';draw(route,origin,snapshot);emit({phase:'ready',origin,route});
      }catch(error){
        if(disposed||request!==revision||error?.code==='CANCELLED')return;
        if(failureStage==='display')clear();
        emit({phase:'error',origin,failureStage,error:failureStage==='display'?'ROUTE_DISPLAY':error?.code||'ROUTE_UNAVAILABLE',providerCode:error?.providerCode||''});
      }
    },
    clear(){reset();if(!disposed)onChange(emptyNavigation());},
    destroy(){disposed=true;reset();}
  };
}

export function deliveryNavigationMessage(code){
  if(code==='ROUTE_INVALID_REQUEST')return 'The directions request was rejected. Ask an administrator to check the map integration.';
  if(code==='ROUTE_DISPLAY')return 'Directions were received, but the route could not be displayed. Reload the page and try again.';
  if(code==='ROUTE_NETWORK')return 'The browser could not reach Google directions. Check browser blocking and your connection, then try again.';
  if(code==='ROUTE_UNAVAILABLE')return 'Google could not calculate directions. Try again or ask an administrator to check routing access.';
  return ({GPS_DENIED:'Allow location access in your browser to get directions from your position.',GPS_INSECURE:'Location access requires HTTPS or localhost.',GPS_UNAVAILABLE:'Your position is unavailable. Turn on device location and try again.',GPS_TIMEOUT:'Location timed out. Allow location access, then try again.',GPS_INACCURATE:'Your GPS position is too imprecise. Move outdoors and try again.',ROUTE_INVALID_PIN:'Choose one to three stops with valid saved GPS pins.',ROUTE_CONFIGURATION:'Routes access was refused. An administrator must enable Routes API and allow it on the current map key.',ROUTE_QUOTA:'The directions limit has been reached. Try again later.',ROUTE_NOT_FOUND:'No driving route was found to this pin. Check the delivery entrance.',ROUTE_TIMEOUT:'Directions took too long. Check your connection and try again.',ROUTE_GOOGLE_REQUIRED:'Directions require the Google map to be available.'})[code]||'Google could not calculate directions. Try again or ask an administrator to check routing access.';
}
