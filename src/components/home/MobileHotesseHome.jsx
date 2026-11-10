import React,{useState} from 'react';
import {ClipboardCheck,Users,History,MapPin} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {ui} from '@/lib/i18n';
import CustomerMapLinks from '@/components/customers/CustomerMapLinks';
import GoogleCustomerMap from '@/components/customers/GoogleCustomerMap';
import {hasCustomerLocation} from '@/lib/customer-location';
import {StaffDate,StaffMetrics,StaffSection,StaffModules,StaffRow} from './StaffMobileParts';

// Sleek accueil-hôtesse: assigned customer work and reports, never a sales entry.
export default function MobileHotesseHome({source,locations,reports,loading,preview,setSelected,setTab}) {
  const [mapOpen,setMapOpen]=useState(false);
  const today=reports.filter(report=>report.visit_date===source.date),pending=locations.filter(location=>!location.daily_report_submitted);
  return <div data-sleek-screen="accueil-hotesse" className="space-y-5">
    <StaffDate date={source.date}/>
    <p className="rounded-lg border border-l-4 border-l-primary bg-white px-3 py-2 text-xs font-semibold text-primary">{ui('Visits and reports · sales unavailable')}</p>
    <StaffMetrics ready={!loading} metrics={[{label:'Reports today',value:today.length},{label:'Reports to complete',value:pending.length}]}/>
    <Button className="min-h-12 w-full gap-2" disabled={preview||loading||!locations.length} onClick={()=>setTab('today')}><ClipboardCheck size={19}/>{ui('New visit report')}</Button>
    <StaffSection title="My assigned customers"><div className="space-y-2">{locations.map(location=><div key={location.id} className="rounded-xl border bg-white p-3"><StaffRow title={location.customer_name||location.name} detail={[location.name,location.town,location.daily_report_submitted?ui('Daily report submitted'):ui('Report to complete')].filter(Boolean).join(' · ')} onClick={()=>{setSelected(location.id);setTab('today');}}/><div className="mt-1 flex justify-end"><CustomerMapLinks customer={location}/></div></div>)}{!loading&&!locations.length&&<p className="text-sm text-muted-foreground">{ui('No point of sale assigned yet')}</p>}</div></StaffSection>
    <StaffSection title="Modules"><StaffModules onSelect={key=>key==='map'?setMapOpen(true):setTab(key)} actions={[{key:'today',title:'Assigned customers',icon:Users},{key:'history',title:'Reports',icon:History},{key:'map',title:'Map',icon:MapPin,disabled:!locations.some(hasCustomerLocation)},{key:'stock',title:'Shelf stock',icon:ClipboardCheck},{key:'deliveries',title:'Supplies & batches',icon:ClipboardCheck},{key:'performance',title:'Performance & rewards',icon:History}]}/></StaffSection>
    {mapOpen&&<GoogleCustomerMap customers={locations.filter(hasCustomerLocation)} initialExpanded onClose={()=>setMapOpen(false)}/>}
  </div>;
}
