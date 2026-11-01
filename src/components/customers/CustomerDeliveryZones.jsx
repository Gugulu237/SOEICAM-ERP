
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React,{useState,useEffect,useMemo} from 'react';
import { usePageState } from '@/lib/navigation-context';
import { useSearchParams } from '@/lib/router';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { customerDeliveryRequest } from '@/lib/customer-delivery-client';
import { filterDeliveryPoints,GPS_LABELS,ZONE_COLOURS,DELIVERY_DAYS } from '@/lib/customer-delivery';
import { errorMessage } from '@/lib/field-ops';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import CustomerQuickList from './CustomerQuickList';

import CustomerMapLinks from './CustomerMapLinks';
import GpsCapture from './GpsCapture';
import CustomerInfo from './CustomerInfo';
import {YAOUNDE_MUNICIPALITIES,ZONE_SERVICE_STATUSES,zoneDivision,zoneSubdivision,groupDeliveryZones} from '@/lib/customer-map-zones';
import { DeliveryDayPicker } from './DeliverySetupFields';
import { LocateFixed,Plus,RefreshCw,Pencil } from 'lucide-react';

export function GpsStatusBadge({status}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
return <span className={'inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-medium '+(status==='ready'?'bg-emerald-50 text-emerald-800':status==='missing'?'bg-red-50 text-red-700':'bg-slate-50 text-slate-800')}>{GPS_LABELS[status] || ui("Verify pin")}</span>;}

