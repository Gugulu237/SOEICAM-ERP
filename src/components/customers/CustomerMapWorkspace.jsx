'use client';
import React,{useEffect,useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import {Plus,Pencil,RefreshCw,Undo2,X} from 'lucide-react';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {useLocaleRender} from '@/lib/localization';
import {ui,uiMessage} from '@/lib/i18n';
import {customerDeliveryRequest} from '@/lib/customer-delivery-client';
import {hasCustomerLocation} from '@/lib/customer-location';
import {filterDeliveryPoints} from '@/lib/customer-delivery';
import {zoneDivision,zoneSubdivision,groupDeliveryZones,validateZoneBoundary,pointInDeliveryBoundary,zoneGpsMatches,ZONE_MAP_COLOURS} from '@/lib/customer-map-zones';
import {errorMessage} from '@/lib/field-ops';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import CustomerInfo from './CustomerInfo';

import {DeliveryZoneDialog,DeliveryPointDialog} from './CustomerDeliveryZones';
const CustomerGeoMap=dynamic(()=>import('./CustomerGeoMap'),{ssr:false,loading:()=> <p role="status" className="py-20 text-center text-sm">{ui('Loading map...')}</p>});
const emptyMatches={eligible:[],assigned:[],otherZones:[],unverified:[]};
export default function CustomerMapWorkspace({onOpenCustomer,onClose}){
  useLocaleRender();
  const {isAdmin,role}=useCurrentUser(),canAssign=isAdmin||role==='employee';
  const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0),[loading,setLoading]=useState(true),[search,setSearch]=useState(''),[zoneId,setZoneId]=useState(''),[municipality,setMunicipality]=useState(''),[point,setPoint]=useState(null),[editingPoint,setEditingPoint]=useState(false),[drawing,setDrawing]=useState(false),[draft,setDraft]=useState([]),[zoneDialog,setZoneDialog]=useState(null),[busy,setBusy]=useState(false),[frame,setFrame]=useState({kind:'points'}),[navigationRequest]=useState(null);
  useEffect(()=>{let active=true;setLoading(true);setError('');customerDeliveryRequest({action:'customerMapWorkspace'}).then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[reload]);
  const zones=useMemo(()=>data?.zones.filter(z=>z.is_active!==false)||[],[data]);
  const filtered=useMemo(()=>filterDeliveryPoints(data?.points||[],{search}).filter(p=>!zoneId||(zoneId==='unassigned'?!p.zone_id:p.zone_id===zoneId||pointInDeliveryBoundary(p,zones.find(z=>z.id===zoneId)?.boundary))).filter(p=>!municipality||zoneDivision(zones.find(z=>z.id===p.zone_id)||{})===municipality||(zoneId&&zoneDivision(zones.find(z=>z.id===zoneId)||{})===municipality&&pointInDeliveryBoundary(p,zones.find(z=>z.id===zoneId)?.boundary))),[data,zoneId,search,municipality,zones]);
  const selectedZone=zones.find(z=>z.id===zoneId);
  const matches=useMemo(()=>selectedZone?.boundary?.length>=3?zoneGpsMatches(data?.points||[],selectedZone):emptyMatches,[data,selectedZone]);
  const located=filtered.filter(hasCustomerLocation).length;
  const frameMap=kind=>setFrame({kind,nonce:Date.now()});
  function saved(result){setZoneDialog(null);setDrawing(false);setDraft([]);if(result?.zone)setZoneId(result.zone.id);setPoint(null);setEditingPoint(false);setReload(n=>n+1);}
  function finish(){try{const boundary=validateZoneBoundary(draft);if(boundary.length<3)throw Error('Draw a delivery boundary with 3 to 60 corners.');setZoneDialog({...selectedZone,boundary,town:selectedZone?.town||'Yaoundé',division:selectedZone?zoneDivision(selectedZone):municipality,subdivision:selectedZone?zoneSubdivision(selectedZone):''});setDrawing(false);setError('');}catch(e){setError(errorMessage(e));}}
  async function assign(){
    if(busy||loading)return;setBusy(true);setError('');setNotice('');
    try{const result=await customerDeliveryRequest({action:'assignDeliveryZoneByBoundary',zoneId:selectedZone.id,zoneRevision:data.revision,points:matches.eligible.slice(0,100).map(p=>({kind:p.kind,recordId:p.record_id,revision:p.delivery_revision}))});setNotice(ui('{0} delivery points assigned.',result.updated));setReload(n=>n+1);}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  const filterChange=setter=>e=>{setter(e.target.value);setPoint(null);setFrame({kind:'points',nonce:Date.now()});};
  const drawingControls=<div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3"><p role="status" className="w-full text-xs">{ui('Tap the map to add corners around the delivery area.')} {ui('{0} / 60 corners',draft.length)}</p><Button size="sm" disabled={draft.length<3} onClick={finish}>{ui('Finish boundary')}</Button><Button size="sm" variant="outline" disabled={!draft.length} onClick={()=>setDraft(v=>v.slice(0,-1))}><Undo2 size={14}/>{ui('Undo')}</Button><Button size="sm" variant="ghost" onClick={()=>{setDrawing(false);setDraft([]);}}><X size={14}/>{ui('Cancel')}</Button></div>;
  const mapControls=<div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1"><h2 className="text-base font-semibold">{ui('Customer delivery map')}</h2><CustomerInfo title={ui('Map and delivery zones')}><p>{ui('Customer pins use saved GPS coordinates. Grey pins need verification. Customers without GPS can be located from their profile.')}</p><p>{ui('Draw a delivery area, save its name and municipality, then review verified unassigned points inside it before assigning. Other zone assignments are preserved.')}</p><p>{ui('Municipalities are labels for your delivery zones. Drawn areas are not official administrative boundaries.')}</p><p>{ui('Only mark a zone as currently served when deliveries actually operate there.')}</p>{!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY&&<p>{ui('Configure NEXT_PUBLIC_GOOGLE_MAPS_API_KEY and a map ID with Maps JavaScript API enabled and billing configured. Enable Routes API on the same key for directions inside the ERP.')}</p>}</CustomerInfo></div><Button variant="outline" size="sm" disabled={loading||busy||drawing} onClick={()=>setReload(n=>n+1)}><RefreshCw size={14}/>{ui('Refresh')}</Button></div>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    {notice&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {loading&&!data?<p role="status" className="py-12 text-sm">{ui('Loading customer locations...')}</p>:data&&<>
      <div className="grid min-w-0 gap-2 sm:grid-cols-3"><label className="min-w-0 text-xs">{ui('Find a customer')}<Input className="mt-1 bg-white" value={search} onChange={filterChange(setSearch)} placeholder={ui('Name, phone or neighbourhood')}/></label><label className="min-w-0 text-xs">{ui('Delivery zone')}<select aria-label={ui('Map delivery zone')} disabled={drawing||busy} className="mt-1 h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm" value={zoneId} onChange={filterChange(setZoneId)}><option value="">{ui('All zones')}</option><option value="unassigned">{ui('Unassigned')}</option>{zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></label><label className="min-w-0 text-xs">{ui('Division')}<select aria-label={ui('Map division')} disabled={drawing} className="mt-1 h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm" value={municipality} onChange={filterChange(setMunicipality)}><option value="">{ui('All divisions')}</option>{groupDeliveryZones(zones).filter(group=>group.name).map(group=><option key={group.name} value={group.name}>{group.name}</option>)}</select></label></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={()=>frameMap('yaounde')}>{ui('Yaoundé')}</Button><Button size="sm" variant="outline" onClick={()=>frameMap('cameroon')}>{ui('Cameroon')}</Button><Button size="sm" variant="outline" disabled={!located} onClick={()=>frameMap('points')}>{ui('Show pins')}</Button>
        {isAdmin&&!drawing&&<><Button size="sm" disabled={busy||loading} onClick={()=>{setZoneId('');setMunicipality('');setSearch('');setDraft([]);setDrawing(true);setError('');}}><Plus size={14}/>{ui('Draw a zone')}</Button>{selectedZone&&<Button size="sm" variant="outline" disabled={busy||loading} onClick={()=>setZoneDialog(selectedZone)}><Pencil size={14}/>{ui('Edit zone')}</Button>}{selectedZone&&<Button size="sm" variant="outline" disabled={busy||loading} onClick={()=>{setDraft([]);setDrawing(true);setError('');}}>{ui('Redraw boundary')}</Button>}</>}
      </div>
      {drawing&&drawingControls}
      <p className="text-xs text-slate-500">{ui('{0} delivery points · {1} pins · {2} without GPS',filtered.length,located,filtered.length-located)}</p>
      {selectedZone&&<section className="space-y-3 rounded-xl border bg-white p-4"><div className="flex flex-wrap items-center gap-2"><span className="h-3 w-3 rounded-full" style={{background:ZONE_MAP_COLOURS[selectedZone.colour]||'#64748b'}}/><h3 className="font-semibold">{selectedZone.name}</h3><span className="text-xs text-slate-500">{[zoneDivision(selectedZone),zoneSubdivision(selectedZone)].filter(Boolean).join(' / ')}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{ui(selectedZone.service_status==='served'?'Currently served':selectedZone.service_status==='paused'?'Service paused':selectedZone.service_status==='planned'?'Planned coverage':'Coverage not specified')}</span></div>
        {selectedZone.boundary?.length>=3?<><div className="flex flex-wrap gap-x-4 gap-y-1 text-xs"><span>{ui('{0} verified and unassigned inside',matches.eligible.length)}</span><span>{ui('{0} in other zones',matches.otherZones.length)}</span><span>{ui('{0} pins to verify',matches.unverified.length)}</span></div>{canAssign&&<Button size="sm" disabled={busy||loading||!matches.eligible.length||selectedZone.service_status==='paused'} onClick={assign}>{busy?ui('Assigning...'):ui('Assign matched customers ({0})',Math.min(100,matches.eligible.length))}</Button>}{matches.eligible.length>100&&<p className="text-xs text-slate-500">{ui('Assign up to 100 points at a time, then review the remaining matches.')}</p>}</>:<p className="text-xs text-slate-500">{ui('This zone has no drawn boundary yet.')}</p>}
      </section>}
    </>}
  </div>;
  return <section className="min-w-0">
    {!data?mapControls:<CustomerGeoMap initialExpanded onClose={onClose} points={filtered} zones={zones} selectedId={point?.id} drawing={drawing} draft={draft} onVertex={p=>setDraft(v=>v.length<60?[...v,p]:v)} onSelect={p=>{if(!drawing)setPoint(p);}} onClearSelection={()=>setPoint(null)} navigationRequest={navigationRequest} drawingControls={drawingControls} mapControls={mapControls} onOpenCustomer={onOpenCustomer} onEditPoint={p=>{setPoint(p);setEditingPoint(true);}} onZoneSelect={z=>{if(!drawing){setZoneId(z.id);setMunicipality('');setPoint(null);}}} frame={frame}/>}
    {zoneDialog&&data&&<DeliveryZoneDialog key={zoneDialog.id||'new-map-zone'} zone={zoneDialog} zones={data.zones} revision={data.revision} onClose={()=>{setZoneDialog(null);if(draft.length)setDrawing(true);}} onSaved={saved}/>}
    {editingPoint&&point&&data&&<DeliveryPointDialog key={point.id} point={point} zones={data.zones} routes={data.routes} policy={data.policy} onClose={()=>setEditingPoint(false)} onSaved={()=>saved()}/>}
  </section>;
}
