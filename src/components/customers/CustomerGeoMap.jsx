'use client';
import React,{useEffect,useRef,useState} from 'react';
import {ui} from '@/lib/i18n';
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
    resize(){map.invalidateSize();},
    destroy(){tiles.off();map.remove();}
  };
}
export async function googleAdapter(element,key,onPoint,onZone,onVertex){
  const maps=await loadGoogleMaps(key),[{Map,Polygon,Polyline,Circle},{AdvancedMarkerElement}]=await googleMapsLibrary(Promise.all([maps.importLibrary('maps'),maps.importLibrary('marker')]));
  const map=new Map(element,{center:YAOUNDE_CENTER,zoom:12,mapId:process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID||'DEMO_MAP_ID',gestureHandling:'cooperative',streetViewControl:false,mapTypeControl:false,fullscreenControl:false});
  let layers=[],listeners=[];const clear=()=>{listeners.forEach(l=>l.remove());listeners=[];layers.forEach(l=>{'setMap' in l?l.setMap(null):l.map=null;});layers=[];};
  const click=map.addListener('click',e=>{if(e.latLng)onVertex({lat:e.latLng.lat(),lng:e.latLng.lng()});});
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
      if(!bounds.isEmpty()){map.fitBounds(bounds,30);if(kind!=='cameroon')maps.event.addListenerOnce(map,'idle',()=>{if(map.getZoom()>17)map.setZoom(17);});}
    },
    resize(){maps.event.trigger(map,'resize');},
    destroy(){clear();click.remove();maps.event.clearInstanceListeners(map);element.replaceChildren();}
  };
}
export default function CustomerGeoMap({points=[],zones=[],selectedId='',onSelect,onZoneSelect,drawing=false,draft=[],onVertex,frame}){
  const element=useRef(null),adapter=useRef(null),callbacks=useRef({}),[ready,setReady]=useState(0),[status,setStatus]=useState('loading'),[provider,setProvider]=useState(''),[error,setError]=useState(''),[useGoogle,setUseGoogle]=useState(true),[diagnostic,setDiagnostic]=useState('');
  callbacks.current={onSelect,onZoneSelect,onVertex,drawing};
  useEffect(()=>{
    let active=true,instance,resize;
    const canvas=document.createElement("div");canvas.style.cssText="height:100%;width:100%";element.current.append(canvas);
    const authFailed=()=>{setError(ui(googleMapsFailureMessage({code:'MAPS_AUTHORIZATION'})));setDiagnostic('MAPS_AUTHORIZATION');setUseGoogle(false);};window.addEventListener("soeicam:maps-auth-error",authFailed);setStatus("loading");
    const select=p=>callbacks.current.onSelect?.(p),selectZone=z=>callbacks.current.onZoneSelect?.(z),vertex=p=>{if(callbacks.current.drawing)callbacks.current.onVertex?.(p);};
    async function start(){
      const key=process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      try {
        if(key&&useGoogle){try{instance=await googleAdapter(canvas,key,select,selectZone,vertex);if(active)setProvider('Google Maps');}catch(reason){if(active){setError(ui(googleMapsFailureMessage(reason)));setDiagnostic(safeGoogleMapsDiagnostic(reason));canvas.replaceChildren();}}}
        if(!instance){const module=await import('leaflet');if(!active)return;instance=leafletAdapter(module.default||module,canvas,select,selectZone,vertex);if(active)setProvider('OpenStreetMap');}
        if(!active){instance.destroy();return;}
        adapter.current=instance;resize=new ResizeObserver(()=>instance.resize());resize.observe(element.current);setStatus('ready');setReady(n=>n+1);
      }catch{if(active){setStatus('error');setError(ui('The map could not load. Customer locations remain available in the list.'));}}
    }
    start();return()=>{active=false;resize?.disconnect();instance?.destroy();adapter.current=null;canvas.remove();window.removeEventListener("soeicam:maps-auth-error",authFailed);};
  },[useGoogle]);
  useEffect(()=>{adapter.current?.render(points,zones,selectedId,draft,drawing);},[points,zones,selectedId,draft,drawing,ready]);
  useEffect(()=>{if(frame)adapter.current?.frame(frame.kind,points);},[frame,ready,points]);
  return <div className="min-w-0 space-y-2"><link rel="stylesheet" href="/maps/leaflet-1.9.4/leaflet.css" precedence="customer-map"/>
    <div className="relative isolate overflow-hidden rounded-xl border bg-slate-100">
      <div ref={element} className="h-[52svh] min-h-80 w-full sm:h-[560px]" role="region" aria-label={ui('Customer delivery map')}/>
      {status==='loading'&&<p role="status" className="absolute left-3 top-3 z-[500] rounded bg-white p-2 text-xs shadow">{ui('Loading map...')}</p>}
    </div>
    <div className="flex flex-wrap justify-between gap-2 text-[11px] text-slate-500"><span>{provider}</span><span>{ui('YOLA pins: customer GPS. Coloured border: verified. Grey: verify location.')}</span></div>
    {error&&<div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-slate-700"><p className="min-w-0 flex-1">{error}</p><button type="button" onClick={()=>window.location.reload()} className="min-h-10 shrink-0 rounded-md border bg-white px-3 font-medium">{ui('Reload page')}</button>{diagnostic&&<CustomerInfo title={ui('Google Maps status')}><p>{ui('The Google Maps API key and map ID are configured. This map uses OpenStreetMap only when Google Maps cannot start.')}</p><p>{ui('Allow this website in Google Cloud: {0}',typeof window!=='undefined'?window.location.origin+'/*':'http://localhost:5175/*')}</p><p className="break-words font-mono">{diagnostic}</p></CustomerInfo>}</div>}
  </div>;
}
