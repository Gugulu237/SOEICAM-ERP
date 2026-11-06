import HelpNotice from '@/components/shared/HelpNotice';
import {sourceMessage,uiMessage,ui} from '@/lib/i18n';
import {useLocaleRender as useInterfaceLanguage} from '@/lib/localization';
import React,{useState,useEffect,useCallback,useRef} from 'react';
import dynamic from 'next/dynamic';
import {erp} from '@/api/erpClient';
import {Navigate,useNavigate,useSearchParams} from '@/lib/router';
import {useMenuBack} from '@/hooks/useMenuBack';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {readAll} from '@/lib/field-pos';
import {canManageDeliveries,canIssueDeliveryStock} from '@/lib/operations-access';
import {distributionSections,distributionMenuSections} from '@/lib/distribution-navigation';
import {formatXAF,formatDate} from '@/lib/formatters';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import StatusBadge from '@/components/shared/StatusBadge';
import {Button} from '@/components/ui/button';
import {Plus,Pencil,RefreshCw,Boxes,Truck,CarFront,ClipboardList,PackageCheck,Route as RouteIcon,Car,RotateCcw} from 'lucide-react';
import FleetBoard from '@/components/distribution/FleetBoard';
import VehicleDialog from '@/components/distribution/VehicleDialog';
import DeliveriesBoard from '@/components/distribution/DeliveriesBoard';
const StockControl=dynamic(()=>import('@/components/distribution/DistributionStockControl'),{loading:()=> <p role="status">{ui('Loading stock control...')}</p>});
const ExpiredExchangeReview=dynamic(()=>import('@/components/field/ExpiredExchangeReview'),{loading:()=> <p role="status">{ui('Loading exchange review...')}</p>});
const DriverWorkspace=dynamic(()=>import('@/views/EmployeeDashboard'),{loading:()=> <p role="status">{ui('Loading your deliveries...')}</p>});
const OwnFieldStock=dynamic(()=>import('@/components/field/FieldInventoryCards'),{loading:()=> <p role="status">{ui('Loading assigned inventory...')}</p>});
const icons={stock:Boxes,deliveries:Truck,fleet:CarFront,dispatches:ClipboardList,requests:PackageCheck,routes:RouteIcon,vehicles:Car,exchanges:RotateCcw,returns:RotateCcw};

function DistributionMenu({sections,onOpen}){
  return <div className="min-w-0 space-y-5"><PageHeader title={ui('Distribution')}/>
    <nav aria-label={ui('Distribution sections')} className="mx-auto grid max-w-5xl grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
      {sections.map(section=>{const Icon=icons[section.key];return <button type="button" key={section.key} aria-label={section.label} onClick={()=>onOpen(section.key)} className="group flex min-h-40 min-w-0 flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white px-3 py-6 text-center shadow-sm transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:min-h-48">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon size={28} strokeWidth={1.7} aria-hidden="true"/></span>
        <span className="break-words text-sm font-semibold text-slate-900 sm:text-base">{section.label}</span>
      </button>;})}
    </nav>
  </div>;
}

export default function Distribution(){
  useInterfaceLanguage();
  const {role:featureRole,principalRole,employee,loading}=useCurrentUser(),[params]=useSearchParams(),navigate=useNavigate(),backToMenu=useMenuBack('/distribution');
  const role=principalRole||featureRole;
  if(loading)return <p role="status">{ui('Loading distribution...')}</p>;
  if(role==='driver'){
    if(params.get('tab')==='stock')return <div className="space-y-4"><PageHeader title={ui('My issued stock')} back={{onClick:backToMenu,label:ui('Distribution menu')}}/><OwnFieldStock employeeId={employee?.id} enabled={!!employee?.id}/></div>;
    if(params.get('tab')==='deliveries')return <div className="space-y-4"><PageHeader title={ui('My deliveries')} back={{onClick:backToMenu,label:ui('Distribution menu')}}/><DriverWorkspace/></div>;
    if(params.has('tab'))return <Navigate to="/distribution" replace/>;
    const menu=distributionMenuSections(role);
    return <DistributionMenu sections={menu} onOpen={key=>navigate(menu.find(section=>section.key===key).path)}/>;
  }
  if(role!=='admin')return <Navigate to={role==='commercial'?'/commercial':canIssueDeliveryStock(role)?'/inventory':'/'} replace/>;
  if(params.get('issue')==='1')return <Navigate to={canIssueDeliveryStock(role)?'/inventory?'+new URLSearchParams({issue:'1',...(params.get('commercial')?{commercial:params.get('commercial')}:{})}):'/distribution?tab=stock'} replace/>;
  return <DistributionManagement/>;
}

