'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {getLanguage,ui} from '@/lib/i18n';
import {Maximize2,Minimize2,Navigation,LocateFixed,MapPin,X} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {computeDeliveryRoute,createDeliveryNavigator,emptyNavigation,deliveryNavigationMessage} from '@/lib/customer-map-navigation';
import CustomerInfo from './CustomerInfo';
import {customerPinElement,customerPinSize} from '@/lib/customer-map-pin';
import {loadGoogleMaps,googleMapsLibrary,googleMapsFailureMessage,safeGoogleMapsDiagnostic} from '@/lib/google-maps';
import {hasCustomerLocation} from '@/lib/customer-location';
import {YAOUNDE_CENTER,CAMEROON_BOUNDS,ZONE_MAP_COLOURS} from '@/lib/customer-map-zones';

export function leafletAdapter(L,element,onPoint,onZone,onVertex){
  const map=L.map(element,{preferCanvas:true,scrollWheelZoom:false}).setView([YAOUNDE_CENTER.lat,YAOUNDE_CENTER.lng],12);
  const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).addTo(map);
  const layers=L.layerGroup().addTo(map);
  map.on('click',e=>onVertex({lat:e.latlng.lat,lng:e.latlng.lng}));
  return {
    render(points,zones,selected,draft,drawing){
      layers.clearLayers();
      for(const zone of zones)if(zone.boundary?.length>=3){
        const polygon=L.polygon(zone.boundary.map(p=>[p.lat,p.lng]),{color:ZONE_MAP_COLOURS[zone.colour]||ZONE_MAP_COLOURS.green,weight:2,fillOpacity:.1,bubblingMouseEvents:false,interactive:!drawing}).addTo(layers);
        polygon.on('click',()=>onZone(zone));
      }
      for(const p of points)if(hasCustomerLocation(p)){
        const zone=zones.find(z=>z.id===p.zone_id),colour=p.gps_status==='ready'?(ZONE_MAP_COLOURS[zone?.colour]||'#059669'):'#64748b';
        const size=customerPinSize(p.id===selected),icon=L.divIcon({className:'yola-map-marker',html:customerPinElement({colour,selected:p.id===selected,title:p.business_name}),iconSize:[size.width,size.height],iconAnchor:[size.width/2,size.height],popupAnchor:[0,-size.height]});
        L.marker([Number(p.gps_lat),Number(p.gps_lng)],{icon,title:p.business_name,alt:p.business_name||'YOLA',zIndexOffset:p.id===selected?1000:0,bubblingMouseEvents:false,keyboard:!drawing,interactive:!drawing}).addTo(layers).on('click',()=>{if(!drawing)onPoint(p);});
      }
      if(points.length===1&&hasCustomerLocation(points[0])&&Number(points[0].gps_accuracy_m)>0)L.circle([Number(points[0].gps_lat),Number(points[0].gps_lng)],{radius:Number(points[0].gps_accuracy_m),color:'#059669',weight:1,fillOpacity:.08,interactive:false}).addTo(layers);
      if(draft.length)L.polyline(draft.map(p=>[p.lat,p.lng]),{color:'#059669',weight:3,dashArray:'6 5',interactive:false}).addTo(layers);
      for(const p of draft)L.circleMarker([p.lat,p.lng],{radius:4,color:'#059669',interactive:false}).addTo(layers);
    },
    frame(kind,points){
      if(kind==='cameroon')map.fitBounds(CAMEROON_BOUNDS);
      else if(kind==='yaounde')map.setView([YAOUNDE_CENTER.lat,YAOUNDE_CENTER.lng],12);
      else {const located=points.filter(hasCustomerLocation);if(located.length)map.fitBounds(L.latLngBounds(located.map(p=>[Number(p.gps_lat),Number(p.gps_lng)])),{padding:[30,30],maxZoom:17});}
    },
    setExpanded(value){if(value)map.scrollWheelZoom.enable();else map.scrollWheelZoom.disable();},
    clearRoute(){},
    resize(){map.invalidateSize();},
    destroy(){tiles.off();map.remove();}
  };
}
export async function googleAdapter(element,key,onPoint,onZone,onVertex){
  const maps=await loadGoogleMaps(key),[{Map,Polygon,Polyline,Circle},{AdvancedMarkerElement}]=await googleMapsLibrary(Promise.all([maps.importLibrary('maps'),maps.importLibrary('marker')]));
  const map=new Map(element,{center:YAOUNDE_CENTER,zoom:12,mapId:process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID||'DEMO_MAP_ID',gestureHandling:'cooperative',streetViewControl:false,mapTypeControl:false,fullscreenControl:false,clickableIcons:false});
  let routeLayers=[];
  const clearRoute=()=>{routeLayers.forEach(layer=>layer.setMap(null));routeLayers=[];};
  let layers=[],listeners=[];const clear=()=>{listeners.forEach(l=>l.remove());listeners=[];layers.forEach(l=>{'setMap' in l?l.setMap(null):l.map=null;});layers=[];};
  const click=map.addListener('click',e=>{if(e.latLng)onVertex({lat:e.latLng.lat(),lng:e.latLng.lng()});});
  const pinPadding=()=>({top:Math.min(110,(element.clientHeight||480)*.4),right:Math.min(95,(element.clientWidth||600)*.23),bottom:Math.min(35,(element.clientHeight||480)*.1),left:Math.min(95,(element.clientWidth||600)*.23)});
  return {
    render(points,zones,selected,draft,drawing){
      clear();
      for(const zone of zones)if(zone.boundary?.length>=3){const polygon=new Polygon({map,paths:zone.boundary,strokeColor:ZONE_MAP_COLOURS[zone.colour]||'#059669',fillColor:ZONE_MAP_COLOURS[zone.colour]||'#059669',strokeWeight:2,fillOpacity:.1,clickable:!drawing});layers.push(polygon);listeners.push(polygon.addListener('click',()=>onZone(zone)));}
      for(const p of points)if(hasCustomerLocation(p)){
        const zone=zones.find(z=>z.id===p.zone_id),colour=p.gps_status==='ready'?(ZONE_MAP_COLOURS[zone?.colour]||'#059669'):'#64748b',pin=customerPinElement({colour,selected:p.id===selected,title:p.business_name});
        const marker=new AdvancedMarkerElement({map,position:{lat:Number(p.gps_lat),lng:Number(p.gps_lng)},title:p.business_name,content:pin,anchorLeft:'-50%',anchorTop:'-100%',zIndex:p.id===selected?1000:10,gmpClickable:!drawing});layers.push(marker);listeners.push(marker.addListener('click',()=>{if(!drawing)onPoint(p);}));
      }
      if(points.length===1&&hasCustomerLocation(points[0])&&Number(points[0].gps_accuracy_m)>0)layers.push(new Circle({map,center:{lat:Number(points[0].gps_lat),lng:Number(points[0].gps_lng)},radius:Number(points[0].gps_accuracy_m),strokeColor:'#059669',strokeWeight:1,fillOpacity:.08,clickable:false}));
      for(const vertex of draft)layers.push(new Circle({map,center:vertex,radius:12,fillColor:'#059669',fillOpacity:1,strokeWeight:1,clickable:false}));
      if(draft.length)layers.push(new Polyline({map,path:draft,strokeColor:'#059669',strokeWeight:3,clickable:false}));
    },
    frame(kind,points){
      if(kind==='yaounde'){map.setCenter(YAOUNDE_CENTER);map.setZoom(12);return;}
      const bounds=new maps.LatLngBounds();
      if(kind==='cameroon')CAMEROON_BOUNDS.forEach(([lat,lng])=>bounds.extend({lat,lng}));
      else points.filter(hasCustomerLocation).forEach(p=>bounds.extend({lat:Number(p.gps_lat),lng:Number(p.gps_lng)}));
      if(!bounds.isEmpty()){map.fitBounds(bounds,kind==='cameroon'?30:pinPadding());if(kind!=='cameroon')maps.event.addListenerOnce(map,'idle',()=>{if(map.getZoom()>17)map.setZoom(17);});}
    },
    setExpanded(value){map.setOptions({gestureHandling:value?'greedy':'cooperative'});},
    computeRoute(origin,stops,language){return computeDeliveryRoute(maps,origin,stops,language);},
    clearRoute,
    showRoute(route,origin,stops){
      clearRoute();
      routeLayers=route.createPolylines();
      for(const line of routeLayers){line.setOptions({strokeColor:'#059669',strokeOpacity:.95,strokeWeight:6,zIndex:5,clickable:false});line.setMap(map);}
      const position={lat:origin.lat,lng:origin.lng};
      routeLayers.push(new Circle({map,center:position,radius:origin.accuracy,strokeColor:'#2563eb',strokeWeight:1,fillColor:'#2563eb',fillOpacity:.08,clickable:false}));
      routeLayers.push(new Circle({map,center:position,radius:6,strokeColor:'#ffffff',strokeWeight:2,fillColor:'#2563eb',fillOpacity:1,zIndex:20,clickable:false}));
      const bounds=new maps.LatLngBounds();bounds.extend(position);
      route.path.forEach(p=>bounds.extend(p));
      stops.forEach(p=>bounds.extend({lat:Number(p.gps_lat),lng:Number(p.gps_lng)}));
      map.fitBounds(bounds,pinPadding());
    },
    resize(){maps.event.trigger(map,'resize');},
    destroy(){clearRoute();clear();click.remove();maps.event.clearInstanceListeners(map);element.replaceChildren();}
  };
}
export default function CustomerGeoMap({points=[],zones=[],selectedId='',onSelect,onClearSelection,onZoneSelect,drawing=false,draft=[],onVertex,frame,navigationRequest,initialExpanded=false,onClose,drawingControls}){
  const element=useRef(null),fullHost=useRef(null),canvas=useRef(null),adapter=useRef(null),navigator=useRef(null),callbacks=useRef({}),latestPoints=useRef(points),lastRequest=useRef(null);
  const [ready,setReady]=useState(0),[status,setStatus]=useState('loading'),[provider,setProvider]=useState(''),[error,setError]=useState(''),[useGoogle,setUseGoogle]=useState(true),[diagnostic,setDiagnostic]=useState('');
  const [expanded,setExpanded]=useState(initialExpanded),[localSelected,setLocalSelected]=useState(selectedId),[navigation,setNavigation]=useState(emptyNavigation);
  const expandedRef=useRef(expanded),navigationRef=useRef(navigation);
  expandedRef.current=expanded;navigationRef.current=navigation;latestPoints.current=points;
  callbacks.current={onSelect,onClearSelection,onZoneSelect,onVertex,drawing};
  const moveCanvas=useCallback(()=>{
    const host=expandedRef.current&&fullHost.current?fullHost.current:element.current;
    if(canvas.current&&host&&canvas.current.parentNode!==host)host.append(canvas.current);
    adapter.current?.setExpanded(expandedRef.current);adapter.current?.resize();
  },[]);
  const setFullHost=useCallback(node=>{fullHost.current=node;moveCanvas();},[moveCanvas]);
  const closeFull=()=>{if(initialExpanded&&onClose)onClose();else setExpanded(false);};
  const clearSelection=()=>{navigator.current?.clear();setLocalSelected('');callbacks.current.onClearSelection?.();};
  const startRoute=stops=>{
    setExpanded(true);
    if(!adapter.current?.computeRoute){setNavigation({...emptyNavigation(),phase:'error',stops,error:'ROUTE_GOOGLE_REQUIRED'});return;}
    navigator.current?.start(stops,getLanguage());
  };
  useEffect(()=>{
    let active=true,instance,resize;
    const surface=document.createElement('div');surface.style.cssText='height:100%;width:100%';canvas.current=surface;moveCanvas();
    const authFailed=()=>{setError(ui(googleMapsFailureMessage({code:'MAPS_AUTHORIZATION'})));setDiagnostic('MAPS_AUTHORIZATION');setUseGoogle(false);};
    window.addEventListener('soeicam:maps-auth-error',authFailed);setStatus('loading');setNavigation(emptyNavigation());
    const select=p=>{navigator.current?.clear();setLocalSelected(p.id);callbacks.current.onSelect?.(p);};
    const selectZone=z=>callbacks.current.onZoneSelect?.(z),vertex=p=>{if(callbacks.current.drawing)callbacks.current.onVertex?.(p);};
    async function start(){
      const key=process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      try{
        if(key&&useGoogle){try{instance=await googleAdapter(surface,key,select,selectZone,vertex);if(active)setProvider('Google Maps');}catch(reason){if(active){setError(ui(googleMapsFailureMessage(reason)));setDiagnostic(safeGoogleMapsDiagnostic(reason));surface.replaceChildren();}}}
        if(!instance){if(active){setStatus('error');setProvider('');if(!key)setError(ui('Configure the Google Maps key and map ID to display customer locations.'));}return;}
        if(!active){instance.destroy();return;}
        adapter.current=instance;
        navigator.current=createDeliveryNavigator({compute:(origin,stops,language)=>instance.computeRoute(origin,stops,language),draw:(route,origin,stops)=>instance.showRoute(route,origin,stops),clear:()=>instance.clearRoute(),onChange:setNavigation});
        resize=new ResizeObserver(()=>instance.resize());resize.observe(surface);
        moveCanvas();setStatus('ready');setReady(n=>n+1);
      }catch{if(active){setStatus('error');setError(ui('The map could not load. Customer locations remain available in the list.'));}}
    }
    start();
    return()=>{active=false;navigator.current?.destroy();navigator.current=null;resize?.disconnect();instance?.destroy();adapter.current=null;surface.remove();if(canvas.current===surface)canvas.current=null;window.removeEventListener('soeicam:maps-auth-error',authFailed);};
  },[useGoogle,moveCanvas]);
  useEffect(()=>{setLocalSelected(selectedId);},[selectedId]);
  useEffect(()=>{adapter.current?.render(points,zones,localSelected,draft,drawing);},[points,zones,localSelected,draft,drawing,ready]);
  // Changes to a selection, route or viewport size must not reset the camera.
  useEffect(()=>{if(frame)adapter.current?.frame(frame.kind,latestPoints.current);},[frame,ready]);
  useEffect(()=>{moveCanvas();},[expanded,ready,moveCanvas]);
  useEffect(()=>{
    if(status!=='ready'||!navigationRequest||lastRequest.current===navigationRequest)return;
    lastRequest.current=navigationRequest;
    const stops=navigationRequest.points||[];setExpanded(true);
    if(stops[0])setLocalSelected(stops[0].id);
    if(navigationRequest.viewOnly){navigator.current?.clear();adapter.current?.frame('points',stops);}
    else startRoute(stops);
  },[navigationRequest,ready,status]);
  const signature=points.map(p=>[p.id,p.gps_lat,p.gps_lng].join(':')).join('|');
  useEffect(()=>{
    const state=navigationRef.current;
    if(state.stops.some(p=>p.id&&!points.some(current=>current.id===p.id&&Number(current.gps_lat)===Number(p.gps_lat)&&Number(current.gps_lng)===Number(p.gps_lng))))navigator.current?.clear();
  },[signature]);
  useEffect(()=>{if(drawing){navigator.current?.clear();setLocalSelected('');}},[drawing]);
  const selected=points.find(p=>p.id===localSelected&&hasCustomerLocation(p));
  const busy=navigation.phase==='locating'||navigation.phase==='routing';
  const actionClass='inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border bg-white px-3 text-xs font-medium text-slate-800 disabled:opacity-50';
  const route=navigation.route,stops=navigation.stops;
  const distance=meters=>Number.isFinite(meters)?(meters<1000?ui('{0} m',Math.round(meters)):ui('{0} km',(meters/1000).toFixed(1))):'';
  function content(full){
    return <div className={'flex min-h-0 min-w-0 flex-col bg-white '+(full?'h-full':'')}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-white p-2" style={full?{paddingTop:'max(.5rem, env(safe-area-inset-top))',paddingLeft:'max(.5rem, env(safe-area-inset-left))',paddingRight:'max(.5rem, env(safe-area-inset-right))'}:undefined}>
        <div className="flex min-w-0 items-center gap-1.5"><MapPin size={16} className="shrink-0 text-emerald-700"/><span className="text-xs font-semibold">{ui('Delivery map')}</span></div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={actionClass} disabled={status!=='ready'} onClick={()=>adapter.current?.frame('points',latestPoints.current)}><LocateFixed size={15}/>{ui('Show pins')}</button>
          <button type="button" className={actionClass} aria-label={ui(full?'Close full map':'Expand map')} onClick={()=>full?closeFull():setExpanded(true)}>{full?<Minimize2 size={15}/>:<Maximize2 size={15}/>}<span>{ui(full?'Close':'Full map')}</span></button>
        </div>
      </div>
      <div className={'relative isolate min-w-0 overflow-hidden bg-slate-100 '+(full?'min-h-24 flex-1':'h-[52svh] min-h-[280px] sm:h-[560px]')}>
        <div ref={full?setFullHost:element} className="h-full w-full" role="region" aria-label={ui('Customer delivery map')}/>
        {status==='loading'&&<p role="status" className="pointer-events-none absolute left-3 top-3 z-[500] rounded bg-white p-2 text-xs shadow">{ui('Loading map...')}</p>}
      </div>
      {status==='ready'&&!drawing&&(selected||navigation.phase!=='idle')&&<section aria-label={ui('Delivery directions')} className="max-h-[38dvh] shrink-0 space-y-2 overflow-y-auto overscroll-contain border-t p-3 text-sm">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0">
          <p className="break-words font-semibold">{navigation.phase!=='idle'?stops.map(p=>p.business_name||ui('Customer')).join(' → '):selected?.business_name}</p>
          {selected&&navigation.phase==='idle'&&<><p className="break-words text-xs text-slate-500">{[selected.address,selected.neighbourhood,selected.town].filter(Boolean).join(', ')}</p>{selected.gps_status!=='ready'&&<p className="text-xs text-amber-700">{ui('Delivery pin needs verification.')}</p>}</>}
        </div><button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" aria-label={ui('Close delivery directions')} onClick={clearSelection}><X size={17}/></button></div>
        {navigation.phase==='idle'&&selected&&<button type="button" disabled={status!=='ready'} onClick={()=>startRoute([selected])} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-xs font-semibold text-white disabled:opacity-50"><Navigation size={16}/>{ui('Directions from my location')}</button>}
        {busy&&<div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-xs">{ui(navigation.phase==='locating'?'Finding your position...':'Calculating driving route...')}</p><button type="button" className={actionClass} onClick={()=>navigator.current?.clear()}>{ui('Cancel')}</button></div>}
        {navigation.phase==='error'&&<div className="space-y-2">
          {navigation.origin&&<p role="status" className="text-xs text-emerald-800">{ui('Your GPS position was obtained.')}</p>}
          <p role="alert" className="text-xs text-amber-800">{ui(deliveryNavigationMessage(navigation.error))}</p>
          <div className="flex items-center gap-2"><button type="button" className={actionClass} onClick={()=>startRoute(stops)}>{ui('Try again')}</button>
            <CustomerInfo title={ui('Directions diagnostics')}>
              <p>{ui(navigation.failureStage==='display'?'The route response was received; displaying it failed.':navigation.origin?'GPS succeeded; the directions service request failed.':'The device position could not be obtained.')}</p>
              <p className="break-words font-mono">{navigation.error}{navigation.providerCode?' / '+navigation.providerCode:''}</p>
              {navigation.error==='ROUTE_CONFIGURATION'&&<p>{ui('Enable Routes API in Google Cloud and allow it in the existing map key API restrictions. Keep the website restrictions for this ERP address.')}</p>}
            </CustomerInfo>
          </div>
        </div>}
        {navigation.phase==='ready'&&route&&<>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-emerald-800">{distance(route.distanceMeters)}{Number.isFinite(route.durationMillis)?' · '+ui('Approx. {0} min',Math.max(1,Math.ceil(route.durationMillis/60000))):''}</p><button type="button" className={actionClass} onClick={()=>startRoute(stops)}><LocateFixed size={15}/>{ui('Update from my position')}</button></div>
          <details><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium">{ui('Route steps')}</summary><div className="space-y-3 pb-2">{route.legs?.map((leg,i)=><div key={i}><p className="mb-2 break-words text-xs font-semibold">{ui('Stop {0}: {1}',i+1,stops[i]?.business_name||ui('Customer'))}</p><ol className="list-decimal space-y-2 pl-5 text-xs">{leg.steps?.map((step,index)=><li key={index} className="break-words pl-1">{step.instructions}<span className="ml-2 text-slate-500">{distance(step.distanceMeters)}</span></li>)}</ol></div>)}</div></details>
          {route.warnings?.map((warning,index)=><p key={index} className="break-words text-xs text-amber-800">{warning}</p>)}
          <CustomerInfo title={ui('About these directions')}><p>{ui('Driving route from your last requested GPS position. Use Update from my position to recalculate. This does not change customer pins.')}</p><p>{ui('The road route may stop before the saved entrance. Follow the YOLA pin for the exact customer location.')}</p>{navigation.origin?.accuracy>100&&<p>{ui('GPS accuracy: approximately {0} m.',Math.round(navigation.origin.accuracy))}</p>}</CustomerInfo>
          <button type="button" className="min-h-11 text-xs font-medium text-slate-600" onClick={()=>navigator.current?.clear()}>{ui('Clear route')}</button>
        </>}
      </section>}
      {drawing&&full&&<div className="max-h-[30dvh] shrink-0 overflow-y-auto border-t p-2">{drawingControls||<p className="text-xs">{ui('Tap the map to add corners around the delivery area.')}</p>}</div>}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-t bg-white px-3 py-2 text-[10px] text-slate-500" style={full?{paddingBottom:'max(.5rem, env(safe-area-inset-bottom))'}:undefined}><span>{provider}</span><CustomerInfo title={ui('Map display')}><p>{ui('YOLA pins: customer GPS. Coloured border: verified. Grey: verify location.')}</p><p>{ui('Ordinary businesses and landmark labels are controlled by the published Google Cloud map style linked to this map ID.')}</p></CustomerInfo></div>
      {error&&<div role="status" className="max-h-[22dvh] shrink-0 overflow-y-auto border-t border-amber-200 bg-amber-50 p-3 text-xs text-slate-700"><p>{error}</p><button type="button" onClick={()=>window.location.reload()} className="mt-2 min-h-10 rounded-md border bg-white px-3 font-medium">{ui('Reload page')}</button>{diagnostic&&<CustomerInfo title={ui('Google Maps status')}><p>{ui('Allow this website in Google Cloud: {0}',typeof window!=='undefined'?window.location.origin+'/*':'http://localhost:5175/*')}</p><p className="break-words font-mono">{diagnostic}</p></CustomerInfo>}</div>}
    </div>;
  }
  return <div className="min-w-0">
    <div hidden={expanded} className="overflow-hidden rounded-xl border">{content(false)}</div>
    {expanded&&<p className="py-4 text-xs text-slate-500">{ui('Map expanded')}</p>}
    <Dialog open={expanded} onOpenChange={value=>{if(!value)closeFull();}}>
      <DialogContent style={{animation:'none'}} className="left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:rounded-none sm:p-0 duration-0 data-[state=open]:animate-none data-[state=closed]:animate-none [&>button:last-child]:hidden" onOpenAutoFocus={event=>{event.preventDefault();fullHost.current?.parentNode?.parentNode?.querySelector('button')?.focus();}}>
        <DialogTitle className="sr-only">{ui('Customer delivery map')}</DialogTitle>
        <DialogDescription className="sr-only">{ui('Customer pins and driving directions inside the ERP.')}</DialogDescription>
        {content(true)}
      </DialogContent>
    </Dialog>
  </div>;
}