export default function CustomerDeliveryZones({onOpenCustomer,onChanged}) {
  useInterfaceLanguage();
  const {isAdmin}=useCurrentUser(),[params,setParams]=useSearchParams();
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[reload,setReload]=useState(0);
  const [search,setSearch]=usePageState('delivery-zones:search',''),[selected,setSelected]=useState([]),[targetZone,setTargetZone]=useState(''),[busy,setBusy]=useState(false);
  const [point,setPoint]=useState(null),[zoneDialog,setZoneDialog]=useState(null),[notice,setNotice]=useState('');
  const zone=params.get('zone')||'',gps=params.get('gps')||'',day=params.get('day')||'';
  const setFilter=(key,value)=>{const next=new URLSearchParams(params);next.set('view','zones');value?next.set(key,value):next.delete(key);setParams(next);setSelected([]);};
  useEffect(()=>{let active=true;setLoading(true);setError('');setSelected([]);customerDeliveryRequest({action:'customerDeliveryWorkspace'}).then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[reload]);
  const filtered=useMemo(()=>filterDeliveryPoints(data?.points||[],{zone,gps,day,search}),[data,zone,gps,day,search]);
  const activeZone=data?.zones.find(z=>z.id===zone),chosen=data?.points.filter(p=>selected.includes(p.id))||[];
  const groups=groupDeliveryZones((data?.coverage.zones||[]).filter(z=>z.id!=='unassigned'&&(z.is_active!==false||z.total>0)));
  function saved(){setPoint(null);setZoneDialog(null);setReload(n=>n+1);onChanged?.();}
  async function assign(){
    if(!targetZone||!chosen.length||busy||loading)return;
    setBusy(true);setError('');
    try{const result=await customerDeliveryRequest({action:'assignDeliveryZone',zoneId:targetZone==='unassigned'?'':targetZone,points:chosen.map(p=>({kind:p.kind,recordId:p.record_id,revision:p.delivery_revision}))});setNotice(ui('{0} delivery points updated.',result.updated));setTargetZone('');saved();}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  return <section className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">{ui('Customers by delivery zone')}</h2>
      <div className="flex min-w-0 flex-wrap gap-2"><Button variant="outline" size="sm" disabled={loading||busy} onClick={()=>setReload(n=>n+1)}><RefreshCw size={15}/>{ui('Refresh')}</Button>
      {isAdmin&&<Button size="sm" disabled={!data||busy} onClick={()=>setZoneDialog({})}><Plus size={15}/>{ui('Add delivery zone')}</Button>}</div>
    </div>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    {notice&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {loading&&!data?<p role="status" className="py-10 text-sm text-slate-500">{ui('Loading delivery zones and customer locations.')}</p>:data&&<>
      <div className="flex flex-wrap gap-2">{[['',ui('All zones'),data.coverage.total],['unassigned',ui('Unassigned'),data.coverage.unassigned]].map(([id,label,count])=><button key={id} type="button" aria-pressed={zone===id} onClick={()=>setFilter('zone',id)} className={'min-h-11 rounded-full border px-4 text-sm '+(zone===id?'border-emerald-700 bg-emerald-50 text-emerald-800':'bg-white')}>{label} <span className="ml-2 text-xs opacity-70">{count}</span></button>)}</div>
      <div className="space-y-2">{groups.map(group=><details key={group.name} open={zone?group.zones.some(z=>z.id===zone):undefined} className="rounded-xl border bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{group.name||ui('Other zones')} <span className="ml-2 font-normal text-slate-500">{group.zones.length}</span></summary>
        <div className="grid gap-2 border-t p-3 sm:grid-cols-2 lg:grid-cols-3">{group.zones.map(z=><button type="button" key={z.id} aria-pressed={zone===z.id} onClick={()=>setFilter('zone',zone===z.id?'':z.id)} className={'flex min-w-0 items-center justify-between gap-2 rounded-lg border p-3 text-left '+(zone===z.id?'border-emerald-600 bg-emerald-50':'border-slate-200 hover:bg-slate-50')}>
          <span className="min-w-0"><span className="block break-words text-sm font-medium">{zoneSubdivision(z)||z.name}</span>{zoneSubdivision(z)&&z.name!==zoneSubdivision(z)&&<span className="block break-words text-xs text-slate-500">{z.name}</span>}</span><span className="text-xs text-slate-500">{z.total}</span>
        </button>)}</div>
      </details>)}</div>
      {!groups.length&&<p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">{ui('Add a division and subdivision to create your first delivery zone.')}</p>}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{activeZone?.name||ui(zone==='unassigned'?'Unassigned':'All customers')} <span className="text-slate-500">({filtered.length})</span></p>
        {isAdmin&&activeZone&&<Button variant="outline" size="sm" onClick={()=>setZoneDialog(activeZone)}><Pencil size={14}/>{ui('Edit zone')}</Button>}
      </div>
      <Input aria-label={ui('Find a customer')} className="bg-white" value={search} onChange={event=>{setSearch(event.target.value);setSelected([]);}} placeholder={ui('Name, phone, town, neighbourhood or address')}/>
      <details className="rounded-lg border bg-white"><summary className="cursor-pointer p-3 text-xs font-medium">{ui('Filters and zone assignment')}</summary><div className="flex flex-wrap items-end gap-3 border-t p-3">
        <label className="min-w-0 flex-1 text-xs">{ui('GPS status')}<select aria-label={ui('GPS status')} className="mt-1 h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm" value={gps} onChange={e=>setFilter('gps',e.target.value)}><option value="">{ui('All GPS statuses')}</option><option value="ready">{ui('Precise pin')}</option><option value="attention">{ui('Needs attention')}</option><option value="missing">{ui('No pin')}</option><option value="unverified">{ui('Verify old pin')}</option><option value="approximate">{ui('Improve accuracy')}</option></select></label>
        <label className="min-w-0 flex-1 text-xs">{ui('Delivery day')}<select className="mt-1 h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm" value={day} onChange={e=>setFilter('day',e.target.value)}><option value="">{ui('Any day')}</option>{DELIVERY_DAYS.map(d=><option key={d}>{d}</option>)}</select></label>
        {isAdmin&&<select aria-label={ui('Manage delivery zones')} className="h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm" disabled={busy||loading} value="" onChange={e=>setZoneDialog(data.zones.find(z=>z.id===e.target.value))}><option value="">{ui('Manage zones')}</option>{data.zones.map(z=><option key={z.id} value={z.id}>{z.name}{z.is_active===false?ui(' (archived)'):''}</option>)}</select>}
        <Button size="sm" variant="ghost" disabled={busy||loading} onClick={()=>setSelected(selected.length?[]:filtered.slice(0,100).map(p=>p.id))}>{selected.length?ui('Clear selection'):ui('Select matching (up to 100)')}</Button>
      </div></details>
      {chosen.length>0&&<div className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3"><span className="text-sm font-medium">{ui('{0} selected',chosen.length)}</span><select aria-label={ui('Assign selected to zone')} disabled={busy||loading} className="h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm sm:w-auto sm:flex-1" value={targetZone} onChange={e=>setTargetZone(e.target.value)}><option value="">{ui('Choose zone')}</option><option value="unassigned">{ui('Unassigned')}</option>{data.zones.filter(z=>z.is_active!==false).map(z=><option key={z.id} value={z.id}>{[zoneDivision(z),zoneSubdivision(z),z.name].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' / ')}</option>)}</select><Button disabled={busy||!targetZone||loading} onClick={assign}>{busy?ui('Assigning.'):ui('Assign selected')}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={()=>setSelected([])}>{ui('Cancel')}</Button></div>}
      <CustomerQuickList key={[zone,gps,day,search].join('|')} customers={filtered} onOpen={p=>onOpenCustomer?.(p.customer_id)} selection={selected.length?selected:undefined} disabled={busy||loading} onToggle={(id,checked)=>setSelected(ids=>checked?[...ids,id]:ids.filter(value=>value!==id))} renderDetails={p=><div className="flex flex-wrap items-center gap-2"><GpsStatusBadge status={p.gps_status}/><Button variant="outline" size="sm" onClick={()=>setPoint(p)}><LocateFixed size={14}/>{ui('Delivery details')}</Button><Button size="sm" variant="ghost" disabled={busy||loading||selected.length>=100} onClick={()=>setSelected(ids=>ids.includes(p.id)?ids: [...ids,p.id])}>{ui('Assign zone')}</Button></div>}/>
      {point&&<DeliveryPointDialog key={point.id} point={point} zones={data.zones} routes={data.routes} policy={data.policy} onClose={()=>setPoint(null)} onSaved={saved}/>}
      {zoneDialog&&<DeliveryZoneDialog key={zoneDialog.id||'new-zone'} zone={zoneDialog} zones={data.zones} revision={data.revision} onClose={()=>setZoneDialog(null)} onSaved={saved}/>}
    </>}
  </section>;
}

export function DeliveryPointDialog({point,zones,routes,policy,onClose,onSaved}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [form,setForm]=useState({delivery_zone_id:point.zone_id || '',delivery_days:point.delivery_days || '',delivery_instructions:point.delivery_instructions || '',route_id:point.route_id || ''}),[capture,setCapture]=useState({}),[locating,setLocating]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(){if(busy || locating)return;setBusy(true);setError('');try{await customerDeliveryRequest({action:'saveDeliveryPoint',kind:point.kind,recordId:point.record_id,revision:point.delivery_revision,details:{...form,...capture}});onSaved();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose();}}><DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{ui("Delivery details · ")}{point.business_name}</DialogTitle><DialogDescription>{[point.address,point.neighbourhood,point.town].filter(Boolean).join(', ') || ui("Add the street address from the customer profile.")}{ui(" Capture the entrance while physically at this outlet.")}</DialogDescription></DialogHeader><div className="flex flex-wrap items-center gap-3"><GpsStatusBadge status={point.gps_status}/><CustomerMapLinks customer={point}/></div><fieldset disabled={busy} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">{ui("Zone")}<select aria-label={ui("Delivery point zone")} className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm" value={form.delivery_zone_id} onChange={e=>setForm(f=>({...f,delivery_zone_id:e.target.value}))}><option value="">{ui("Unassigned")}</option>{zones.filter(z=>z.is_active!==false || z.id===form.delivery_zone_id).map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></label><label className="text-xs">{ui("Delivery route")}<select className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm" value={form.route_id} onChange={e=>setForm(f=>({...f,route_id:e.target.value}))}><option value="">{ui("No route assigned")}</option>{routes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}{form.route_id&&!routes.some(r=>r.id===form.route_id)&&<option value={form.route_id}>{ui("Previously assigned route")}</option>}</select></label></div><DeliveryDayPicker value={form.delivery_days} onChange={days=>setForm(f=>({...f,delivery_days:days}))}/><label className="block text-xs">{ui("Opening hours, access and delivery instructions")}<textarea className="mt-1 w-full rounded-md border p-2 text-sm" rows={3} maxLength={2000} value={form.delivery_instructions} onChange={e=>setForm(f=>({...f,delivery_instructions:e.target.value}))}/></label><GpsCapture value={capture} onChange={setCapture} disabled={busy} onBusyChange={setLocating} maxAccuracy={policy.maxAccuracy}/></fieldset>{error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>{ui("Cancel")}</Button><Button onClick={save} disabled={busy || locating}>{busy?ui("Saving…"):ui("Save delivery details")}</Button></div></DialogContent></Dialog>;
}
export function DeliveryZoneDialog({zone,zones=[],revision,onClose,onSaved}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [form,setForm]=useState({name:'',code:'',town:'',neighbourhoods:'',notes:'',colour:'green',is_active:true,municipality:'',service_status:'planned',...zone,division:zoneDivision(zone),subdivision:zoneSubdivision(zone)}),[requestKey]=useState(()=>crypto.randomUUID()),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(){if(busy)return;if(!form.division.trim()||!form.subdivision.trim()){setError('Enter both the division and subdivision for this zone.');return;}setBusy(true);setError('');try{const result=await customerDeliveryRequest({action:'saveDeliveryZone',zoneId:zone.id,requestKey,revision,zone:form});onSaved(result);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose();}}><DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" aria-describedby={undefined}><DialogHeader><DialogTitle>{zone.id?ui("Edit delivery zone"):ui("Add delivery zone")}</DialogTitle><CustomerInfo title={ui("Delivery zones")}>{ui("Define an area, then assign its customers and outlets. GPS capture remains specific to each delivery entrance.")} {ui('Choose an existing division and subdivision or type new ones. You can add more zones as your delivery area grows.')}</CustomerInfo></DialogHeader><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2"><label className="text-xs">{ui('Division')}<Input aria-label={ui('Division')} list="delivery-divisions" className="mt-1" maxLength={150} value={form.division} placeholder={ui('e.g. Mfoundi')} onChange={e=>setForm(f=>({...f,division:e.target.value}))}/><datalist id="delivery-divisions">{[...new Set(['Mfoundi',...zones.map(zoneDivision).filter(Boolean)])].map(value=><option key={value} value={value}/>)}</datalist></label><label className="text-xs">{ui('Subdivision')}<Input aria-label={ui('Subdivision')} list="delivery-subdivisions" className="mt-1" maxLength={150} value={form.subdivision} placeholder={ui('e.g. YAOUNDÉ 1')} onChange={e=>setForm(f=>({...f,subdivision:e.target.value,municipality:''}))}/><datalist id="delivery-subdivisions">{[...new Set([...(form.division.trim().toLowerCase()==='mfoundi'?YAOUNDE_MUNICIPALITIES.map(m=>zoneSubdivision({municipality:m.id})):[]),...zones.filter(z=>zoneDivision(z).toLowerCase()===form.division.trim().toLowerCase()).map(zoneSubdivision).filter(Boolean)])].map(value=><option key={value} value={value}/>)}</datalist></label>{[['name',ui("Zone name")],['code',ui("Unique code")],['town',ui("Town / city")],['neighbourhoods',ui("Neighbourhoods covered")]].map(([key,label])=><label key={key} className="text-xs">{label}<Input aria-label={label} className="mt-1" value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/></label>)}<label className="text-xs">{ui("Service coverage")}<select aria-label={ui("Service coverage")} className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm" value={form.service_status} onChange={e=>setForm(f=>({...f,service_status:e.target.value}))}>{ZONE_SERVICE_STATUSES.map(status=><option key={status} value={status}>{ui(status==='served'?'Currently served':status==='planned'?'Planned coverage':'Service paused')}</option>)}</select></label><label className="text-xs">{ui("Colour")}<select className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm" value={form.colour} onChange={e=>setForm(f=>({...f,colour:e.target.value}))}>{Object.keys(ZONE_COLOURS).map(c=><option key={c}>{c}</option>)}</select></label><label className="flex items-center gap-2 self-end py-3 text-xs"><input type="checkbox" checked={form.is_active} onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))}/>{ui("Active zone")}</label><label className="text-xs sm:col-span-2">{ui("Delivery notes")}<textarea className="mt-1 w-full rounded-md border p-2 text-sm" rows={3} maxLength={2000} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></label></fieldset>{error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>{ui("Cancel")}</Button><Button disabled={busy} onClick={save}>{busy?ui("Saving…"):ui("Save zone")}</Button></div></DialogContent></Dialog>;
}