function DistributionManagement(){
  useInterfaceLanguage();
  const {role}=useCurrentUser(),navigate=useNavigate(),[searchParams,setSearchParams]=useSearchParams(),backToMenu=useMenuBack('/distribution');
  const sections=distributionSections(role),canManageVehicles=canManageDeliveries(role);
  const requested=searchParams.get('tab')||(searchParams.has('run')||searchParams.has('commercial')||searchParams.has('date')?'stock':'home');
  const requestedTab=requested==='field-requests'?'stock':requested;
  const selectedTab=sections.some(section=>section.key===requestedTab)?requestedTab:'home';
  const [dispatches,setDispatches]=useState([]),[requests,setRequests]=useState([]),[routes,setRoutes]=useState([]),[vehicles,setVehicles]=useState([]),[warehouses,setWarehouses]=useState([]),[branches,setBranches]=useState([]);
  const [vehicleDialog,setVehicleDialog]=useState({open:false,record:null});
  const [loading,setLoading]=useState(true),[loadedTab,setLoadedTab]=useState(''),[loadError,setLoadError]=useState('');
  const sequence=useRef(0);
  const loadData=useCallback(async()=>{
    if(['home','stock','exchanges'].includes(selectedTab))return;
    const request=++sequence.current;setLoading(true);setLoadError('');
    try{
      const [d,r,v,req,w,b]=await Promise.all([
        ['deliveries','fleet','dispatches'].includes(selectedTab)?readAll(erp.entities.Dispatch,{},'-created_date'):[],
        selectedTab==='routes'?readAll(erp.entities.Route,{}):[],
        ['fleet','vehicles'].includes(selectedTab)?readAll(erp.entities.Vehicle,{}):[],
        selectedTab==='requests'?readAll(erp.entities.DispatchRequest,{},'-created_date'):[],
        selectedTab==='vehicles'?readAll(erp.entities.Warehouse,{}):[],
        selectedTab==='vehicles'&&canManageVehicles?readAll(erp.entities.Branch,{}):[],
      ]);
      if(request!==sequence.current)return;
      setDispatches(d);setRoutes(r);setVehicles(v);setRequests(req);setWarehouses(w);setBranches(b);
    }catch(error){if(request===sequence.current)setLoadError(error.message||sourceMessage('Could not load distribution.'));}
    finally{if(request===sequence.current){setLoading(false);setLoadedTab(selectedTab);}}
  },[selectedTab,canManageVehicles]);
  useEffect(()=>{loadData();return()=>{sequence.current++;};},[loadData]);
  function vehicleLocation(vehicle){
    const location=warehouses.find(warehouse=>warehouse.id===vehicle.warehouse_id);
    if(!location)return {ready:false,label:ui('Needs stock location')};
    if(location.is_active===false||location.warehouse_type!=='vehicle'||(location.vehicle_id&&location.vehicle_id!==vehicle.id)||vehicles.some(other=>other.id!==vehicle.id&&other.warehouse_id===location.id))return {ready:false,label:ui('Check stock location')};
    return {ready:true,label:location.name};
  }
  const dispatchCols = [
    { key: "dispatch_number", label: ui("Dispatch #") },
    { key: "dispatch_date", label: ui("Date"), render: v => formatDate(v) },
    { key: "route_name", label: ui("Route") },
    { key: "vehicle_name", label: ui("Vehicle") },
    { key: "driver_name", label: ui("Driver") },
    { key: "total_loaded_value", label: ui("Loaded"), render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: ui("Status"), render: v => <StatusBadge status={v} /> },
  ];

  const requestCols = [
    { key: "request_number", label: ui("Request #") },
    { key: "request_date", label: ui("Date"), render: v => formatDate(v) },
    { key: "driver_name", label: ui("Driver") },
    { key: "vehicle_name", label: ui("Vehicle") },
    { key: "source_warehouse_name", label: ui("From Store") },
    { key: "items", label: ui("Products"), render: v => (v || []).length, className: "text-right" },
    { key: "status", label: ui("Status"), render: v => <StatusBadge status={v} /> },
  ];



  const routeCols = [
    { key: "code", label: ui("Code") },
    { key: "name", label: ui("Route Name") },
    { key: "is_active", label: ui("Status"), render: v => <StatusBadge status={v ? "active" : "inactive"} /> },
  ];

  const vehicleCols = [
    { key: "registration", label: ui("Registration") },
    { key: "name", label: ui("Name") },
    { key: "vehicle_type", label: ui("Type") },
    { key: "warehouse_id", label: ui("Delivery stock location"), render: (_, vehicle) => {
      const location = vehicleLocation(vehicle);
      return <span className={location.ready ? 'text-slate-600' : 'font-medium text-slate-700'}>{location.label}</span>;
    } },
    { key: "is_active", label: ui("Status"), render: v => <StatusBadge status={v !== false ? "active" : "inactive"} /> },
    ...(canManageVehicles ? [{ key: "id", label: ui("Setup"), sortable: false, render: (_, vehicle) => <Button size="sm" variant="outline" onClick={() => setVehicleDialog({ open: true, record: vehicle })}><Pencil size={14} className="mr-1" /> {vehicleLocation(vehicle).ready ? ui("Edit vehicle") : ui("Set up location")}</Button> }] : []),
  ];


  if(selectedTab==='home')return <DistributionMenu sections={distributionMenuSections(role)} onOpen={tab=>setSearchParams(new URLSearchParams({tab}))}/>;
  const register=['deliveries','fleet','dispatches','requests','routes','vehicles'].includes(selectedTab);
  return <div className="min-w-0 space-y-5">
    <PageHeader back={{onClick:backToMenu,label:ui('Distribution menu')}} title={sections.find(section=>section.key===selectedTab)?.label} actions={register&&<Button variant="outline" disabled={loading} onClick={loadData}><RefreshCw size={15} className="mr-2"/>{ui('Refresh')}</Button>}/>
    {selectedTab==='stock'&&<StockControl/>}
    {selectedTab==='exchanges'&&<ExpiredExchangeReview/>}
    {register&&(loadError?<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{uiMessage(loadError)}<Button className="mt-4 block" variant="outline" onClick={loadData}>{ui('Try again')}</Button></div>:loading||loadedTab!==selectedTab?<p role="status" className="py-12 text-center text-slate-500">{ui('Loading distribution...')}</p>:<>
      {selectedTab==='deliveries'&&<DeliveriesBoard dispatches={dispatches}/>}
      {selectedTab==='fleet'&&<FleetBoard vehicles={vehicles} dispatches={dispatches}/>}
      {selectedTab==='dispatches'&&<DataTable columns={dispatchCols} data={dispatches} searchFields={['dispatch_number','route_name','vehicle_name']} onRowClick={row=>navigate('/distribution/dispatches/'+row.id)}/>}
      {selectedTab==='requests'&&<DataTable columns={requestCols} data={requests} searchFields={['request_number','driver_name','vehicle_name']} onRowClick={row=>navigate('/distribution/requests/'+row.id)} emptyMessage={ui('No issue records yet')}/>}
      {selectedTab==='routes'&&<DataTable columns={routeCols} data={routes} searchFields={['name','code']}/>}
      {selectedTab==='vehicles'&&<>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"><HelpNotice title={ui('Delivery vehicles')}><p>{ui('Each active vehicle needs its own stock location. New vehicles get an empty dedicated location automatically; goods move only when warehouse management confirms loading.')}</p></HelpNotice>{canManageVehicles&&<Button onClick={()=>setVehicleDialog({open:true,record:null})}><Plus size={16} className="mr-1"/>{ui('Add vehicle')}</Button>}</div>
        <DataTable columns={vehicleCols} data={vehicles} searchFields={['registration','name']}/>
      </>}
    </>)}
    {selectedTab==='vehicles'&&canManageVehicles&&vehicleDialog.open&&<VehicleDialog open onOpenChange={open=>setVehicleDialog(previous=>({...previous,open}))} vehicle={vehicleDialog.record} vehicles={vehicles} warehouses={warehouses} branches={branches} onSaved={loadData}/>}
  </div>;
}
